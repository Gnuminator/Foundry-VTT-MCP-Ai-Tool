# syntax=docker/dockerfile:1
# CPU image for the session pipeline (filter, merge, name-fix). No dependencies beyond Python.
# Build:  docker build -t fvtt-session-pipeline tools/session-pipeline
# Run:    docker run --rm -v <session folder>:/session fvtt-session-pipeline merge /session/transcripts/json --out /session/timeline
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /opt/session-pipeline
COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install .

WORKDIR /work
ENTRYPOINT ["session-pipeline"]
CMD ["--help"]
