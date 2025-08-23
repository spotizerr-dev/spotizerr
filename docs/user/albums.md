## Albums

- Open from Search or an Artist page.
- Actions:
  - Download full album or any track
  - Browse tracklist (order, artists, duration)
  - Large albums: tracks load in pages as you scroll
- Explicit filter hides explicit tracks when enabled in Config

Endpoints:
- GET `/api/album/info?id=...&limit=50&offset=...` — album metadata + paged tracks
- GET `/api/album/download/{album_id}` — queue album download
- GET `/api/prgs/stream` — live progress via SSE