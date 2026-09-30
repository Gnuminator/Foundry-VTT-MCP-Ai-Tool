"""The voices (D-081 listening test, 2026-09-30) and the engines behind them.

Danish: CoRal Roest v3 Chatterbox 500M. It has no voice parameter; a voice is cloned from a short
reference clip, and "mic" and "nic" are the model card's own sample clips (downloaded on first use).
English: Chatterbox Turbo with its built-in voice, slowed to 0.92 because the user found it fast.
A script can also clone any clip with ``voice: ref:C:\\path\\clip.wav`` (for example a later clone
of the user's own voice; read the model's terms first).

torch and chatterbox are imported only when a voice is really generated, so the rest of the tool
(and its tests) runs on plain Python.
"""

from __future__ import annotations

import hashlib
import json
import random
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

import numpy as np

ROEST_REPO = "CoRal-project/roest-v3-chatterbox-500m"
ROEST_FILES = ["*.safetensors", "*.json", "*.txt", "*.pt", "*.model"]
ROEST_SAMPLE = "audio_samples/00_{voice}_00_t0.8_p0.95_e0.5_c0.5_m0.05_r2.0.wav"


@dataclass(frozen=True)
class Voice:
    lang: str
    name: str
    engine: str  # "roest" or "turbo"
    ref: str | None  # "hf:<file in the Roest repo>", a local path, or None (built-in voice)
    speed: float = 1.0
    settings: dict[str, Any] = field(default_factory=dict, hash=False)

    def cache_id(self) -> str:
        """Everything that changes the sound, for the sentence cache key."""
        ref_id = self.ref or ""
        if self.ref and not self.ref.startswith("hf:"):
            p = Path(self.ref)
            ref_id = hashlib.sha256(p.read_bytes()).hexdigest()[:16] if p.is_file() else self.ref
        return json.dumps(
            {"engine": self.engine, "ref": ref_id, "speed": self.speed, "settings": self.settings},
            sort_keys=True,
        )


ROEST_SETTINGS = {
    "temperature": 0.8, "top_p": 0.95, "min_p": 0.05, "repetition_penalty": 2.0,
    "cfg_weight": 0.5, "exaggeration": 0.5,
}
TURBO_SETTINGS: dict[str, Any] = {}  # the listening test used the defaults

VOICES: dict[str, dict[str, Voice]] = {
    "da": {
        "mic": Voice("da", "mic", "roest", "hf:" + ROEST_SAMPLE.format(voice="mic"), 1.0, ROEST_SETTINGS),
        "nic": Voice("da", "nic", "roest", "hf:" + ROEST_SAMPLE.format(voice="nic"), 1.0, ROEST_SETTINGS),
    },
    "en": {
        "turbo": Voice("en", "turbo", "turbo", None, 0.92, TURBO_SETTINGS),
    },
}
DEFAULT_VOICE = {"da": "mic", "en": "turbo"}


def resolve_voice(lang: str, spec: str | None, speed: float | None = None) -> Voice:
    """``spec`` is a voice name, ``ref:<path>``, or None for the language default."""
    if spec and spec.lower().startswith("ref:"):
        path = Path(spec[4:].strip()).expanduser()
        if not path.is_file():
            raise ValueError(f"voice reference clip not found: {path}")
        engine, settings = ("roest", ROEST_SETTINGS) if lang == "da" else ("turbo", TURBO_SETTINGS)
        base_speed = 1.0 if lang == "da" else 0.92
        voice = Voice(lang, f"ref:{path.name}", engine, str(path), base_speed, settings)
    else:
        name = (spec or DEFAULT_VOICE[lang]).lower()
        if name not in VOICES[lang]:
            known = ", ".join(VOICES[lang])
            raise ValueError(f"unknown {lang} voice '{name}' (known: {known}, or ref:<clip.wav>)")
        voice = VOICES[lang][name]
    if speed is not None:
        voice = Voice(voice.lang, voice.name, voice.engine, voice.ref, speed, voice.settings)
    return voice


class Engine(Protocol):
    sr: int

    def generate(self, text: str, voice: Voice, seed: int) -> np.ndarray: ...


def _seed_everything(seed: int) -> None:
    import torch

    random.seed(seed)
    np.random.seed(seed % (2**32))
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


class ChatterboxEngines:
    """Loads Roest and Turbo on first use and keeps them loaded (about 4 GB of VRAM each)."""

    def __init__(self, device: str | None = None) -> None:
        self._models: dict[str, Any] = {}
        self._device = device
        self.sr = 24000

    def _device_name(self) -> str:
        if self._device:
            return self._device
        import torch

        return "cuda" if torch.cuda.is_available() else "cpu"

    def _model(self, engine: str) -> Any:
        if engine in self._models:
            return self._models[engine]
        if engine == "roest":
            from chatterbox.mtl_tts import ChatterboxMultilingualTTS
            from huggingface_hub import snapshot_download

            folder = snapshot_download(ROEST_REPO, allow_patterns=ROEST_FILES)
            model = ChatterboxMultilingualTTS.from_local(folder, device=self._device_name())
        elif engine == "turbo":
            from chatterbox.tts_turbo import ChatterboxTurboTTS

            model = ChatterboxTurboTTS.from_pretrained(device=self._device_name())
        else:
            raise ValueError(f"unknown engine {engine}")
        self._models[engine] = model
        self.sr = int(model.sr)
        return model

    def _ref_path(self, voice: Voice) -> str | None:
        if voice.ref is None:
            return None
        if voice.ref.startswith("hf:"):
            from huggingface_hub import hf_hub_download

            return hf_hub_download(ROEST_REPO, voice.ref[3:])
        return voice.ref

    def generate(self, text: str, voice: Voice, seed: int) -> np.ndarray:
        model = self._model(voice.engine)
        ref = self._ref_path(voice)
        _seed_everything(seed)
        if voice.engine == "roest":
            wav = model.generate(text, language_id=voice.lang, audio_prompt_path=ref, **voice.settings)
        else:
            wav = model.generate(text, audio_prompt_path=ref, **voice.settings)
        self.sr = int(model.sr)
        return wav.squeeze().detach().cpu().numpy().astype(np.float32)
