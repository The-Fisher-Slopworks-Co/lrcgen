#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = [
#     "demucs==4.0.1",
#     "torch>=2.4,<2.6",
#     "torchaudio>=2.4,<2.6",
#     "numpy<2",
#     "soundfile>=0.12",
#     "openai>=1.40",
#     "ctc-forced-aligner>=1.0.2,<2",
#     "unidecode",
# ]
# ///
"""Transcription pipeline for lrcgen: separate vocals with Demucs, transcribe
them with a Gemini model through an OpenAI-compatible API (e.g. OpenRouter),
then force-align the lyrics to the vocals with ctc-forced-aligner.

This file is embedded in the lrcgen binary and executed via `uv run --script`.
It talks to the parent process over a JSON-lines protocol on the real stdout,
one object per line:

    {"type": "stage", "stage": "init"|"demucs"|"api"|"align", "message": "...", "progress": <0-1, optional>}
    {"type": "result", "lines": [{"timestamp": <ms|null>, "text": "...",
        "words": [{"start": <ms>, "text": "..."}], "end": <ms>}], "rawLyrics": "..."}

"words" and "end" are only present on timed lines. With --separate-only the
result has no lines and empty rawLyrics. With --lyrics-file the lyrics are
read from that file instead of transcribed (no "api" stage, no API key), and
rawLyrics is the file's text.
    {"type": "error", "stage": "init"|"demucs"|"api"|"align", "message": "..."}

The vocal stem is written losslessly to --vocals and shifted to be
sample-aligned with the song; an existing stem there is reused.

The API key is taken from OPENAI_API_KEY or OPENROUTER_API_KEY (never argv,
so it does not show up in `ps`). Requires ffmpeg in PATH.
"""

import json
import os
import sys

# Claim the real stdout for the protocol and point fd 1 at stderr, so nothing
# demucs/torch/openai print (Python- or C-level) can pollute the protocol.
_protocol = os.fdopen(os.dup(1), "w", encoding="utf-8")
os.dup2(2, 1)
sys.stdout = sys.stderr

import argparse
import base64
import re
import shutil
import signal
import subprocess
import tempfile
import time
from pathlib import Path

DEMUCS_MODEL = "htdemucs"
ALIGN_MODEL_PATH = "~/.cache/ctc_forced_aligner/model.onnx"
ALIGN_SAMPLE_RATE = 16000
STEM_SAMPLE_RATE = 44100
SECTION_TAG_RE = re.compile(r"^\[[A-Z][A-Z ]*\]$")
DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_MODEL = "google/gemini-3.1-flash-lite"
DEFAULT_ALIGN_LANG = "rus"
PROGRESS_INTERVAL_S = 0.5

PROMPT = (
    "Transcribe the lyrics of this song exactly as they are sung, in the "
    "original language. Format the output as song lyrics: one line per sung "
    "line/phrase, with a blank line between sections. Never merge the lyrics "
    "into a single paragraph. Where it is clear, label a section on its own "
    "line with one of these tags: [INTRO], [VERSE], [CHORUS], [BRIDGE], "
    "[OUTRO]. The tags are optional - never emit a tag for a section with no "
    "sung lyrics, and skip the tag if unsure. Output only the lyrics - no "
    "timestamps, no commentary, no translations."
)

_current = {"stage": "init", "message": "", "reported_at": 0.0}


def emit(event: dict) -> None:
    _protocol.write(json.dumps(event, ensure_ascii=False) + "\n")
    _protocol.flush()


def stage(name: str, message: str) -> None:
    _current.update(stage=name, message=message, reported_at=0.0)
    print(f"[{name}] {message}", file=sys.stderr)
    emit({"type": "stage", "stage": name, "message": message})


def report_progress(fraction: float, message: str | None = None) -> None:
    """Progress within the current stage, at most every PROGRESS_INTERVAL_S."""
    now = time.monotonic()
    if fraction < 1 and now - _current["reported_at"] < PROGRESS_INTERVAL_S:
        return
    _current["reported_at"] = now
    emit({
        "type": "stage",
        "stage": _current["stage"],
        "message": message or _current["message"],
        "progress": round(max(0.0, min(1.0, fraction)), 4),
    })


