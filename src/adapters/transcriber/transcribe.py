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

    {"type": "stage", "stage": "demucs"|"api"|"align", "message": "..."}
    {"type": "result", "lines": [{"timestamp": <ms|null>, "text": "...",
        "words": [{"start": <ms>, "text": "..."}], "end": <ms>}], "rawLyrics": "..."}

"words" and "end" are only present on timed lines.
    {"type": "error", "stage": "init"|"demucs"|"api"|"align", "message": "..."}

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
import subprocess
import tempfile
from pathlib import Path

DEMUCS_MODEL = "htdemucs"
ALIGN_MODEL_PATH = "~/.cache/ctc_forced_aligner/model.onnx"
ALIGN_SAMPLE_RATE = 16000
SECTION_TAG_RE = re.compile(r"^\[[A-Z][A-Z ]*\]$")
DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_MODEL = "google/gemini-3.1-flash-lite"
DEFAULT_ALIGN_LANG = "rus"

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


def emit(event: dict) -> None:
    _protocol.write(json.dumps(event, ensure_ascii=False) + "\n")
    _protocol.flush()


def stage(name: str, message: str) -> None:
    print(f"[{name}] {message}", file=sys.stderr)
    emit({"type": "stage", "stage": name, "message": message})


def fail(stage_name: str, message: str) -> None:
    emit({"type": "error", "stage": stage_name, "message": message})
    sys.exit(1)


def separate_vocals(song: Path, out_root: Path) -> Path:
    vocals = out_root / DEMUCS_MODEL / song.stem / "vocals.mp3"
    if vocals.exists():
        stage("demucs", f"using cached vocals for {song.name}")
        return vocals

    stage("demucs", f"separating vocals from {song.name} ...")
    from demucs.separate import main as demucs_main

    demucs_main([
        "--two-stems", "vocals",
        "--mp3", "--mp3-bitrate", "128",
        "-n", DEMUCS_MODEL,
        "-o", str(out_root),
        str(song),
    ])
    if not vocals.exists():
        raise RuntimeError(f"demucs finished but {vocals} was not created")
    return vocals


def transcribe(vocals: Path, model: str, base_url: str, api_key: str) -> str:
    from openai import OpenAI

    audio_b64 = base64.b64encode(vocals.read_bytes()).decode("ascii")
    stage("api", f"sending {vocals.stat().st_size / 1e6:.1f} MB of vocals to {model} ...")
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
        "--base-url", default=os.environ.get("OPENAI_BASE_URL", DEFAULT_BASE_URL),
        help="OpenAI-compatible API base URL (default: $OPENAI_BASE_URL or OpenRouter)",
    )
    parser.add_argument("--model", default=DEFAULT_MODEL, help="model to use (default: %(default)s)")
    parser.add_argument(
        "--align-lang", default=DEFAULT_ALIGN_LANG,
        help="ISO 639-3 language of the lyrics for forced alignment (default: %(default)s)",
    )
    parser.add_argument(
        "--separated-dir", type=Path, default=Path("separated"),
        help="directory for demucs output, reused as cache (default: %(default)s)",
    )
    args = parser.parse_args()

    api_key = os.environ.get("OPENAI_API_KEY") or os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        fail("init", "no API key: set OPENAI_API_KEY or OPENROUTER_API_KEY")
    if not shutil.which("ffmpeg"):
        fail("init", "ffmpeg not found in PATH (required by demucs to decode audio)")
    if not args.audio.is_file():
        fail("init", f"file not found: {args.audio}")

    current = "demucs"
    try:
        vocals = separate_vocals(args.audio, args.separated_dir)
        current = "api"
        lyrics = transcribe(vocals, args.model, args.base_url, api_key)
        current = "align"
        lines = build_lines(vocals, lyrics, args.align_lang)
    except Exception as e:
        fail(current, str(e) or type(e).__name__)
        return

    emit({"type": "result", "lines": lines, "rawLyrics": lyrics})


if __name__ == "__main__":
    main()
