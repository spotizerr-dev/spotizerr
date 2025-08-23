## Watchlist

Enable the watch system in Configuration → Watch first.

- Add items
  - From Artist or Playlist pages, click Watch
- What it does
  - Periodically checks watched items
  - Queues new releases (artists) and/or newly added tracks (playlists)
- Setup
  - Enable watch system and set intervals in Configuration → Watch
  - Trigger a manual check if you want immediate processing

Backend endpoints used:

- Artists: PUT/DELETE/GET status under `/api/artist/watch/*`
- Playlists: PUT/DELETE/GET status under `/api/playlist/watch/*`
- Manual triggers: POST `/api/artist/watch/trigger_check` and `/api/playlist/watch/trigger_check`