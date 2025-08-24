# Stage 1: Frontend build
FROM node:22-slim AS frontend-builder
WORKDIR /app/spotizerr-ui
RUN npm install -g pnpm
COPY spotizerr-ui/package.json spotizerr-ui/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY spotizerr-ui/. .
RUN pnpm build

# Stage 2: Python dependencies builder (create relocatable deps dir)
FROM python:3.11-slim AS py-deps
WORKDIR /app
COPY requirements.txt .
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/
RUN uv pip install --target /python -r requirements.txt

# Stage 3: Fetch static ffmpeg/ffprobe binaries
FROM debian:stable-slim AS ffmpeg
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl xz-utils jq \
    && rm -rf /var/lib/apt/lists/*
RUN set -euo pipefail; \
    case "$TARGETARCH" in \
      amd64) ARCH_SUFFIX=linux64 ;; \
      arm64) ARCH_SUFFIX=linuxarm64 ;; \
      *) echo "Unsupported arch: $TARGETARCH" && exit 1 ;; \
    esac; \
    ASSET_URL=$(curl -fsSL https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest \
      | jq -r ".assets[] | select(.name | endswith(\"${ARCH_SUFFIX}-gpl.tar.xz\")) | .browser_download_url" \
      | head -n1); \
    if [ -z "$ASSET_URL" ]; then \
      echo "Failed to resolve FFmpeg asset for arch ${ARCH_SUFFIX}" && exit 1; \
    fi; \
    echo "Fetching FFmpeg from: $ASSET_URL"; \
    curl -fsSL -o /tmp/ffmpeg.tar.xz "$ASSET_URL"; \
    tar -xJf /tmp/ffmpeg.tar.xz -C /tmp; \
    mv /tmp/ffmpeg-* /ffmpeg

# Stage 4: Prepare world-writable runtime directories
FROM busybox:1.36.1-musl AS runtime-dirs
RUN mkdir -p /artifact/downloads /artifact/data/config /artifact/data/creds /artifact/data/watch /artifact/data/history /artifact/logs/tasks \
    && touch /artifact/.cache \
    && chmod -R 0777 /artifact

# Stage 5: Final application image (distroless)
FROM gcr.io/distroless/python3-debian12

LABEL org.opencontainers.image.source="https://github.com/Xoconoch/spotizerr"

WORKDIR /app

# Ensure Python finds vendored site-packages and unbuffered output
ENV PYTHONPATH=/python
ENV PYTHONUNBUFFERED=1
ENV PYTHONUTF8=1
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

# Copy application code
COPY --chown=65532:65532 . .

# Copy compiled assets from the frontend build
COPY --from=frontend-builder --chown=65532:65532 /app/spotizerr-ui/dist ./spotizerr-ui/dist

# Copy vendored Python dependencies
COPY --from=py-deps --chown=65532:65532 /python /python

# Copy static ffmpeg binaries
COPY --from=ffmpeg --chown=65532:65532 /ffmpeg/bin/ffmpeg /usr/local/bin/ffmpeg
COPY --from=ffmpeg --chown=65532:65532 /ffmpeg/bin/ffprobe /usr/local/bin/ffprobe

# Copy pre-created world-writable runtime directories
COPY --from=runtime-dirs --chown=65532:65532 /artifact/ ./

# No shell or package manager available in distroless
ENTRYPOINT ["python3", "app.py"]
