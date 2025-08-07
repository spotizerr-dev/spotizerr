# Spotizerr API Documentation

A comprehensive music download service API built with FastAPI that supports Spotify content downloading, playlist/artist watching, and user authentication.

## 🚀 Base URL
```
http://localhost:7171/api
```

## 🔐 Authentication

### Authentication System
- **Type**: JWT-based authentication with optional SSO (Google/GitHub)
- **Token**: Bearer token in Authorization header
- **When Disabled**: System user with admin privileges automatically applied

### Auth Status
Check authentication configuration and current user status.

#### `GET /auth/status`
**Response:**
```json
{
  "auth_enabled": true,
  "authenticated": false,
  "user": null,
  "registration_enabled": true,
  "sso_enabled": true,
  "sso_providers": ["google", "github"]
}
```

### Login & Registration

#### `POST /auth/login`
**Request:**
```json
{
  "username": "string",
  "password": "string"
}
```
**Response:**
```json
{
  "access_token": "jwt-token",
  "token_type": "bearer",
  "user": {
    "username": "string",
    "email": "string",
    "role": "user|admin",
    "created_at": "2024-01-01T00:00:00",
    "last_login": "2024-01-01T00:00:00",
    "sso_provider": null,
    "is_sso_user": false
  }
}
```

#### `POST /auth/register`
**Request:**
```json
{
  "username": "string",
  "password": "string",
  "email": "string"
}
```

#### `POST /auth/logout`
Logs out the current user.

### User Management (Admin Only)

#### `GET /auth/users`
List all users.

#### `POST /auth/users/create`
**Request:**
```json
{
  "username": "string",
  "password": "string",
  "email": "string",
  "role": "user|admin"
}
```

#### `DELETE /auth/users/{username}`
Delete a user.

#### `PUT /auth/users/{username}/role`
**Request:**
```json
{
  "role": "user|admin"
}
```

#### `PUT /auth/users/{username}/password`
Admin password reset.
**Request:**
```json
{
  "new_password": "string"
}
```

### Profile Management

#### `GET /auth/profile`
Get current user profile.

#### `PUT /auth/profile/password`
Change own password.
**Request:**
```json
{
  "current_password": "string",
  "new_password": "string"
}
```

### SSO Authentication

#### `GET /auth/sso/status`
Get SSO configuration and available providers.

#### `GET /auth/sso/login/google`
Redirect to Google OAuth.

#### `GET /auth/sso/login/github`  
Redirect to GitHub OAuth.

#### `GET /auth/sso/callback/google`
Google OAuth callback.

#### `GET /auth/sso/callback/github`
GitHub OAuth callback.

#### `POST /auth/sso/unlink/{provider}`
Unlink SSO provider from account.

## 🎵 Content Download Endpoints

### Track Downloads

#### `GET /track/download/{track_id}`
Download a single track.
**Response:**
```json
{
  "task_id": "uuid"
}
```
**Status Code:** 202 (Accepted)

#### `GET /track/download/cancel`
**Query Parameters:**
- `task_id`: Task ID to cancel

#### `GET /track/info`
Get track metadata.
**Query Parameters:**
- `id`: Spotify track ID

**Response:**
```json
{
  "id": "string",
  "name": "string", 
  "artists": [{"name": "string"}],
  "album": {"name": "string"},
  "duration_ms": 180000,
  "explicit": false,
  "external_urls": {"spotify": "url"}
}
```

### Album Downloads

#### `GET /album/download/{album_id}`
Download an entire album.
**Response:**
```json
{
  "task_id": "uuid"
}
```

#### `GET /album/download/cancel`
**Query Parameters:**
- `task_id`: Task ID to cancel

#### `GET /album/info`
Get album metadata.
**Query Parameters:**
- `id`: Spotify album ID

### Playlist Downloads

#### `GET /playlist/download/{playlist_id}`
Download an entire playlist.
**Response:**
```json
{
  "task_id": "uuid"
}
```

#### `GET /playlist/download/cancel`
**Query Parameters:**
- `task_id`: Task ID to cancel

#### `GET /playlist/info`
Get playlist metadata.
**Query Parameters:**
- `id`: Spotify playlist ID

#### `GET /playlist/metadata`
Get detailed playlist metadata including tracks.
**Query Parameters:**
- `id`: Spotify playlist ID

#### `GET /playlist/tracks`
Get playlist tracks.
**Query Parameters:**
- `id`: Spotify playlist ID

### Artist Downloads

#### `GET /artist/download/{artist_id}`
Download artist's discography.
**Query Parameters:**
- `album_type`: Comma-separated values (`album,single,compilation,appears_on`)

**Response:**
```json
{
  "status": "complete",
  "message": "Artist discography processing initiated. X albums queued.",
  "queued_albums": ["task_id1", "task_id2"],
  "duplicate_albums": ["existing_task_id"]
}
```

