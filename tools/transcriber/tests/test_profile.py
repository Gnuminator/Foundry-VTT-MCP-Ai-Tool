"""The default profile and the hotwords budget. Synthetic names only, no model, no GPU."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from fvtt_transcriber.cli import build_parser
from fvtt_transcriber.engines import WhisperEngine, WhisperSettings
from fvtt_transcriber.vocab import (
    DEFAULT_HOTWORD_TOKENS,
    HOTWORD_TOKEN_LIMIT,
    estimate_tokens,
    fit_terms,
    hotwords_string,
    load_hotword_terms,
)


def test_default_profile_is_the_benchmark_pick() -> None:
    a = build_parser().parse_args(["in"])
    assert a.model == "large-v3-turbo"
    assert a.language == "da"
    assert a.no_vad is False  # vad_filter on
    assert a.condition_on_previous_text is False
    assert a.no_speech_threshold == 0.85
    assert a.compression_ratio_threshold == 2.4
    assert a.beam_size == 5
    assert a.hotwords is None and a.prompt is None
    assert a.hotwords_max_tokens == DEFAULT_HOTWORD_TOKENS == 200
    s = WhisperSettings()
    assert (s.language, s.vad_filter, s.condition_on_previous_text, s.word_timestamps) == ("da", True, False, True)


def test_other_settings_stay_selectable() -> None:
    a = build_parser().parse_args(
        ["in", "--model", "large-v3", "--language", "auto", "--no-vad", "--condition-on-previous-text",
         "--no-speech-threshold", "0.6", "--beam-size", "1", "--hotwords-max-tokens", "120"]
    )
    assert (a.model, a.language, a.no_vad, a.condition_on_previous_text) == ("large-v3", "auto", True, True)
    assert (a.no_speech_threshold, a.beam_size, a.hotwords_max_tokens) == (0.6, 1, 120)


def test_names_and_hotwords_are_the_same_option(tmp_path: Path) -> None:
    f = tmp_path / "names.txt"
    assert build_parser().parse_args(["in", "--names", str(f)]).hotwords == f
    assert build_parser().parse_args(["in", "--hotwords", str(f)]).hotwords == f


def test_kwargs_use_hotwords_and_no_prompt_by_default() -> None:
    kw = WhisperSettings().transcribe_kwargs()
    assert "hotwords" not in kw and "initial_prompt" not in kw
    kw = WhisperSettings(hotwords="Aa, Bb").transcribe_kwargs()
    assert kw["hotwords"] == "Aa, Bb" and "initial_prompt" not in kw
    assert kw["vad_filter"] is True and kw["condition_on_previous_text"] is False
    assert WhisperSettings(hotwords="Aa").variant == "hotwords"


def test_file_order_is_the_priority(tmp_path: Path) -> None:
    f = tmp_path / "names.txt"
    f.write_text("# header\nVera Hollis\nGus\n\nOld Marrow, Wolf\n", encoding="utf-8")
    assert load_hotword_terms(f) == ["Vera Hollis", "Gus", "Old Marrow", "Wolf"]


def test_fit_keeps_the_first_names_within_the_budget() -> None:
    terms = [f"Name{i:03d}" for i in range(200)]
    kept, dropped = fit_terms(terms, 100)
    assert kept == terms[: len(kept)] and dropped == terms[len(kept) :]
    assert 0 < len(kept) < 200
    assert estimate_tokens(" " + hotwords_string(kept)) <= 100
    assert estimate_tokens(" " + hotwords_string(terms[: len(kept) + 1])) > 100


def test_a_long_name_is_dropped_but_shorter_ones_after_it_still_fit() -> None:
    kept, dropped = fit_terms(["Aa", "Bb" * 60, "Cc"], 20)
    assert kept == ["Aa", "Cc"] and dropped == ["Bb" * 60]


def test_budget_is_clamped_to_the_faster_whisper_limit() -> None:
    terms = [f"Name{i:03d}" for i in range(400)]
    kept, _ = fit_terms(terms, 10_000, count=lambda s: len(s.split(",")) * 4)
    assert len(kept) * 4 <= HOTWORD_TOKEN_LIMIT  # never over 223 tokens, whatever was asked


def test_exact_counter_decides_when_given() -> None:
    kept, dropped = fit_terms(["a", "b", "c", "d"], 6, count=lambda s: len(s.split(",")) * 2)
    assert kept == ["a", "b", "c"] and dropped == ["d"]


def test_nothing_fits_gives_an_empty_list() -> None:
    assert fit_terms(["Supercalifragilistic" * 10], 5) == ([], ["Supercalifragilistic" * 10])


class _FakeEncoding:
    def __init__(self, ids: list[int]) -> None:
        self.ids = ids


class _FakeTokenizer:
    """Three tokens per character run between commas plus one for the comma."""

    def encode(self, text: str, add_special_tokens: bool = True) -> _FakeEncoding:
        assert add_special_tokens is False
        return _FakeEncoding(list(range(len(text.replace(",", " ,").split()) * 2)))


def test_engine_refits_with_the_models_own_tokenizer() -> None:
    engine = WhisperEngine.__new__(WhisperEngine)
    engine.settings = WhisperSettings(hotword_terms=("Aa", "Bb", "Cc", "Dd"), hotword_max_tokens=6)
    engine.model = SimpleNamespace(hf_tokenizer=_FakeTokenizer())
    engine._fit_hotwords()
    assert engine.settings.hotwords == "Aa, Bb"
    assert engine.settings.hotwords_dropped == ("Cc", "Dd")
