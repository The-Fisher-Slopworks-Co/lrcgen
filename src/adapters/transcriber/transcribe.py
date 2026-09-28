#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11,<3.15"
# dependencies = [
#     "av>=14",
#     "demucs==4.0.1",
#     "torch>=2.10",
#     "torchaudio>=2.10",
#     "numpy",
#     "soundfile>=0.12",
#     "openai>=1.40",
#     "unidecode",
# ]
# ///
"""Transcription pipeline for lrcgen: separate vocals with Demucs, transcribe
them with a Gemini model through an OpenAI-compatible API (e.g. OpenRouter),
then force-align the lyrics to the vocals with the MMS aligner from torchaudio.

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
so it does not show up in `ps`). Audio is decoded and encoded with PyAV, which
bundles its own FFmpeg libraries, so no ffmpeg needs to be installed.
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
import io
import re
import signal
import time
import unicodedata
from pathlib import Path

DEMUCS_MODEL = "htdemucs"
ALIGN_SAMPLE_RATE = 16000
ALIGN_FRAME_S = 0.02  # wav2vec2 emits a frame per 320 samples
ALIGN_WINDOW_S = 30
ALIGN_CONTEXT_S = 2
ALIGN_BATCH = 4
STEM_SAMPLE_RATE = 44100
SECTION_TAG_RE = re.compile(r"^\[[A-Z][A-Z ]*\]$")
DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_MODEL = "google/gemini-3.1-flash-lite"
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


def decode(path: Path, rate: int, channels: int):
    """(n, channels) float32 at `rate`: the first audio stream, decoded the way the browser plays it."""
    import av
    import numpy as np

    resampler = av.AudioResampler(format="flt", layout="stereo" if channels == 2 else "mono", rate=rate)
    chunks = []
    with av.open(str(path)) as container:
        for frame in container.decode(audio=0):
            chunks.extend(f.to_ndarray() for f in resampler.resample(frame))
        chunks.extend(f.to_ndarray() for f in resampler.resample(None))
    if not chunks:
        raise RuntimeError(f"no audio in {path.name}")
    # Packed float frames come out as (1, n * channels), the channels interleaved.
    return np.concatenate(chunks, axis=1).reshape(-1, channels)


def encode_mp3(samples, rate: int, bitrate: int = 128_000) -> bytes:
    """`samples` ((n, 2) float32 at `rate`) as an MP3 file."""
    import av

    buf = io.BytesIO()
    with av.open(buf, "w", format="mp3") as out:
        stream = out.add_stream("libmp3lame", rate=rate, layout="stereo")
        stream.bit_rate = bitrate
        frame = av.AudioFrame.from_ndarray(samples.reshape(1, -1), format="flt", layout="stereo")
        frame.sample_rate = rate
        for packet in stream.encode(frame):
            out.mux(packet)
        for packet in stream.encode(None):
            out.mux(packet)
    return buf.getvalue()


def separate_vocals(song: Path, vocals: Path) -> Path:
    """The vocal stem at `vocals` (FLAC), sample-aligned with `song`; reused if it exists.

    Demucs gets the song as decode() gives it, so the stem lines up with the
    browser's playback sample for sample.
    """
    if vocals.exists():
        stage("demucs", f"using cached vocals for {song.name}")
        return vocals

    stage("init", "loading the vocal separation model ...")
    from demucs.pretrained import get_model

    model = get_model(DEMUCS_MODEL)  # downloads the weights on the first run
    model.eval()

    stage("demucs", f"separating vocals from {song.name} ...")
    import numpy as np
    import soundfile as sf
    import torch
    from demucs.apply import apply_model

    mix = torch.from_numpy(decode(song, model.samplerate, model.audio_channels).T.copy())
    # What `demucs.separate` does: normalize, separate, undo the normalization.
    ref = mix.mean(0)
    mean, std = ref.mean(), ref.std()
    device = "cuda" if torch.cuda.is_available() else "cpu"
    # No random shifts: a single one (demucs' default) gains nothing over none on average,
    # it only makes the stem, and so the sync, differ from run to run.
    with torch.no_grad():
        sources = apply_model(model, ((mix - mean) / std)[None], device=device, shifts=0, split=True,
                              overlap=0.25, progress=True)[0]
    x = (sources[model.sources.index("vocals")] * std + mean).T.numpy()
    x = x / max(1.01 * float(np.abs(x).max()), 1.0)  # scaled down rather than clipped, like demucs

    vocals.parent.mkdir(parents=True, exist_ok=True)
    # Written under a temp name and renamed, so a killed run never leaves a half stem to be reused.
    partial = vocals.with_name(f".{vocals.name}.{os.getpid()}.tmp")
    try:
        sf.write(str(partial), x, model.samplerate, subtype="PCM_24", format="FLAC")
        os.replace(partial, vocals)
    finally:
        partial.unlink(missing_ok=True)
    return vocals


def transcribe(vocals: Path, model: str, base_url: str, api_key: str) -> str:
    from openai import OpenAI

    stage("api", "encoding the vocals for upload ...")
    mp3 = encode_mp3(decode(vocals, STEM_SAMPLE_RATE, 2), STEM_SAMPLE_RATE)
    audio_b64 = base64.b64encode(mp3).decode("ascii")
    size_mb = len(mp3) / 1e6

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


def _romanize(word: str) -> str:
    """`word` in the MMS aligner's alphabet: lowercase Latin letters and the apostrophe.

    MMS was trained on romanized text of every language, so Cyrillic and the
    rest go through unidecode; digits and punctuation drop out.
    """
    from unidecode import unidecode

    return re.sub(r"[^a-z']", "", unidecode(unicodedata.normalize("NFKC", word)).lower())


def _emissions(model, audio, device):
    """(frames, labels + 1) log-probabilities of `audio`, the last column for the <star> token.

    The song goes through the model in ALIGN_WINDOW_S windows, each with
    ALIGN_CONTEXT_S of context either side, so memory stays flat however long it is.
    """
    import numpy as np
    import torch

    window, context = ALIGN_WINDOW_S * ALIGN_SAMPLE_RATE, ALIGN_CONTEXT_S * ALIGN_SAMPLE_RATE
    context_frames = round(ALIGN_CONTEXT_S / ALIGN_FRAME_S)
    extension = -len(audio) % window
    padded = np.pad(audio, (context, context + extension))
    windows = np.stack([padded[i:i + window + 2 * context] for i in range(0, len(audio) + extension, window)])

    chunks = []
    with torch.inference_mode():
        for i in range(0, len(windows), ALIGN_BATCH):
            emission, _ = model(torch.from_numpy(windows[i:i + ALIGN_BATCH]).to(device))
            chunks.append(emission[:, context_frames:1 - context_frames].cpu())
            report_progress((i + ALIGN_BATCH) / len(windows))
    emissions = torch.cat(chunks).reshape(-1, chunks[0].shape[-1])
    emissions = emissions[:emissions.shape[0] - round(extension / ALIGN_SAMPLE_RATE / ALIGN_FRAME_S)]
    # <star> matches anything with probability 1: it soaks up whatever isn't in the lyrics.
    return torch.cat([emissions, torch.zeros(emissions.shape[0], 1)], dim=1)


def align_lines(vocals: Path, lines: list[str]) -> list[list[dict]]:
    """Force-align lyric lines to the vocals.

    Returns, per line, one {"start": s, "end": s} per word of _line_align_words;
    untimeable lines (blank, section tags) get [].
    """
    words: list[str] = []
    spans: list[tuple[int, int]] = []
    for line in lines:
        line_words = _line_align_words(line)
        spans.append((len(words), len(words) + len(line_words)))
        words.extend(line_words)
    if not words:
        raise RuntimeError("no alignable text in the lyrics")

    stage("align", "loading alignment model ...")
    import torch
    import torchaudio

    bundle = torchaudio.pipelines.MMS_FA
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = bundle.get_model(with_star=False).to(device)  # downloads the weights on the first run
    # The raw waveform, as ctc-forced-aligner fed it: normalizing it (per window or over the
    # whole song) threw the lines of a test song off by seconds.
    model.normalize_waveform = False
    dictionary = bundle.get_dict(star=None)
    blank = dictionary["-"]
    star = len(dictionary)

    stage("align", f"aligning {len(words)} words ...")
    emissions = _emissions(model, decode(vocals, ALIGN_SAMPLE_RATE, 1)[:, 0], device)

    # A <star> before every word, as ctc-forced-aligner does: it lets the aligner skip
    # ad-libs and noise between words instead of stretching a word over them.
    targets: list[int] = []
    ranges: list[tuple[int, int]] = []  # each word's characters in `targets`
    for word in words:
        chars = [dictionary[c] for c in _romanize(word)]
        if chars:
            targets.append(star)
        ranges.append((len(targets), len(targets) + len(chars)))
        targets.extend(chars)
    if not targets:
        raise RuntimeError("no alignable text in the lyrics")
    try:
        path, _ = torchaudio.functional.forced_align(
            emissions[None], torch.tensor([targets], dtype=torch.int32), blank=blank
        )
    except RuntimeError as e:
        raise RuntimeError(f"the lyrics don't fit the song: {e}") from e

    # [label, first frame, last frame] runs of the path; the non-blank ones are the targets in order.
    segments: list[list[int]] = []
    for frame, label in enumerate(path[0].tolist()):
        if segments and segments[-1][0] == label:
            segments[-1][2] = frame
        else:
            segments.append([label, frame, frame])
    token_segments = [i for i, seg in enumerate(segments) if seg[0] != blank]

    # A word runs from its first to its last character, widened to the middle of the
    # silence on either side (to its end after the last word).
    last = max(i for i, (begin, end) in enumerate(ranges) if end > begin)
    timed: list[dict] = []
    for i, (begin, end) in enumerate(ranges):
        if begin == end:  # nothing to align ("5", "..."): pinned to the word before
            at = timed[-1]["end"] if timed else 0.0
            timed.append({"start": at, "end": at})
            continue
        first, final = token_segments[begin], token_segments[end - 1]
        start, stop = segments[first][1], segments[final][2]
        if first > 0 and segments[first - 1][0] == blank:
            start = (segments[first - 1][1] + segments[first - 1][2]) // 2
        if final + 1 < len(segments) and segments[final + 1][0] == blank:
            after = segments[final + 1]
            stop = after[2] if i == last else (after[1] + after[2]) // 2
        timed.append({"start": start * ALIGN_FRAME_S, "end": stop * ALIGN_FRAME_S})

    return [timed[begin:end] for begin, end in spans]


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


def build_lines(vocals: Path, lyrics: str) -> list[dict]:
    lines = lyrics.splitlines()
    aligned_lines = align_lines(vocals, lines)
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
    args = parser.parse_args()

    # Let a cancelled run (SIGTERM from lrcgen) unwind, so temp files get cleaned up.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    stage("init", "starting ...")

    api_key = os.environ.get("OPENAI_API_KEY") or os.environ.get("OPENROUTER_API_KEY")
    if not api_key and not args.separate_only and not args.lyrics_file:
        fail("init", "no API key: set OPENAI_API_KEY or OPENROUTER_API_KEY")
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
        lines = build_lines(vocals, lyrics)
    except Exception as e:
        fail(current, str(e) or type(e).__name__)
        return

    emit({"type": "result", "lines": lines, "rawLyrics": lyrics})


if __name__ == "__main__":
    _install_progress_hook()
    main()
