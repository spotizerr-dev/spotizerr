## Tracks

Find a track via search or open a track page.

- Download
  - Click Download on result card or track page
  - Progress visible in the Queue drawer
- Open on Spotify
  - From track page, open the Spotify link
- Details shown
  - Artists, album, duration, popularity

- Backend endpoints used:
  - GET `/api/track/info?id=...` (metadata)
  - GET `/api/track/download/{track_id}` (queue download)
  - GET `/api/progress/stream` (live queue updates)