"""``narration make <script>``: voice a narration script (Danish or English) for the GM videos.

``narration list <script>`` shows the numbered sentences and their spoken form (no GPU).
``narration retake <script> N [N ...]`` makes a new take of sentence N and renders again.
``narration voices`` lists the voices.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from .check import transcribe_folder, whisper_available
from .render import Renderer
from .script import Script, load_lexicon, parse_script
from .voices import DEFAULT_VOICE, VOICES, Voice, resolve_voice

TOOL_DIR = Path(__file__).resolve().parents[2]
_ENGINES: object | None = None


def out_root() -> Path:
    root = os.environ.get("NARRATION_OUT_DIR")
    return Path(root) if root else Path.home() / "Documents" / "FoundryNarration"


def lexicon_for(script_path: Path, lang: str) -> dict[str, str]:
    """The shared list in tools/narration/lexicon, then ``lexicon.<lang>.txt`` next to the script."""
    words = load_lexicon(TOOL_DIR / "lexicon" / f"{lang}.txt")
    words.update(load_lexicon(script_path.parent / f"lexicon.{lang}.txt"))
    return words


def load(path_text: str, voice_spec: str | None, speed: float | None) -> tuple[Script, Voice]:
    path = Path(path_text)
    if not path.is_file():
        raise SystemExit(f"Script not found: {path}")
    first = parse_script(path)
    script = parse_script(path, lexicon_for(path, first.lang))
    voice = resolve_voice(script.lang, voice_spec or script.voice, speed if speed else script.speed)
    return script, voice


def renderer(script: Script, voice: Voice, args: argparse.Namespace) -> Renderer:
    out = Path(args.out) / script.name if args.out else out_root() / script.name

    def engines() -> object:
        # One instance per run, so several scripts share the loaded models.
        global _ENGINES
        if _ENGINES is None:
            from .voices import ChatterboxEngines

            _ENGINES = ChatterboxEngines()
        return _ENGINES

    return Renderer(script, voice, out, engines, transcribe_folder,  # type: ignore[arg-type]
                    retakes=args.retakes)


def make(script: Script, voice: Voice, args: argparse.Namespace) -> int:
    for w in script.warnings:
        print(f"Warning: {w}")
    if not script.sentences:
        return 1
    reason = "" if args.no_check else whisper_available()
    check = not args.no_check and not reason
    if reason:
        print(f"Listening check skipped: {reason}.")
    r = renderer(script, voice, args)
    print(f"{script.name}: {len(script.sentences)} sentences, voice {voice.name} ({voice.engine},"
          f" speed {voice.speed}) -> {r.out}")
    result = r.run(check=check, check_skipped=reason)
    minutes, seconds = divmod(result.duration, 60)
    print(f"Done: {int(minutes)}:{seconds:04.1f} of narration; {result.voiced} clip(s) voiced,"
          f" {result.checked} checked, {result.retaken} retaken.")
    for f in result.flagged:
        print(f"  Listen to sentence {f['index']} (take {f['take']}): {f['reason']}")
        print(f"    script: {f['spoken']}")
        print(f"    heard:  {f['heard']}")
    if result.flagged:
        print("  A new take: narration retake <script> N; or fix the wording or the lexicon.")
    for path in result.files:
        print(f"  {path}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="narration", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)

    def common(p: argparse.ArgumentParser) -> None:
        p.add_argument("--voice", help="voice name, or ref:<clip.wav> to clone a clip")
        p.add_argument("--speed", type=float, help="tempo, 0.5 to 2.0 (English default 0.92)")
        p.add_argument("--out", help="output root (default: Documents\\FoundryNarration)")
        p.add_argument("--retakes", type=int, default=2, help="automatic new takes per failing sentence")
        p.add_argument("--no-check", action="store_true", help="skip the Whisper listening check")

    mk = sub.add_parser("make", help="voice one or more scripts")
    mk.add_argument("scripts", nargs="+")
    common(mk)
    rt = sub.add_parser("retake", help="a new take of some sentences, then render again")
    rt.add_argument("script")
    rt.add_argument("sentences", nargs="+", help="sentence numbers, or N:T to go back to take T")
    common(rt)
    ls = sub.add_parser("list", help="show the numbered sentences (no GPU)")
    ls.add_argument("script")
    ls.add_argument("--voice")
    ls.add_argument("--speed", type=float)
    sub.add_parser("voices", help="list the voices")
    args = parser.parse_args(argv)

    try:
        if args.cmd == "voices":
            for lang, voices in VOICES.items():
                for name, v in voices.items():
                    mark = " (default)" if DEFAULT_VOICE[lang] == name else ""
                    print(f"{lang}  {name:6} {v.engine:6} speed {v.speed}{mark}")
            print("Any language: voice: ref:C:\\path\\clip.wav clones a 5 to 15 s clip.")
            return 0
        if args.cmd == "list":
            script, voice = load(args.script, args.voice, args.speed)
            print(f"{script.name}: {script.lang}, voice {voice.name}, {len(script.sentences)} sentences")
            for s in script.sentences:
                print(f"{s.index:4}  {s.shown}")
                if s.spoken != s.shown:
                    print(f"      says: {s.spoken}")
            for w in script.warnings:
                print(f"Warning: {w}")
            return 0
        if args.cmd == "retake":
            script, voice = load(args.script, args.voice, args.speed)
            r = renderer(script, voice, args)
            for token in args.sentences:
                index_text, _, take_text = token.partition(":")
                index = int(index_text)
                if not 1 <= index <= len(script.sentences):
                    raise SystemExit(f"No sentence {index} (the script has {len(script.sentences)}).")
                r.select(index, int(take_text) if take_text else None)
            return make(script, voice, args)
        code = 0
        for path in args.scripts:
            script, voice = load(path, args.voice, args.speed)
            code = max(code, make(script, voice, args))
        return code
    except (ValueError, RuntimeError) as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
