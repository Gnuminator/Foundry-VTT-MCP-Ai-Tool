"""Optional GPU memory peak tracking (needs nvidia-ml-py and a visible GPU; otherwise all zero)."""

from __future__ import annotations

import threading
import time


class VramMonitor:
    def __init__(self) -> None:
        self._handle = None
        self._peak = 0
        self._stop = threading.Event()
        self.base = 0
        try:
            import pynvml

            pynvml.nvmlInit()
            self._nvml = pynvml
            self._handle = pynvml.nvmlDeviceGetHandleByIndex(0)
            self.base = self._used()
            threading.Thread(target=self._loop, daemon=True).start()
        except Exception:  # no GPU, no NVML, or no package: VRAM figures stay 0
            self._handle = None

    def _used(self) -> int:
        return int(self._nvml.nvmlDeviceGetMemoryInfo(self._handle).used)

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                self._peak = max(self._peak, self._used())
            except Exception:
                return
            time.sleep(0.05)

    def reset_peak(self) -> None:
        self._peak = 0

    @property
    def peak_mb(self) -> float:
        return self._peak / 2**20

    @property
    def base_mb(self) -> float:
        return self.base / 2**20

    def used_mb(self) -> float:
        return self._used() / 2**20 if self._handle else 0.0

    def close(self) -> None:
        self._stop.set()
