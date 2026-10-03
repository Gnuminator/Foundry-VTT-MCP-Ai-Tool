"""Load the speech model with fallbacks, so an unattended run after a session still finishes.

On the GPU the default is float16. When that load, or a one-second warm-up right after it, fails
(another GPU job holds the memory, a driver hiccup, a missing CUDA library), the run tries int8_float16 on the GPU (about half the memory), then int8 on the
CPU (much slower, but it finishes). A compute type given on the command line is used as is, with
no fallback.
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


def warm_up(model: Any, language: str | None) -> None:
    """Transcribe one second of silence. A GPU problem (a missing CUDA library such as
    ``cublas64_12.dll``) only shows at the first inference, after the model loaded fine."""
    import numpy as np

    segments, _info = model.transcribe(
        np.zeros(16000, dtype=np.float32), language=language or "en", beam_size=1, vad_filter=False
    )
    list(segments)


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
