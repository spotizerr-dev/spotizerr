## Artists

- Open from Search.
- Discography sections: Albums, Singles, Compilations, Appears On (infinite scroll)
- Download:
  - Download all (queues albums by selected types)
  - Download any album individually
- Watch:
  - Add/remove artist to Watchlist
  - Configure release types and intervals in Configuration → Watch

How to monitor an artist:
1. Search the artist and open their page
2. Click Watch
3. Configure in Configuration → Watch

How to download discography:
1. Open the artist page
2. Select release types (Albums, Singles, Compilations)
3. Click Download All; track in Queue and History

Endpoints:
- GET `/api/artist/info?id=...&limit=10&offset=...` — metadata + paged albums
- GET `/api/artist/download/{artist_id}?album_type=album,single,compilation` — queue discography
- PUT `/api/artist/watch/{artist_id}` / DELETE `/api/artist/watch/{artist_id}`
- GET `/api/artist/watch/{artist_id}/status`