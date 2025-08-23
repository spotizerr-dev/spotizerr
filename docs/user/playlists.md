## Playlists

Open a playlist from search.

- Download
  - Download entire playlist
  - Download individual tracks
- Metadata and tracks
  - Loads metadata first (fast, avoids rate limits)
  - Tracks load in pages as you scroll
- Watch
  - Add/remove playlist to Watchlist (auto-download new additions when enabled)

How-to: download a playlist
1. Search for the playlist or paste its Spotify URL
2. Click Download
3. Monitor progress in the Queue; results appear in History

Backend endpoints used:

- GET `/api/playlist/metadata?id=...` (metadata only)
- GET `/api/playlist/tracks?id=...&limit=50&offset=...` (paged tracks)
- GET `/api/playlist/info?id=...&include_tracks=true` (full info when needed)
- GET `/api/playlist/download/{playlist_id}` (queue download)
- PUT `/api/playlist/watch/{playlist_id}` (watch)
- DELETE `/api/playlist/watch/{playlist_id}` (unwatch)
- GET `/api/playlist/watch/{playlist_id}/status` (status)