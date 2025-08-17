import sqlite3

HISTORY_SQL = """
CREATE TABLE IF NOT EXISTS download_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  download_type TEXT NOT NULL,
  title TEXT NOT NULL,
  artists TEXT,
  timestamp REAL NOT NULL,
  status TEXT NOT NULL,
  service TEXT,
  quality_format TEXT,
  quality_bitrate TEXT,
  total_tracks INTEGER,
  successful_tracks INTEGER,
  failed_tracks INTEGER,
  skipped_tracks INTEGER,
  children_table TEXT,
  task_id TEXT,
  external_ids TEXT,
  metadata TEXT,
  release_date TEXT,
  genres TEXT,
  images TEXT,
  owner TEXT,
  album_type TEXT,
  duration_total_ms INTEGER,
  explicit BOOLEAN
);
CREATE INDEX IF NOT EXISTS idx_download_history_timestamp ON download_history(timestamp);
CREATE INDEX IF NOT EXISTS idx_download_history_type_status ON download_history(download_type, status);
CREATE INDEX IF NOT EXISTS idx_download_history_task_id ON download_history(task_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_download_history_task_type_ids ON download_history(task_id, download_type, external_ids);
"""

WATCH_PLAYLISTS_SQL = """
CREATE TABLE IF NOT EXISTS watched_playlists (
  spotify_id TEXT PRIMARY KEY,
  name TEXT,
  owner_id TEXT,
  owner_name TEXT,
  total_tracks INTEGER,
  link TEXT,
  snapshot_id TEXT,
  last_checked INTEGER,
  added_at INTEGER,
  is_active INTEGER DEFAULT 1
);
"""

WATCH_ARTISTS_SQL = """
CREATE TABLE IF NOT EXISTS watched_artists (
  spotify_id TEXT PRIMARY KEY,
  name TEXT,
  link TEXT,
  total_albums_on_spotify INTEGER,
  last_checked INTEGER,
  added_at INTEGER,
  is_active INTEGER DEFAULT 1,
  genres TEXT,
  popularity INTEGER,
  image_url TEXT
);
"""


def apply_history(conn: sqlite3.Connection) -> None:
	conn.executescript(HISTORY_SQL)


def apply_watch_playlists(conn: sqlite3.Connection) -> None:
	conn.executescript(WATCH_PLAYLISTS_SQL)


def apply_watch_artists(conn: sqlite3.Connection) -> None:
	conn.executescript(WATCH_ARTISTS_SQL) 