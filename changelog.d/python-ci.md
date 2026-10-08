### Fixes

- **Python tests in CI (D-109):** a new `python-tests` job runs the 19 test files of the Python tools under `tools/` (narration, session notes, session pipeline, transcriber; 218 tests) on Python 3.12 with pytest, numpy and ffmpeg. No model runs: the model packages are imported lazily and fakes stand in. Every `tools/<name>/` with a `pyproject.toml` and a `tests/` folder is picked up by itself.
