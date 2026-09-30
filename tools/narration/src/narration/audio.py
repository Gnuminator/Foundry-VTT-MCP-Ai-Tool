"""Small audio steps: trim, tempo, join, loudness, and writing the final file with ffmpeg."""

from __future__ import annotations

import shutil
import subprocess
import wave
from pathlib import Path

import numpy as np

TARGET_LUFS = -16.0  # common for spoken video and podcasts
PEAK_LIMIT = 10 ** (-1.5 / 20)  # -1.5 dBFS, held by a limiter in write_master
MAX_GAIN_DB = 20.0
OUT_RATE = 48000  # video audio


def ffmpeg() -> str:
    path = shutil.which("ffmpeg")
    if not path:
        raise RuntimeError("ffmpeg was not found on PATH (winget install Gyan.FFmpeg)")
    return path


def trim(x: np.ndarray, sr: int, rel_db: float = -40.0, pad: float = 0.08) -> np.ndarray:
    """Cut silence and breath noise at both ends; keeps ``pad`` seconds around the speech."""
    if x.size == 0:
        return x
    frame = max(1, int(sr * 0.01))
    n = x.size // frame
    if n == 0:
        return x
    rms = np.sqrt(np.mean(x[: n * frame].reshape(n, frame) ** 2, axis=1))
    floor = max(float(rms.max()) * 10 ** (rel_db / 20), 1e-4)
    loud = np.nonzero(rms > floor)[0]
    if loud.size == 0:
        return x[:0]
    start = max(0, loud[0] * frame - int(pad * sr))
    end = min(x.size, (loud[-1] + 1) * frame + int(pad * sr))
    return x[start:end]


def _pipe(x: np.ndarray, sr: int, args: list[str], out_rate: int | None = None) -> np.ndarray:
    cmd = [ffmpeg(), "-hide_banner", "-loglevel", "error", "-f", "f32le", "-ar", str(sr), "-ac", "1",
           "-i", "pipe:0", *args, "-f", "f32le", "-ac", "1"]
    if out_rate:
        cmd += ["-ar", str(out_rate)]
    cmd.append("pipe:1")
    done = subprocess.run(cmd, input=x.astype("<f4").tobytes(), capture_output=True)
    if done.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {done.stderr.decode(errors='replace')[-500:]}")
    return np.frombuffer(done.stdout, dtype="<f4").astype(np.float32)


def change_speed(x: np.ndarray, sr: int, speed: float) -> np.ndarray:
    """Slower or faster without changing the pitch (ffmpeg atempo)."""
    if abs(speed - 1.0) < 1e-3 or x.size == 0:
        return x
    if not 0.5 <= speed <= 2.0:
        raise ValueError("speed must be between 0.5 and 2.0")
    return _pipe(x, sr, ["-af", f"atempo={speed}"])


def silence(seconds: float, sr: int) -> np.ndarray:
    return np.zeros(max(0, int(round(seconds * sr))), dtype=np.float32)


def normalize(x: np.ndarray, sr: int, target: float = TARGET_LUFS) -> tuple[np.ndarray, float | None]:
    """One gain for the whole file to ``target`` LUFS. Speech peaks then pass the limit, so the
    limiter in ``write_master`` catches them (a few dB on single syllables; inaudible in tests)."""
    if x.size == 0 or not np.any(x):
        return x, None
    try:
        import pyloudnorm

        loudness = float(pyloudnorm.Meter(sr).integrated_loudness(x.astype(np.float64)))
    except ImportError:
        loudness = float(20 * np.log10(np.sqrt(np.mean(x**2)) + 1e-12)) - 0.7  # rough fallback
    gain_db = min(target - loudness, MAX_GAIN_DB) if np.isfinite(loudness) else 0.0
    gain = 10 ** (gain_db / 20)
    return (x * gain).astype(np.float32), round(loudness, 1)


def read_wav(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as w:
        sr, n, width, ch = w.getframerate(), w.getnframes(), w.getsampwidth(), w.getnchannels()
        data = w.readframes(n)
    if width != 2 or ch != 1:
        raise ValueError(f"{path}: expected 16-bit mono")
    return np.frombuffer(data, dtype="<i2").astype(np.float32) / 32768.0, sr


def write_wav16(path: Path, x: np.ndarray, sr: int) -> None:
    """Plain 16-bit mono WAV (cache clips and the Whisper check), no ffmpeg needed."""
    path.parent.mkdir(parents=True, exist_ok=True)
    pcm = (np.clip(x, -1.0, 1.0) * 32767.0).astype("<i2")
    tmp = path.with_suffix(".tmp")
    with wave.open(str(tmp), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())
    tmp.replace(path)


def write_master(path: Path, x: np.ndarray, sr: int, rate: int = OUT_RATE) -> None:
    """The final narration: 48 kHz, 24-bit WAV."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.stem + ".part.wav")
    cmd = [ffmpeg(), "-hide_banner", "-loglevel", "error", "-y", "-f", "f32le", "-ar", str(sr),
           "-ac", "1", "-i", "pipe:0", "-af",
           f"alimiter=limit={PEAK_LIMIT:.4f}:attack=5:release=50:level=false,aresample={rate}",
           "-c:a", "pcm_s24le", str(tmp)]
    done = subprocess.run(cmd, input=x.astype("<f4").tobytes(), capture_output=True)
    if done.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {done.stderr.decode(errors='replace')[-500:]}")
    tmp.replace(path)