#### `GET /artist/download/cancel`
**Query Parameters:**
- `task_id`: Task ID to cancel

#### `GET /artist/info`
Get artist metadata.
**Query Parameters:**
- `id`: Spotify artist ID

## 📺 Watch Functionality

Monitor playlists and artists for new content and automatically download updates.

### Playlist Watching

#### `PUT /playlist/watch/{playlist_spotify_id}`
Add playlist to watch list.
**Request:**
```json
{
  "watch_new_additions": true,
  "download_existing": false
}
```

#### `GET /playlist/watch/{playlist_spotify_id}/status`
Get playlist watch status.

#### `DELETE /playlist/watch/{playlist_spotify_id}`
Remove playlist from watch list.

#### `POST /playlist/watch/{playlist_spotify_id}/tracks`
Add specific tracks to watch for a playlist.
**Request:**
```json
{
  "track_ids": ["track_id1", "track_id2"]
}
```

#### `DELETE /playlist/watch/{playlist_spotify_id}/tracks`
Remove specific tracks from watch.
**Request:**
```json
{
  "track_ids": ["track_id1", "track_id2"]
}
```

#### `GET /playlist/watch/list`
List all watched playlists.

#### `POST /playlist/watch/trigger_check`
Manually trigger watch check for all playlists.

#### `POST /playlist/watch/trigger_check/{playlist_spotify_id}`
Manually trigger watch check for specific playlist.

### Artist Watching

#### `PUT /artist/watch/{artist_spotify_id}`
Add artist to watch list.
**Request:**
```json
{
  "watch_new_releases": true,
  "album_types": ["album", "single"]
}
```

#### `GET /artist/watch/{artist_spotify_id}/status`
Get artist watch status.

#### `DELETE /artist/watch/{artist_spotify_id}`
Remove artist from watch list.

#### `POST /artist/watch/{artist_spotify_id}/albums`
Add specific albums to watch for an artist.
**Request:**
```json
{
  "album_ids": ["album_id1", "album_id2"]
}
```

#### `DELETE /artist/watch/{artist_spotify_id}/albums`
Remove specific albums from watch.

#### `GET /artist/watch/list`
List all watched artists.

#### `POST /artist/watch/trigger_check`
Manually trigger watch check for all artists.

#### `POST /artist/watch/trigger_check/{artist_spotify_id}`
Manually trigger watch check for specific artist.

## 🔍 Search

#### `GET /search/`
Search Spotify content.
**Query Parameters:**
- `q`: Search query (required)
- `search_type` or `type`: Content type (`track`, `album`, `artist`, `playlist`, `episode`, `show`)
- `limit`: Results limit (default: 20)
- `main`: Account context

**Response:**
```json
{
  "items": [
    {
      "id": "string",
      "name": "string",
      "type": "track",
      "artists": [{"name": "string"}],
      "external_urls": {"spotify": "url"}
    }
  ]
}
```

## 📊 Progress & Task Management

### Task Monitoring

#### `GET /prgs/list`
List all tasks with optional filtering.
**Query Parameters:**
- `status`: Filter by status (`pending`, `running`, `completed`, `failed`)
- `download_type`: Filter by type (`track`, `album`, `playlist`)
- `limit`: Results limit

#### `GET /prgs/{task_id}`
Get specific task details and progress.

#### `GET /prgs/updates`
Get task updates since last check.
**Query Parameters:**
- `since`: Timestamp to get updates since

#### `GET /prgs/stream`
**Server-Sent Events (SSE)** endpoint for real-time progress updates.
**Response:** Continuous stream of task updates.

### Task Control

#### `POST /prgs/cancel/{task_id}`
Cancel a specific task.

#### `POST /prgs/cancel/all`
Cancel all running tasks.

#### `DELETE /prgs/delete/{task_id}`
Delete completed/failed task from history.

## 📜 Download History

### History Retrieval

#### `GET /history/`
Get download history with pagination.
**Query Parameters:**
- `limit`: Max records (default: 100, max: 500)
- `offset`: Records to skip (default: 0)
- `download_type`: Filter by type (`track`, `album`, `playlist`)
- `status`: Filter by status (`completed`, `failed`, `skipped`, `in_progress`)

**Response:**
```json
{
  "downloads": [
    {
      "task_id": "uuid",
      "download_type": "track",
      "url": "spotify_url",
      "name": "Track Name",
      "artist": "Artist Name",
      "status": "completed",
      "created_at": "2024-01-01T00:00:00",
      "completed_at": "2024-01-01T00:05:00",
      "file_path": "/path/to/file.mp3"
    }
  ],
  "pagination": {
    "limit": 100,
    "offset": 0,
    "returned_count": 50
  }
}
```

#### `GET /history/{task_id}`
Get specific download history entry.

#### `GET /history/{task_id}/children`
Get child tasks (for album/playlist downloads).

