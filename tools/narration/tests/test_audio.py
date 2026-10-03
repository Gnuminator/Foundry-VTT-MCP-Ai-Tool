from __future__ import annotations

import numpy as np

from narration.audio import trim

SR = 24000


def tone(seconds: float, amp: float) -> np.ndarray:
    t = np.arange(int(SR * seconds)) / SR
    return (amp * np.sin(2 * np.pi * 200 * t)).astype(np.float32)


def test_trim_drops_click_and_static_before_speech() -> None:
    # The Danish voice's pattern: a 10 ms click, 0.8 s of low static, then speech, then static.
    click = tone(0.01, 0.4)
    static = (np.random.default_rng(1).standard_normal(int(SR * 0.8)) * 0.003).astype(np.float32)
    speech = tone(1.0, 0.5)
    tail = static[: int(SR * 0.5)]
    x = np.concatenate([np.zeros(1200, np.float32), click, static, speech, tail])
    y = trim(x, SR)
    # Kept: 80 ms before the speech, the speech, and 150 ms after it.
    assert abs(y.size / SR - (0.08 + 1.0 + 0.15)) < 0.02
    assert abs(float(y[0])) < 1e-6  # faded in from silence
    assert abs(float(y[-1])) < 1e-6  # faded out
    assert float(np.max(np.abs(y[: int(SR * 0.05)]))) < 0.01  # no click left at the start


def test_trim_keeps_quiet_speech_and_empty_input() -> None:
    x = np.concatenate([tone(0.5, 0.05), np.zeros(SR // 2, np.float32)])
    assert abs(trim(x, SR).size / SR - (0.5 + 0.15)) < 0.02
    assert trim(np.zeros(SR, np.float32), SR).size == 0
    assert trim(np.zeros(0, np.float32), SR).size == 0
