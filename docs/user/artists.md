## Artists

Open an artist from search.

- Discography
  - Albums, Singles, Compilations, Appears On sections
  - Infinite loading as you scroll
- Download
  - Download all (queues albums respecting filters)
  - Download any album individually
- Watch
  - Add/remove artist to Watchlist (auto-download new releases when enabled)

How-to: monitor an artist
1. Search for the artist and open their page
2. Click Watch
3. Configure release types and intervals in Configuration → Watch

How-to: download discography
1. Open the artist page
2. Choose release types (e.g., Albums, Singles, Compilations)
3. Click Download All; track progress in Queue and History

Backend endpoints used:
- GET `/api/artist/info?id=...&limit=20&offset=...` (metadata + paged albums)
- GET `/api/artist/download/{artist_id}?album_type=album,single,compilation` (queue discography)
- PUT `/api/artist/watch/{artist_id}` / DELETE `/api/artist/watch/{artist_id}` / GET `/api/artist/watch/{artist_id}/status`