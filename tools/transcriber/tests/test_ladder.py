from __future__ import annotations

import pytest

from fvtt_transcriber.ladder import attempts_for, load_with_fallback


def test_attempts_on_the_gpu_fall_back_to_int8_then_cpu() -> None:
    assert attempts_for("cuda", "float16", explicit=False) == [
        ("cuda", "float16"),
        ("cuda", "int8_float16"),
        ("cpu", "int8"),
    ]


def test_no_fallback_for_an_explicit_compute_type_or_the_cpu() -> None:
    assert attempts_for("cuda", "float16", explicit=True) == [("cuda", "float16")]
    assert attempts_for("cpu", "int8", explicit=False) == [("cpu", "int8")]


def test_first_success_is_used_and_failures_are_reported() -> None:
    calls: list[tuple[str, str]] = []
    logs: list[str] = []

    def factory(dev: str, comp: str) -> str:
        calls.append((dev, comp))
        if comp == "float16":
            raise RuntimeError("CUDA failed with error out of memory\nmore detail")
        return f"engine-{dev}-{comp}"

    engine, dev, comp, failed = load_with_fallback(factory, "cuda", "float16", False, logs.append)
    assert engine == "engine-cuda-int8_float16"
    assert (dev, comp) == ("cuda", "int8_float16")
    assert failed == [{"device": "cuda", "compute_type": "float16",
                       "error": "RuntimeError: CUDA failed with error out of memory"}]
    assert calls == [("cuda", "float16"), ("cuda", "int8_float16")]
    assert any("Trying cuda (int8_float16)" in m for m in logs)


def test_all_attempts_failing_raises_the_last_error() -> None:
    def factory(dev: str, comp: str) -> str:
        raise OSError(f"no {dev}")

    with pytest.raises(OSError, match="no cpu"):
        load_with_fallback(factory, "cuda", "float16", False, lambda _m: None)


def test_explicit_compute_type_failure_is_not_retried() -> None:
    calls: list[str] = []

    def factory(dev: str, comp: str) -> str:
        calls.append(comp)
        raise RuntimeError("bad")

    with pytest.raises(RuntimeError):
        load_with_fallback(factory, "cuda", "int8", True, lambda _m: None)
    assert calls == ["int8"]


def test_probe_reports_the_child_error() -> None:
    from fvtt_transcriber.ladder import ProbeFailed, probe

    script = (
        "import sys; print('Traceback', file=sys.stderr); "
        "print('RuntimeError: Library cublas64_12.dll is not found', file=sys.stderr); sys.exit(1)"
    )
    with pytest.raises(ProbeFailed, match="cublas64_12.dll"):
        probe("m", "cuda", "float16", "da", script=script)


def test_probe_stops_a_hanging_child() -> None:
    from fvtt_transcriber.ladder import ProbeFailed, probe

    with pytest.raises(ProbeFailed, match="no answer within 2 s"):
        probe("m", "cuda", "float16", "da", timeout=2, script="import time; time.sleep(30)")


def test_probe_passes_its_arguments_and_needs_the_ok_line() -> None:
    from fvtt_transcriber.ladder import ProbeFailed, probe

    ok = "import sys; assert sys.argv[1:] == ['m', 'cuda', 'int8_float16', 'da']; print('probe ok')"
    probe("m", "cuda", "int8_float16", "da", script=ok)
    with pytest.raises(ProbeFailed):
        probe("m", "cuda", "float16", None, script="print('something else')")
