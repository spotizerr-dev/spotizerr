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
    ca-certificates curl xz-utils \
    && rm -rf /var/lib/apt/lists/*
RUN case "$TARGETARCH" in \
      amd64) FFMPEG_PKG=ffmpeg-master-latest-linux64-gpl.tar.xz ;; \
      arm64) FFMPEG_PKG=ffmpeg-master-latest-linuxarm64-gpl.tar.xz ;; \
      *) echo "Unsupported arch: $TARGETARCH" && exit 1 ;; \
    esac && \
    curl -fsSL -o /tmp/ffmpeg.tar.xz https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/${FFMPEG_PKG} && \
    tar -xJf /tmp/ffmpeg.tar.xz -C /tmp && \
    mv /tmp/ffmpeg-* /ffmpeg

# Stage 4: Prepare world-writable runtime directories
FROM busybox:1.36.1-musl AS runtime-dirs
RUN mkdir -p /artifact/downloads /artifact/data/config /artifact/data/creds /artifact/data/watch /artifact/data/history /artifact/logs/tasks \
    && chmod -R 0777 /artifact

# Stage 5: Final application image (distroless)
FROM gcr.io/distroless/python3-debian12

LABEL org.opencontainers.image.source="https://github.com/Xoconoch/spotizerr"

WORKDIR /app

# Ensure Python finds vendored site-packages and unbuffered output
ENV PYTHONPATH=/python
ENV PYTHONUNBUFFERED=1

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