def _install_progress_hook() -> None:
    """Turn tqdm bars (model downloads, Demucs chunks) into protocol progress.

    Must run before torch is imported: torch.hub binds `from tqdm import tqdm`
    at import time.
    """
    try:
        import tqdm
    except ImportError:
        return

    class ProgressTqdm(tqdm.tqdm):
        def update(self, n=1):
            shown = super().update(n)
            if self.total:
                message = None
                if self.unit == "B":
                    message = f"downloading the model ({self.total / 1e6:.0f} MB)"
                report_progress(self.n / self.total, message)
            return shown

    tqdm.tqdm = ProgressTqdm


def fail(stage_name: str, message: str) -> None:
    emit({"type": "error", "stage": stage_name, "message": message})
    sys.exit(1)


def decode(path: Path):
    """(n, 2) float32 at STEM_SAMPLE_RATE, decoded the way the browser plays it."""
    import numpy as np

    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-map", "0:a:0", "-ac", "2",
         "-ar", str(STEM_SAMPLE_RATE), "-f", "f32le", "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, 2)


def stem_lag(ref, x, max_lag: float = 0.3, win: float = 10) -> int:
    """Samples by which stem `x` lags song `ref`, measured on three windows across the song."""
    import numpy as np

    a, b = ref.mean(1), x.mean(1)
    L, n = int(max_lag * STEM_SAMPLE_RATE), int(win * STEM_SAMPLE_RATE)
    if min(len(a), len(b)) < n + 2 * L:
        return 0
    lags = []
    for frac in (0.2, 0.45, 0.7):
        s = L + int(frac * (min(len(a), len(b)) - n - 2 * L))
        m, v = a[s:s + n], b[s - L:s + n + L]
        if float(np.dot(m, m)) < 1e-6:  # silence says nothing about the lag
            continue
        size = 1 << int(np.ceil(np.log2(len(v) + len(m))))
        c = np.fft.irfft(np.fft.rfft(v, size) * np.conj(np.fft.rfft(m, size)), size)[:2 * L + 1]
        lags.append(int(np.argmax(c)) - L)
    if not lags:
        return 0
    if len(set(lags)) > 1:
        print(f"warning: windows disagree on the stem lag: {lags}", file=sys.stderr)
    return int(np.median(lags))


def separate_vocals(song: Path, vocals: Path) -> Path:
    """The vocal stem at `vocals` (FLAC), sample-aligned with `song`; reused if it exists."""
    if vocals.exists():
        stage("demucs", f"using cached vocals for {song.name}")
        return vocals

    stage("init", "loading the vocal separation model ...")
    from demucs.pretrained import get_model

    get_model(DEMUCS_MODEL)  # downloads the weights on the first run

    stage("demucs", f"separating vocals from {song.name} ...")
    import numpy as np
    import soundfile as sf
    from demucs.separate import main as demucs_main

    vocals.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        demucs_main([
            "--two-stems", "vocals",
            "--flac", "--int24",
            "-n", DEMUCS_MODEL,
            "-o", tmp,
            str(song),
        ])
        found = sorted(Path(tmp).rglob("vocals.flac"))
        if not found:
            raise RuntimeError("demucs finished but wrote no vocals.flac")

        stage("demucs", "lining the vocals up with the song ...")
        ref, x = decode(song), decode(found[0])

    d = stem_lag(ref, x)
    if d:
        print(f"stem lagged the song by {d} samples, shifting", file=sys.stderr)
    x = x[d:] if d >= 0 else np.pad(x, ((-d, 0), (0, 0)))
    x = np.pad(x[:len(ref)], ((0, max(0, len(ref) - len(x))), (0, 0)))

    # Written under a temp name and renamed, so a killed run never leaves a half stem to be reused.
    partial = vocals.with_name(f".{vocals.name}.{os.getpid()}.tmp")
    try:
        sf.write(str(partial), x, STEM_SAMPLE_RATE, subtype="PCM_24", format="FLAC")
        os.replace(partial, vocals)
    finally:
        partial.unlink(missing_ok=True)
    return vocals