#### `GET /history/stats`
Get download statistics.

#### `GET /history/search`
Search download history.
**Query Parameters:**
- `q`: Search query
- `field`: Field to search (`name`, `artist`, `url`)

#### `GET /history/recent`
Get recent downloads.
**Query Parameters:**
- `hours`: Hours to look back (default: 24)

#### `GET /history/failed`
Get failed downloads.

#### `POST /history/cleanup`
Clean up old history entries.
**Request:**
```json
{
  "older_than_days": 30,
  "keep_failed": true
}
```

## ⚙️ System Configuration

### Configuration Management

#### `GET /config/`
Get current system configuration.

#### `POST /config/` / `PUT /config/`
Update system configuration.
**Request:**
```json
{
  "maxConcurrentDownloads": 3,
  "service": "spotify",
  "fallback": true,
  "spotifyQuality": "high",
  "deezerQuality": "flac",
  "realTime": true,
  "downloadPath": "/downloads",
  "fileFormat": "mp3"
}
```

#### `GET /config/check`
Validate current configuration.

#### `POST /config/validate`
Validate provided configuration.

### Watch Configuration

#### `GET /config/watch`
Get watch system configuration.

#### `POST /config/watch` / `PUT /config/watch`
Update watch configuration.
**Request:**
```json
{
  "enabled": true,
  "check_interval": 3600,
  "max_concurrent_checks": 2,
  "retry_failed_after": 1800
}
```

#### `POST /config/watch/validate`
Validate watch configuration.

## 🔑 Credentials Management

### Service Credentials

#### `GET /credentials/{service}`
List credentials for service (`spotify` or `deezer`).

#### `GET /credentials/{service}/{name}`
Get specific credential set.

#### `POST /credentials/{service}/{name}`
Create new credential set.
**Request:**
```json
{
  "client_id": "string",
  "client_secret": "string"
}
```

#### `PUT /credentials/{service}/{name}`
Update credential set.

#### `DELETE /credentials/{service}/{name}`
Delete credential set.

#### `GET /credentials/all/{service}`
Get all credentials for service.

### Spotify API Configuration

#### `GET /credentials/spotify_api_config`
Get Spotify API configuration.

#### `PUT /credentials/spotify_api_config`
Update Spotify API configuration.

#### `GET /credentials/markets`
Get available Spotify markets.

## 🚨 Error Handling

### HTTP Status Codes
- **200**: Success
- **202**: Accepted (async operations)
- **400**: Bad Request (validation errors)
- **401**: Unauthorized (auth required)
- **403**: Forbidden (insufficient permissions)
- **404**: Not Found
- **409**: Conflict (duplicate downloads)
- **500**: Internal Server Error

### Error Response Format
```json
{
  "error": "Error description",
  "details": "Additional details",
  "traceback": "Stack trace (dev mode)"
}
```

### Common Error Scenarios
- **Duplicate Downloads**: 409 status with existing task ID
- **Missing Spotify Metadata**: 404 when track/album/playlist not found
- **Invalid Credentials**: Authentication errors when service credentials are wrong
- **Rate Limiting**: Temporary failures when hitting Spotify API limits

## 💡 Usage Examples

### Download a Track
```bash
curl -X GET "http://localhost:7171/api/track/download/4iV5W9uYEdYUVa79Axb7Rh" \
  -H "Authorization: Bearer your-jwt-token"
```

### Search for Music
```bash
curl -X GET "http://localhost:7171/api/search/?q=bohemian%20rhapsody&search_type=track" \
  -H "Authorization: Bearer your-jwt-token"
```

### Monitor Progress with SSE
```javascript
const eventSource = new EventSource('/api/prgs/stream');
eventSource.onmessage = function(event) {
  const data = JSON.parse(event.data);
  console.log('Progress update:', data);
};
```

### Add Playlist to Watch
```bash
curl -X PUT "http://localhost:7171/api/playlist/watch/37i9dQZF1DXcBWIGoYBM5M" \
  -H "Authorization: Bearer your-jwt-token" \
  -H "Content-Type: application/json" \
  -d '{"watch_new_additions": true, "download_existing": false}'
```

## 🔧 Development Notes

### Authentication Middleware
- Routes are protected by `require_auth_from_state` dependency
- Admin routes use `require_admin_from_state` dependency
- When auth is disabled, system returns mock admin user

### Task System
- All downloads are async using Celery
- Progress tracked via Redis
- Real-time updates via SSE
- Task cancellation supported

### File Structure
- Downloads stored in configurable directory
- Metadata stored in JSON files
- History persisted in database

### Rate Limiting
- Spotify API rate limits respected
- Concurrent download limits configurable
- Retry logic for failed requests

---

*This documentation covers all endpoints discovered in the Spotizerr routes directory. The API is designed for high-throughput music downloading with comprehensive monitoring and management capabilities.* 