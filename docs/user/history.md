## History

See all downloads and their outcomes.

- Filters
  - By type (track/album/playlist) and status (completed/failed/skipped/in_progress)
  - Pagination for large histories
- Drill-down
  - Open an entry to view child tracks for albums/playlists
  - Re-queue failures from the UI

- Backend endpoints used:
  - GET `/api/history?download_type=&status=&limit=&offset=`
  - GET `/api/history/{task_id}` (entry)
  - GET `/api/history/{task_id}/children` (child tracks)
  - GET `/api/history/stats`, `/api/history/recent`, `/api/history/failed` (summaries)