def transcribe(vocals: Path, model: str, base_url: str, api_key: str) -> str:
    from openai import OpenAI

    with tempfile.TemporaryDirectory() as tmp:
        mp3 = Path(tmp) / "vocals.mp3"
        stage("api", "encoding the vocals for upload ...")
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-i", str(vocals),
             "-codec:a", "libmp3lame", "-b:a", "128k", str(mp3)],
            check=True,
        )
        audio_b64 = base64.b64encode(mp3.read_bytes()).decode("ascii")
        size_mb = mp3.stat().st_size / 1e6

    stage("api", f"sending {size_mb:.1f} MB of vocals to {model} ...")
    client = OpenAI(base_url=base_url, api_key=api_key)
    resp = client.chat.completions.create(
        model=model,
        temperature=0.2,
        messages=[{
            "role": "user",
            "content": [
                {"type": "text", "text": PROMPT},
                {
                    "type": "input_audio",
                    "input_audio": {"data": audio_b64, "format": "mp3"},
                },
            ],
        }],
    )
    text = resp.choices[0].message.content
    if not text:
        raise RuntimeError(f"model returned an empty response: {resp}")

    text = text.strip()
    if text.startswith("```"):  # occasionally models wrap output in a fence
        text = text.strip("`").strip()
    return text


def _align_words(text: str) -> list[str]:
    """Words of `text` as the aligner sees them: lowercased, punctuation dropped."""
    return re.sub(r"[^\w\s\-']", " ", text.lower(), flags=re.UNICODE).split()


def _line_align_words(line: str) -> list[str]:
    line = line.strip()
    if not line or SECTION_TAG_RE.match(line):
        return []
    return _align_words(line)


def align_lines(vocals: Path, lines: list[str], language: str) -> list[list[dict]]:
    """Force-align lyric lines to the vocals.

    Returns, per line, one {"start": s, "end": s} per word of _line_align_words;
    untimeable lines (blank, section tags) get [].
    """
    from ctc_forced_aligner import (
        AlignmentSingleton,
        generate_emissions,
        get_alignments,
        get_spans,
        load_audio,
        postprocess_results,
        preprocess_text,
    )

    words: list[str] = []
    spans: list[tuple[int, int]] = []
    for line in lines:
        line_words = _line_align_words(line)
        spans.append((len(words), len(words) + len(line_words)))
        words.extend(line_words)
    if not words:
        raise RuntimeError("no alignable text in the lyrics")

    stage("align", "loading alignment model ...")
    aligner = AlignmentSingleton(model_path=os.path.expanduser(ALIGN_MODEL_PATH))

    with tempfile.TemporaryDirectory() as tmp:
        wav_path = Path(tmp) / "vocals16k.wav"
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-i", str(vocals),
             "-ac", "1", "-ar", str(ALIGN_SAMPLE_RATE), str(wav_path)],
            check=True,
        )
        audio = load_audio(str(wav_path))

    stage("align", f"aligning {len(words)} words ...")
    emissions, stride = generate_emissions(aligner.alignment_model, audio, batch_size=4)
    tokens_starred, text_starred = preprocess_text(
        " ".join(words), romanize=True, language=language
    )
    segments, scores, blank_token = get_alignments(
        emissions, tokens_starred, aligner.alignment_tokenizer
    )
    word_spans = get_spans(tokens_starred, segments, blank_token)
    word_ts = postprocess_results(text_starred, word_spans, stride, scores)
    if len(word_ts) != len(words):
        raise RuntimeError(
            f"alignment mismatch: {len(word_ts)} timestamps for {len(words)} words"
        )

    return [word_ts[begin:end] for begin, end in spans]


def _ms(seconds: float) -> int:
    return int(round(seconds * 1000))


