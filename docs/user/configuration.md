## Configuration

See also: [Environment variables](environment.md)

Open Configuration in the web UI. Tabs:

# General
  - **Default service:** Right now, the only one available is Spotify. Deezer-only  mode coming soon!
  - **Active accounts:** Accounts to use for API-related things with the respective service.

# Downloads
  - **Max Concurrent Downloads:** Sets the maximum number of download tasks that can run simultaneously.
  - **Real-Time Downloading:** Matches the download duration to the actual track length, helping to avoid rate limits.
  - **Real-Time Multiplier:** When real-time downloading is enabled, this multiplier adjusts how much faster (or slower) the download occurs compared to the track length.
  - **Download Fallback:** Download from Deezer with a fallback to Spotify.
  - **Recursive Quality:** When download fallback is enabled, try with lower qualities if the specified Deezer quality is not available.
  - **Separate Tracks by User:** When multi-user mode is enabled, separate every download in individual users' folders.
  - **Spotify/Deezer Quality:** Quality to request to the service being used to download  (account tier limitations apply).
  - **Convert to Format:** Format to convert every file downloading.
  - **Bitrate:** When convertion is enabled and a lossy format is enabled, this sets the bitrate with which perform the transcoding.
  - **Max Retry Attempts:** Maximum number of automatic retries to perform
  - **Initial Retry Delay:** Seconds between the first failure and the first retry.
  - **Retry Delay Increase:** Seconds to increase to the delay beyween retries after each failure.


# Formatting
- **Custom Directory Format:** Choose which metadata fields determine how directories are named.
- **Custom Track Format:** Choose which metadata fields determine how individual track files are named.
- **Track Number Padding:** Enable or disable leading zeros for number-based metadata (e.g., `%tracknum%`, `%playlistnum%`).
- **Track Number Padding Width:** Sets how many digits to use for padded numbers. For example:

  * `01. Track` (width: 2)
  * `001. Track` (width: 3)
- **Artist Separator:** When a track has multiple artists (or album artists), this string will be used to separate them in both metadata and file/directory naming.
- **Save Album Cover:** Whether to save the cover as a separate `cover.jpg` file or not.
- **Use Spotify Metadata in Deezer Fallback:** Whether to use Spotify metadata when downloading from Deezer or not. It generally is better to leave this enabled, since it has no added API cost and Spotify's metadata tends to be better.

# Accounts (admin)
  - **Spotify:** use `spotizerr-auth` to add credentials.
  - Deezer ARL (optional):
    - Chrome/Edge: DevTools → Application → Cookies → https://www.deezer.com → copy `arl`
    - Firefox: DevTools → Storage → Cookies → https://www.deezer.com → copy `arl`
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

Quality formats (reference):
- Spotify: OGG 96k/160k/320k (320k requires Premium)
- Deezer: MP3 128k/320k (320k may require Premium), FLAC (Premium)
- Conversion: MP3/FLAC/AAC/OGG/OPUS/WAV/ALAC with custom bitrate

Fallback system:
- Configure primary and fallback services
- Automatically switches if primary fails (useful for geo/account limits)

Notes:
- Explicit content filter applies in pages (e.g., hides explicit tracks on album/playlist views)
- Watch system must be enabled before adding items