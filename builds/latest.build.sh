docker buildx build --push --load --platform linux/amd64,linux/arm64 --build-arg CACHE_BUST=$(date +%s) --tag cooldockerizer93/spotizerr:latest .