def attach_word_times(line: str, aligned: list[dict]) -> tuple[list[dict], int] | None:
    """Put aligned times on the words of `line` as written.

    Returns the words as {"start": ms, "text": word plus the space after it}
    and the end of the last one in ms, or None if they don't add up. A token
    with nothing to align (a lone dash, "...") rides along with its neighbour.
    """
    words: list[dict] = []
    prefix = ""
    pos = 0
    for token in line.split():
        count = len(_align_words(token))
        if count == 0:
            if words:
                words[-1]["text"] += " " + token
            else:
                prefix += token + " "
            continue
        if pos + count > len(aligned):
            return None
        words.append({"start": _ms(aligned[pos]["start"]), "text": prefix + token})
        prefix = ""
        pos += count
    if not words or pos != len(aligned):
        return None
    for word in words[:-1]:
        word["text"] += " "
    return words, _ms(aligned[-1]["end"])


def build_lines(vocals: Path, lyrics: str, language: str) -> list[dict]:
    lines = lyrics.splitlines()
    aligned_lines = align_lines(vocals, lines, language)
    out = []
    for line, aligned in zip(lines, aligned_lines):
        stripped = line.strip()
        if not stripped or SECTION_TAG_RE.match(stripped):
            continue  # tags and blank lines stay in rawLyrics but not in the document
        if not aligned:
            out.append({"timestamp": None, "text": stripped})
            continue
        attached = attach_word_times(stripped, aligned)
        if attached is None:  # keep the line timing even if the words don't map
            out.append({"timestamp": _ms(aligned[0]["start"]), "text": stripped})
            continue
        words, end = attached
        out.append({
            "timestamp": words[0]["start"],
            "text": "".join(w["text"] for w in words),
            "words": words,
            "end": end,
        })
    return out


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Transcribe song lyrics with per-line and per-word timings for lrcgen."
    )
    parser.add_argument("audio", type=Path, help="audio file to transcribe")
    parser.add_argument(
        "--vocals", type=Path, required=True,
        help="where the separated vocal stem (FLAC) is written; reused if it exists",
    )
    parser.add_argument(
        "--separate-only", action="store_true",
        help="only separate the vocals: no transcription, the result has no lines",
    )
    parser.add_argument(
        "--lyrics-file", type=Path,
        help="align these lyrics (UTF-8, one line per line) instead of transcribing",
    )
    parser.add_argument(
        "--base-url", default=os.environ.get("OPENAI_BASE_URL", DEFAULT_BASE_URL),
        help="OpenAI-compatible API base URL (default: $OPENAI_BASE_URL or OpenRouter)",
    )
    parser.add_argument("--model", default=DEFAULT_MODEL, help="model to use (default: %(default)s)")
    parser.add_argument(
        "--align-lang", default=DEFAULT_ALIGN_LANG,
        help="ISO 639-3 language of the lyrics for forced alignment (default: %(default)s)",
    )
    args = parser.parse_args()

    # Let a cancelled run (SIGTERM from lrcgen) unwind, so temp files get cleaned up.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    stage("init", "starting ...")

    api_key = os.environ.get("OPENAI_API_KEY") or os.environ.get("OPENROUTER_API_KEY")
    if not api_key and not args.separate_only and not args.lyrics_file:
        fail("init", "no API key: set OPENAI_API_KEY or OPENROUTER_API_KEY")
    if not shutil.which("ffmpeg"):
        fail("init", "ffmpeg not found in PATH (required by demucs to decode audio)")
    if not args.audio.is_file():
        fail("init", f"file not found: {args.audio}")
    if args.lyrics_file and not args.lyrics_file.is_file():
        fail("init", f"file not found: {args.lyrics_file}")

    current = "demucs"
    try:
        vocals = separate_vocals(args.audio, args.vocals)
        if args.separate_only:
            emit({"type": "result", "lines": [], "rawLyrics": ""})
            return
        if args.lyrics_file:
            lyrics = args.lyrics_file.read_text(encoding="utf-8")
        else:
            current = "api"
            lyrics = transcribe(vocals, args.model, args.base_url, api_key)
        current = "align"
        lines = build_lines(vocals, lyrics, args.align_lang)
    except Exception as e:
        fail(current, str(e) or type(e).__name__)
        return

    emit({"type": "result", "lines": lines, "rawLyrics": lyrics})


if __name__ == "__main__":
    _install_progress_hook()
    main()
