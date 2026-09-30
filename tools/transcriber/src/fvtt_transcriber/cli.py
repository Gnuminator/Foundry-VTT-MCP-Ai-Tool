"""Command line: ``transcribe <session folder or Craig zip> [--out DIR] [--model NAME]``."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

from fvtt_transcriber import __version__
from fvtt_transcriber.inputs import TrackInput, collect_inputs
from fvtt_transcriber.vocab import (
    DEFAULT_HOTWORD_TOKENS,
    HOTWORD_TOKEN_LIMIT,
    fit_terms,
    hotwords_string,
    load_hotword_terms,
    load_terms_text,
)

SAMPLE_RATE = 16000


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="transcribe",
        description="Transcribe one audio file per speaker into one JSON per speaker "
        "(the shape session-pipeline reads).",
    )
    p.add_argument("input", type=Path, help="folder of per-speaker audio, a Craig .zip, or one file")
    p.add_argument(
        "--out",
        type=Path,
        help="output folder (default: <input folder>/transcripts); JSON goes to <out>/json",
    )
    p.add_argument("--model", default="large-v3-turbo", help="model name, Hugging Face id or folder")
    p.add_argument(
        "--engine",
        choices=["auto", "whisper", "hviske", "saga2"],
        default="auto",
        help="auto picks hviske for hviske-v6 and newer, saga2 for saga models, else whisper",
    )
    p.add_argument("--language", default="da", help="language code, or 'auto' to detect")
    p.add_argument("--device", default="auto", help="auto, cuda or cpu")
    p.add_argument("--compute-type", default=None, help="default float16 on cuda, int8 on cpu")
    p.add_argument(
        "--names",
        "--hotwords",
        dest="hotwords",
        type=Path,
        help="names file (one per line, most important first; commas, # comments and === headings "
        "also work), passed to Whisper as hotwords; cut to --hotwords-max-tokens",
    )
    p.add_argument(
        "--hotwords-max-tokens",
        type=int,
        default=DEFAULT_HOTWORD_TOKENS,
        help=f"token budget for the hotwords (default {DEFAULT_HOTWORD_TOKENS}, hard limit "
        f"{HOTWORD_TOKEN_LIMIT}: faster-whisper cuts the prompt there)",
    )
    p.add_argument("--prompt", type=Path, help="vocabulary file, passed to Whisper as initial prompt")
    p.add_argument("--no-vad", action="store_true", help="turn the Silero VAD filter off")
    p.add_argument("--beam-size", type=int, default=5)
    p.add_argument("--no-speech-threshold", type=float, default=0.85)
    p.add_argument("--compression-ratio-threshold", type=float, default=2.4)
    p.add_argument(
        "--condition-on-previous-text",
        action="store_true",
        help="off by default (it makes Whisper loop on long tracks)",
    )
    p.add_argument("--batch", type=int, default=8, help="chunk batch size (hviske and saga2 only)")
    p.add_argument("--force", action="store_true", help="redo tracks that already have a JSON")
    p.add_argument("--dry-run", action="store_true", help="list the tracks and stop")
    p.add_argument("--version", action="version", version=f"transcribe {__version__}")
    return p


def _default_out(source: Path) -> Path:
    return (source if source.is_dir() else source.parent) / "transcripts"


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    tmp = path.with_suffix(".tmp")  # not *.json, so a half-written file is never read
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    os.replace(tmp, path)


def _pick_device(requested: str) -> str:
    if requested != "auto":
        return requested
    try:
        import ctranslate2

        return "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
    except Exception:
        return "cpu"


def run(args: argparse.Namespace) -> int:
    scratch = Path(tempfile.mkdtemp(prefix="transcribe-"))
    try:
        tracks = collect_inputs(args.input, scratch)
        out_dir = args.out or _default_out(args.input)
        json_dir = out_dir / "json"
        label = args.input.stem if args.input.is_file() else args.input.name
        print(f"{len(tracks)} track(s) from {args.input}:")
        for t in tracks:
            print(f"  {t.path.name} -> {t.output_stem}.json")
        if args.dry_run:
            return 0
        json_dir.mkdir(parents=True, exist_ok=True)
        todo = [t for t in tracks if args.force or not (json_dir / f"{t.output_stem}.json").exists()]
        if not todo:
            print("Nothing to do (all tracks have a JSON; use --force to redo).")
            return 0
        return _transcribe(args, todo, json_dir, out_dir, label)
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


def _transcribe(
    args: argparse.Namespace, todo: list[TrackInput], json_dir: Path, out_dir: Path, label: str
) -> int:
    from faster_whisper.audio import decode_audio

    from fvtt_transcriber.engines import (
        ChunkEngine,
        WhisperEngine,
        WhisperSettings,
        pick_engine_kind,
    )
    from fvtt_transcriber.gpu import VramMonitor

    kind = pick_engine_kind(args.model, args.engine)
    device = _pick_device(args.device)
    compute = args.compute_type or ("float16" if device == "cuda" else "int8")
    vram = VramMonitor()
    t0 = time.time()
    hotword_terms = load_hotword_terms(args.hotwords) if args.hotwords else []
    if kind == "whisper":
        settings = WhisperSettings(
            language=None if args.language == "auto" else args.language,
            beam_size=args.beam_size,
            vad_filter=not args.no_vad,
            condition_on_previous_text=args.condition_on_previous_text,
            no_speech_threshold=args.no_speech_threshold,
            compression_ratio_threshold=args.compression_ratio_threshold,
            hotwords=hotwords_string(fit_terms(hotword_terms, args.hotwords_max_tokens)[0]) or None,
            initial_prompt=load_terms_text(args.prompt) if args.prompt else None,
            hotword_terms=tuple(hotword_terms),
            hotword_max_tokens=args.hotwords_max_tokens,
        )
        engine: Any = WhisperEngine(args.model, device, compute, settings)
        variant = settings.variant
        settings_dump: dict[str, Any] = {
            k: getattr(settings, k)
            for k in (
                "language",
                "beam_size",
                "vad_filter",
                "condition_on_previous_text",
                "no_speech_threshold",
                "compression_ratio_threshold",
                "word_timestamps",
            )
        }
        settings_dump["compute_type"] = compute
        if hotword_terms:
            kept = len([t for t in (settings.hotwords or "").split(", ") if t])
            settings_dump["hotwords"] = dict(
                terms=len(hotword_terms),
                kept=kept,
                dropped=len(settings.hotwords_dropped),
                max_tokens=settings.hotword_max_tokens,
            )
            print(
                f"hotwords: {kept} of {len(hotword_terms)} names fit the {settings.hotword_max_tokens} "
                f"token budget" + (f"; dropped the last {len(settings.hotwords_dropped)}" if settings.hotwords_dropped else ""),
                flush=True,
            )
    else:
        if args.hotwords or args.prompt:
            print(f"note: {kind} does not take hotwords or a prompt; ignoring them", file=sys.stderr)
        engine = ChunkEngine(args.model, kind, device, args.batch)
        variant = "plain"
        settings_dump = {"batch": args.batch, "engine": kind}
    load_s = time.time() - t0
    after_load = vram.used_mb()
    print(f"model {engine.name} ({kind}, {device}, {compute}) loaded in {load_s:.1f} s", flush=True)

    summary: list[dict[str, Any]] = []
    for t in todo:
        audio = decode_audio(str(t.path), sampling_rate=SAMPLE_RATE)
        vram.reset_peak()
        ts = time.time()
        segs, words = engine.transcribe(audio)
        elapsed = time.time() - ts
        payload: dict[str, Any] = dict(
            engine=f"{engine.name}__{engine.mode}",
            variant=variant,
            slice=t.label or label or "FULL",
            speaker=t.speaker,
            seconds=elapsed,
            audio_s=len(audio) / SAMPLE_RATE,
            vram_peak_mb=vram.peak_mb,
            vram_base_mb=vram.base_mb,
            vram_after_load_mb=after_load,
            load_s=load_s,
            segments=segs,
            words=words,
            settings=settings_dump,
        )
        if engine.pseudo_words:
            payload["pseudo_words"] = True
        _write_json(json_dir / f"{t.output_stem}.json", payload)
        summary.append(
            dict(speaker=t.speaker, file=t.path.name, seconds=round(elapsed, 1), words=len(words),
                 audio_s=round(len(audio) / SAMPLE_RATE, 1))
        )
        print(f"{engine.name} {engine.mode} {variant} {t.output_stem} {elapsed:.1f} s {len(words)} words",
              flush=True)
    vram.close()
    _write_json(
        out_dir / "run.json",
        dict(tool=f"fvtt-transcriber {__version__}", model=args.model, engine=kind, device=device,
             variant=variant, settings=settings_dump, tracks=summary),
    )
    print(f"Wrote {len(summary)} JSON file(s) to {json_dir}")
    return 0


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return run(args)
    except FileNotFoundError as ex:
        print(f"error: {ex}", file=sys.stderr)
        return 2
