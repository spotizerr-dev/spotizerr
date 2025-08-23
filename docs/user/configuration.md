## Configuration

See also: [Environment variables](environment.md)

Open Configuration in the web UI. Tabs:

- General (admin)
  - App version, basic info
- Downloads (admin)
  - Concurrent downloads, retry behavior
  - Quality/format defaults and conversion
  - Real-time mode (Spotify only): aligns download time with track length
- Formatting (admin)
  - File/folder naming patterns (examples)
    - `%artist%/%album%/%tracknum%. %title%`
    - `%ar_album%/%album% (%year%)/%title%`
- Accounts (admin)
  - Spotify: use `spotizerr-auth` to add credentials
  - Deezer ARL (optional):
    - Chrome/Edge: devtools → Application → Cookies → https://www.deezer.com → copy `arl`
    - Firefox: devtools → Storage → Cookies → https://www.deezer.com → copy `arl`
    - Paste ARL in Accounts
  - Select main account when multiple exist
- Watch (admin)
  - Enable/disable watch system
  - Set check intervals
  - Manually trigger checks (artists/playlists)
- Server (admin)
  - System info and advanced settings
- Profile (all users when auth is enabled)
  - Change password, view role and email

- Quality formats (reference):
  - Spotify: OGG 96k/160k/320k (320k requires Premium)
  - Deezer: MP3 128k/320k (320k may require Premium), FLAC (Premium)
  - Conversion: MP3/FLAC/AAC/OGG/OPUS/WAV/ALAC with custom bitrate

- Fallback system:
  - Configure primary and fallback services
  - Automatically switches if primary fails (useful for geo/account limits)

- Notes:
  - Explicit content filter applies in pages (e.g., hides explicit tracks on album/playlist views)
  - Watch system must be enabled before adding items