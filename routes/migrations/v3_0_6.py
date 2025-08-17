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


# --- Check functions ---

def _table_columns(conn: sqlite3.Connection, table: str) -> set[str]:
	try:
		cur = conn.execute(f"PRAGMA table_info({table})")
		return {row[1] for row in cur.fetchall()}
	except Exception:
		return set()


def check_history_3_0_6(conn: sqlite3.Connection) -> bool:
	"""Return True if history DB matches v3.0.6 schema for main table."""
	cur = conn.execute(
		"SELECT name FROM sqlite_master WHERE type='table' AND name='download_history'"
	)
	if not cur.fetchone():
		return False
	required = {
		"id",
		"download_type",
		"title",
		"artists",
		"timestamp",
		"status",
		"service",
		"quality_format",
		"quality_bitrate",
		"total_tracks",
		"successful_tracks",
		"failed_tracks",
		"skipped_tracks",
		"children_table",
		"task_id",
		"external_ids",
		"metadata",
		"release_date",
		"genres",
		"images",
		"owner",
		"album_type",
		"duration_total_ms",
		"explicit",
	}
	return required.issubset(_table_columns(conn, "download_history"))


def check_watch_playlists_3_0_6(conn: sqlite3.Connection) -> bool:
	cur = conn.execute(
		"SELECT name FROM sqlite_master WHERE type='table' AND name='watched_playlists'"
	)
	if not cur.fetchone():
		return False
	required = {
		"spotify_id",
		"name",
		"owner_id",
		"owner_name",
		"total_tracks",
		"link",
		"snapshot_id",
		"last_checked",
		"added_at",
		"is_active",
	}
	return required.issubset(_table_columns(conn, "watched_playlists"))


def check_watch_artists_3_0_6(conn: sqlite3.Connection) -> bool:
	cur = conn.execute(
		"SELECT name FROM sqlite_master WHERE type='table' AND name='watched_artists'"
	)
	if not cur.fetchone():
		return False
	required = {
		"spotify_id",
		"name",
		"link",
		"total_albums_on_spotify",
		"last_checked",
		"added_at",
		"is_active",
		"genres",
		"popularity",
		"image_url",
	}
	return required.issubset(_table_columns(conn, "watched_artists"))


# --- Update functions ---

def update_history_3_0_6(conn: sqlite3.Connection) -> None:
	conn.executescript(HISTORY_SQL)


def update_watch_playlists_3_0_6(conn: sqlite3.Connection) -> None:
	conn.executescript(WATCH_PLAYLISTS_SQL)


def update_watch_artists_3_0_6(conn: sqlite3.Connection) -> None:
	conn.executescript(WATCH_ARTISTS_SQL) 