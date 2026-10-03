"""Load the speech model with fallbacks, so an unattended run after a session still finishes.

On the GPU the default is float16. When a probe of it (a child process that loads the model and
transcribes one second of silence, stopped after three minutes) fails or hangs (another GPU job
holds the memory, a driver hiccup, a missing CUDA library), the run tries int8_float16 on the GPU
(about half the memory), then int8 on the CPU (much slower, but it finishes). A compute type given
on the command line is used as is, with no fallback.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, TypeVar

T = TypeVar("T")


def attempts_for(device: str, compute: str, explicit: bool) -> list[tuple[str, str]]:
    """The (device, compute type) pairs to try, in order."""
    first = (device, compute)
    if explicit or device != "cuda":
        return [first]
    ladder = [first, ("cuda", "int8_float16"), ("cpu", "int8")]
    return list(dict.fromkeys(ladder))


PROBE = """
import sys
import numpy as np
from faster_whisper import WhisperModel
model = WhisperModel(sys.argv[1], device=sys.argv[2], compute_type=sys.argv[3])
segments, _ = model.transcribe(np.zeros(16000, dtype=np.float32), language=sys.argv[4],
                               beam_size=1, vad_filter=False)
list(segments)
print("probe ok")
"""


class ProbeFailed(RuntimeError):
    """The model could not load or transcribe in the probe (the message is the child's last error)."""


def probe(
    model: str,
    device: str,
    compute: str,
    language: str | None,
    timeout: float = 180.0,
    script: str | None = None,  # tests only: replaces the probe script
) -> None:
    """Load the model and transcribe one second of silence in a child process.

    A GPU problem can show only at the first inference, after the model loaded fine, and it may
    hang rather than fail (a missing ``cublas64_12.dll`` did both on this PC). A child process can
    be stopped after ``timeout`` seconds; a native call in this process cannot.
    """
    import subprocess
    import sys

    try:
        done = subprocess.run(
            [sys.executable, "-c", script or PROBE, model, device, compute, language or "en"],
            capture_output=True, text=True, timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        raise ProbeFailed(f"no answer within {timeout:.0f} s (the GPU call hung)") from None
    if done.returncode != 0 or "probe ok" not in done.stdout:
        lines = [l for l in (done.stderr or done.stdout).splitlines() if l.strip()]
        raise ProbeFailed(lines[-1] if lines else f"exit code {done.returncode}")


def load_with_fallback(
    factory: Callable[[str, str], T],
    device: str,
    compute: str,
    explicit: bool,
    log: Callable[[str], Any] = print,
) -> tuple[T, str, str, list[dict[str, str]]]:
    """Call ``factory(device, compute)`` down the ladder. Returns the engine, the device and
    compute type that worked, and the failed attempts (for run.json)."""
    failed: list[dict[str, str]] = []
    tries = attempts_for(device, compute, explicit)
    for i, (dev, comp) in enumerate(tries):
        try:
            engine = factory(dev, comp)
        except Exception as ex:  # any load failure: CUDA, memory, driver, missing library
            reason = f"{type(ex).__name__}: {str(ex).splitlines()[0][:200] if str(ex) else ''}"
            failed.append({"device": dev, "compute_type": comp, "error": reason})
            if i + 1 < len(tries):
                nxt = tries[i + 1]
                log(f"Loading the model on {dev} ({comp}) failed: {reason}. Trying {nxt[0]} ({nxt[1]}).")
                continue
            raise
        if failed:
            log(f"Model loaded on {dev} ({comp}) after {len(failed)} failed attempt(s).")
        return engine, dev, comp, failed
    raise RuntimeError("no attempts")  # unreachable: attempts_for always returns one
