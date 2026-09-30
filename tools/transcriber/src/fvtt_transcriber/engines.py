"""Transcription engines. Every engine turns 16 kHz mono float audio into ``(segments, words)``
dicts in the shape of the VoiceBench outputs, which ``session_pipeline`` reads without changes:

* segment: ``start end text avg_logprob no_speech_prob compression_ratio``
* word: ``start end word p`` (``word`` keeps the leading space of the Whisper token)
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

SAMPLE_RATE = 16000


@dataclass(slots=True)
class WhisperSettings:
    """The benchmark's best setup ("vadrobust") unless changed on the command line."""

    language: str | None = "da"
    beam_size: int = 5
    vad_filter: bool = True
    condition_on_previous_text: bool = False
    no_speech_threshold: float = 0.85
    compression_ratio_threshold: float = 2.4
    word_timestamps: bool = True
    hotwords: str | None = None
    initial_prompt: str | None = None

    def transcribe_kwargs(self) -> dict[str, Any]:
        kw: dict[str, Any] = dict(
            language=self.language,
            word_timestamps=self.word_timestamps,
            beam_size=self.beam_size,
            condition_on_previous_text=self.condition_on_previous_text,
            no_speech_threshold=self.no_speech_threshold,
            compression_ratio_threshold=self.compression_ratio_threshold,
            vad_filter=self.vad_filter,
        )
        if self.initial_prompt:
            kw["initial_prompt"] = self.initial_prompt
        if self.hotwords:
            kw["hotwords"] = self.hotwords
        return kw

    @property
    def variant(self) -> str:
        if self.hotwords:
            return "hotwords"
        if self.initial_prompt:
            return "prompt"
        return "plain"


def pick_engine_kind(model: str, requested: str) -> str:
    if requested != "auto":
        return requested
    base = Path(model.rstrip("/\\")).name.lower()
    if re.match(r"hviske-v[6-9]", base):
        return "hviske"
    if "saga" in base:
        return "saga2"
    return "whisper"


def display_name(model: str) -> str:
    return Path(model.rstrip("/\\")).name or model


class WhisperEngine:
    """faster-whisper (CTranslate2) with its built-in Silero VAD filter."""

    pseudo_words = False

    def __init__(self, model: str, device: str, compute_type: str, settings: WhisperSettings):
        from faster_whisper import WhisperModel

        self.name = display_name(model)
        self.mode = "vadrobust" if settings.vad_filter else "novad"
        self.settings = settings
        self.model = WhisperModel(model, device=device, compute_type=compute_type)

    def transcribe(self, audio: Any) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        segments, _info = self.model.transcribe(audio, **self.settings.transcribe_kwargs())
        segs: list[dict[str, Any]] = []
        words: list[dict[str, Any]] = []
        for s in segments:
            segs.append(
                dict(
                    start=s.start,
                    end=s.end,
                    text=s.text,
                    avg_logprob=s.avg_logprob,
                    no_speech_prob=s.no_speech_prob,
                    compression_ratio=s.compression_ratio,
                )
            )
            for w in s.words or []:
                words.append(dict(start=w.start, end=w.end, word=w.word, p=w.probability))
        return segs, words


def make_chunks(audio: Any, max_chunk_s: float = 28.0) -> list[tuple[int, int]]:
    """Silero chunks (bench3 recipe): merged when the gap is under 1.5 s and the result at most
    ``max_chunk_s``, chunks under 0.5 s dropped."""
    from faster_whisper.vad import VadOptions, get_speech_timestamps

    vad = VadOptions(
        threshold=0.4, min_speech_duration_ms=300, min_silence_duration_ms=500, speech_pad_ms=400
    )
    merged: list[list[int]] = []
    for t in get_speech_timestamps(audio, vad, sampling_rate=SAMPLE_RATE):
        if (
            merged
            and (t["start"] - merged[-1][1]) < 1.5 * SAMPLE_RATE
            and (t["end"] - merged[-1][0]) <= max_chunk_s * SAMPLE_RATE
        ):
            merged[-1][1] = t["end"]
        else:
            merged.append([t["start"], t["end"]])
    return [(s, e) for s, e in merged if (e - s) >= 0.5 * SAMPLE_RATE]


def _resolve_model_dir(model: str) -> str:
    if Path(model).is_dir():
        return model
    from huggingface_hub import snapshot_download

    return snapshot_download(model)  # token comes from HF_TOKEN_PATH when the repo is gated


class ChunkEngine:
    """Non-Whisper models without timestamps (hviske-v6, saga-2-m): Silero chunks are transcribed in
    batches, the chunk offsets are the timestamps and the words are spread evenly inside a chunk
    (``p`` is 1.0, ``pseudo_words`` is set in the JSON). Needs the image built with extras."""

    mode = "chunk"
    pseudo_words = True

    def __init__(self, model: str, kind: str, device: str = "cuda", batch: int = 8):
        self.name = display_name(model)
        self.kind = kind
        self.batch = batch
        model_dir = _resolve_model_dir(model)
        sys.path.insert(0, model_dir)
        if kind == "hviske":
            import torch
            from processing_whisper_qwen import HviskeASR  # type: ignore[import-not-found]

            self._asr = HviskeASR.from_pretrained(model_dir, device=device, dtype=torch.bfloat16)
        else:  # saga2: UNVERIFIED, written from the model card (gated model, weights not tested)
            from saga2 import load  # type: ignore[import-not-found]

            self._asr = load(model_dir)

    def _batch(self, waves: list[Any]) -> list[str]:
        if self.kind == "hviske":
            return list(self._asr.transcribe_batch(waves))
        out = self._asr.transcribe(waves, batch_size=self.batch)
        return [out] if isinstance(out, str) else list(out)

    def transcribe(self, audio: Any) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        chunks = make_chunks(audio)
        texts: list[str] = []
        for i in range(0, len(chunks), self.batch):
            texts += self._batch([audio[s:e] for s, e in chunks[i : i + self.batch]])
        segs: list[dict[str, Any]] = []
        words: list[dict[str, Any]] = []
        for (cs, ce), text in zip(chunks, texts):
            text = text.strip()
            if not text:
                continue
            st, en = cs / SAMPLE_RATE, ce / SAMPLE_RATE
            segs.append(
                dict(
                    start=st,
                    end=en,
                    text=text,
                    avg_logprob=0.0,
                    no_speech_prob=0.0,
                    compression_ratio=0.0,
                )
            )
            toks = text.split()
            for k, w in enumerate(toks):
                words.append(
                    dict(
                        start=st + (en - st) * k / len(toks),
                        end=st + (en - st) * (k + 1) / len(toks),
                        word=(" " if k else "") + w,
                        p=1.0,
                    )
                )
        return segs, words
