# syntax=docker/dockerfile:1
# GPU transcriber. CUDA 12.8 + cuDNN 9 runtime: Blackwell (RTX 50 series, sm_120) needs CUDA 12.8 builds.
# Build:  docker build -t fvtt-transcriber tools/transcriber
#         docker build --build-arg WITH_TRANSFORMERS=1 -t fvtt-transcriber:extras tools/transcriber
FROM nvidia/cuda:12.8.1-cudnn-runtime-ubuntu24.04

ARG WITH_TRANSFORMERS=0

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/cache/huggingface \
    HF_HUB_DISABLE_TELEMETRY=1 \
    HF_TOKEN_PATH=/run/secrets/hf_token \
    PATH=/opt/venv/bin:$PATH

# Ubuntu 24.04 ships Python 3.12.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv \
 && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /opt/venv

WORKDIR /opt/transcriber
COPY requirements.txt requirements-extras.txt ./
RUN pip install -r requirements.txt
# Optional extras for non-Whisper models (hviske-v6, saga-2-m): torch from the cu128 index.
RUN if [ "$WITH_TRANSFORMERS" = "1" ]; then \
      pip install --extra-index-url https://download.pytorch.org/whl/cu128 -r requirements-extras.txt; \
    fi

COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install --no-deps .

# The Hugging Face token is never part of the image: bind-mount the host file read-only at
# /run/secrets/hf_token (the compose file does this). The model cache is the volume at /cache.
VOLUME ["/cache"]
WORKDIR /work
ENTRYPOINT ["transcribe"]
