## Albums

Open an album from search or artist page.

- Download
  - Download full album
  - Download individual tracks from the tracklist
- Tracklist
  - Shows order, artists, and duration
  - Respects explicit filter (hidden if enabled)
- Large albums
  - Tracks load progressively as you scroll

Backend endpoints used:

- GET `/api/album/info?id=...&limit=50&offset=...` (metadata + paged tracks)
- GET `/api/album/download/{album_id}` (queue download)
- GET `/api/progress/stream` (live queue updates)