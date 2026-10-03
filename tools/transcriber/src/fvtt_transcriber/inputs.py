"""Find the per-speaker audio files of a session and name the speakers.

Three sources are understood:

* a Craig recording, as the ``.zip`` or unpacked: ``1-anna_0.flac`` gives ``anna``,
* our own Discord recorder (``packages/discord-bot``, a folder with ``raw/session.json``):
  ``1-anna_2.ogg`` gives ``anna_2``; it never adds Craig's ``_0``, so a user name that ends in
  ``_`` and a number keeps it,
* a LiveKit recording folder: ``<identity>__<source>__<trackSid>.ogg`` gives ``<identity>``,
* the benchmark style ``S3__anna.wav`` (a label, two underscores, the speaker): the speaker is
  the last part and the label is kept in the output file name, which is what
  ``session_pipeline.model.track_id_from_name`` expects.

Anything else uses the file name without extension as the speaker.
"""

from __future__ import annotations

import re
import unicodedata
import zipfile
from dataclasses import dataclass
from pathlib import Path

# webm and mp4 are left out on purpose: LiveKit writes camera video to them, audio goes to ogg.
AUDIO_EXTENSIONS = frozenset(
    {".wav", ".flac", ".ogg", ".oga", ".opus", ".mp3", ".m4a", ".aac", ".wma"}
)
# Folders this tool (and the pipeline) write into; never read them back as input.
SKIP_DIRS = frozenset({"transcripts", "timeline", "out", "__macosx"})

_CRAIG = re.compile(r"^\d+-(?P<name>.+?)(?:_\d+)?$")


@dataclass(frozen=True, slots=True)
class TrackInput:
    """One audio file and the speaker it belongs to."""

    speaker: str
    label: str | None
    path: Path

    @property
    def output_stem(self) -> str:
        return f"{self.label}__{self.speaker}" if self.label else self.speaker


def slug(text: str) -> str:
    """Lower case, NFC, anything but letters, digits, dot, dash and underscore becomes ``_``."""
    text = unicodedata.normalize("NFC", text.strip().lower())
    text = re.sub(r"[^\w.-]+", "_", text).strip("_.-")
    return text or "speaker"


def parse_track_name(stem: str, own_recorder: bool = False) -> tuple[str | None, str]:
    """Return ``(label, speaker)`` for a file name without extension. ``own_recorder``: the file
    comes from our Discord recorder, so ``<n>-<username>`` without Craig's ``_0`` suffix."""
    if "__" in stem:
        parts = stem.split("__")
        if len(parts) >= 3:  # LiveKit: identity__source__trackSid
            return None, slug(parts[0])
        return slug(parts[0]), slug(parts[1])  # benchmark: S3__speaker
    if own_recorder:
        m = re.match(r"^\d+-(?P<name>.+)$", stem)
        if m:
            return None, slug(m.group("name"))
    m = _CRAIG.match(stem)
    if m:
        return None, slug(m.group("name"))
    return None, slug(stem)


def extract_craig_zip(zip_path: Path, dest: Path) -> list[Path]:
    """Unpack the audio members of a Craig zip (flattened, names sanitised) into ``dest``."""
    dest.mkdir(parents=True, exist_ok=True)
    out: list[Path] = []
    with zipfile.ZipFile(zip_path) as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            name = Path(info.filename).name  # flatten: no path traversal
            if Path(name).suffix.lower() not in AUDIO_EXTENSIONS:
                continue
            target = dest / name
            with zf.open(info) as src, open(target, "wb") as dst:
                while chunk := src.read(1 << 20):
                    dst.write(chunk)
            out.append(target)
    return sorted(out)


def _audio_files(folder: Path) -> list[Path]:
    found: list[Path] = []
    for p in sorted(folder.rglob("*")):
        if not p.is_file() or p.suffix.lower() not in AUDIO_EXTENSIONS:
            continue
        if any(part.lower() in SKIP_DIRS for part in p.relative_to(folder).parts[:-1]):
            continue
        found.append(p)
    return found


def collect_inputs(source: Path, scratch: Path) -> list[TrackInput]:
    """List the tracks of ``source`` (a folder, a Craig zip, or one audio file).

    A folder without audio but with exactly one ``.zip`` is treated as a Craig download.
    Two files for one speaker are kept: the later ones get ``-2``, ``-3`` and so on.
    """
    if not source.exists():
        raise FileNotFoundError(f"input not found: {source}")
    own_recorder = False
    if source.is_file() and source.suffix.lower() == ".zip":
        files = extract_craig_zip(source, scratch)
    elif source.is_file():
        files = [source]
    else:
        own_recorder = (source / "raw" / "session.json").is_file()
        files = _audio_files(source)
        if not files:
            zips = sorted(source.glob("*.zip"))
            if len(zips) == 1:
                files = extract_craig_zip(zips[0], scratch)
    if not files:
        raise FileNotFoundError(f"no audio files ({', '.join(sorted(AUDIO_EXTENSIONS))}) in {source}")

    tracks: list[TrackInput] = []
    seen: dict[tuple[str | None, str], int] = {}
    for f in files:
        label, speaker = parse_track_name(f.stem, own_recorder)
        n = seen.get((label, speaker), 0) + 1
        seen[(label, speaker)] = n
        tracks.append(TrackInput(speaker if n == 1 else f"{speaker}-{n}", label, f))
    return tracks
