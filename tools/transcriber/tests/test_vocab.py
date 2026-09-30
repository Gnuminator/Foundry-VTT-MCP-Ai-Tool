from __future__ import annotations

from pathlib import Path

from fvtt_transcriber.vocab import load_terms_text, parse_terms


def test_commas_lines_comments_and_headings() -> None:
    text = "# my terms\n=== Places ===\nAlpha, Beta\n\nGamma\nAlpha\n"
    assert parse_terms(text) == ["Alpha", "Beta", "Gamma"]


def test_joined_like_a_whisper_prompt(tmp_path: Path) -> None:
    f = tmp_path / "vocab.txt"
    f.write_text("Alpha, Beta,Gamma\n", encoding="utf-8")
    assert load_terms_text(f) == "Alpha, Beta, Gamma"
