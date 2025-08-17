import sqlite3


class MigrationV3_1_0:
	# --- Expected Schemas (3.1.0) ---
	HISTORY_MAIN_REQUIRED = {
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

	HISTORY_MAIN_SQL = """
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

	# Children tables schema (album_% / playlist_%):
	HISTORY_CHILDREN_EXPECTED = {
		"id": "INTEGER PRIMARY KEY AUTOINCREMENT",
		"title": "TEXT NOT NULL",
		"artists": "TEXT",
		"album_title": "TEXT",
		"duration_ms": "INTEGER",
		"track_number": "INTEGER",
		"disc_number": "INTEGER",
		"explicit": "BOOLEAN",
		"status": "TEXT NOT NULL",
		"external_ids": "TEXT",
		"genres": "TEXT",
		"isrc": "TEXT",
		"timestamp": "REAL NOT NULL",
		"position": "INTEGER",
		"metadata": "TEXT",
	}

	WATCH_PLAYLISTS_REQUIRED = {
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

	# Per-playlist tracks table expected columns
	PLAYLIST_TRACKS_EXPECTED = {
		"spotify_track_id": "TEXT PRIMARY KEY",
		"title": "TEXT",
		"artist_names": "TEXT",
		"album_name": "TEXT",
		"album_artist_names": "TEXT",
		"track_number": "INTEGER",
		"album_spotify_id": "TEXT",
		"duration_ms": "INTEGER",
		"added_at_playlist": "TEXT",
		"added_to_db": "INTEGER",
		"is_present_in_spotify": "INTEGER DEFAULT 1",
		"last_seen_in_spotify": "INTEGER",
		"snapshot_id": "TEXT",
		"final_path": "TEXT",
	}

	WATCH_ARTISTS_REQUIRED = {
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

	ARTIST_ALBUMS_EXPECTED = {
		"album_spotify_id": "TEXT PRIMARY KEY",
		"artist_spotify_id": "TEXT",
		"name": "TEXT",
		"album_group": "TEXT",
		"album_type": "TEXT",
		"release_date": "TEXT",
		"release_date_precision": "TEXT",
		"total_tracks": "INTEGER",
		"link": "TEXT",
		"image_url": "TEXT",
		"added_to_db": "INTEGER",
		"last_seen_on_spotify": "INTEGER",
		"download_task_id": "TEXT",
		"download_status": "INTEGER DEFAULT 0",
		"is_fully_downloaded_managed_by_app": "INTEGER DEFAULT 0",
	}

	ACCOUNTS_SPOTIFY_REQUIRED = {"name", "region", "created_at", "updated_at"}
	ACCOUNTS_DEEZER_REQUIRED = {"name", "arl", "region", "created_at", "updated_at"}

	ACCOUNTS_SPOTIFY_SQL = """
	CREATE TABLE IF NOT EXISTS spotify (
	  name TEXT PRIMARY KEY,
	  region TEXT,
	  created_at REAL,
	  updated_at REAL
	);
	"""

	ACCOUNTS_DEEZER_SQL = """
	CREATE TABLE IF NOT EXISTS deezer (
	  name TEXT PRIMARY KEY,
	  arl TEXT,
	  region TEXT,
	  created_at REAL,
	  updated_at REAL
	);
	"""

	@staticmethod
	def _columns(conn: sqlite3.Connection, table: str) -> set[str]:
		try:
			cur = conn.execute(f"PRAGMA table_info({table})")
			return {row[1] for row in cur.fetchall()}
		except Exception:
			return set()

	@staticmethod
	def _ensure_table_schema(conn: sqlite3.Connection, table_name: str, expected: dict[str, str], desc: str) -> None:
		cur = conn.execute(f"PRAGMA table_info({table_name})")
		existing = {row[1] for row in cur.fetchall()}
		for col, col_type in expected.items():
			if col in existing:
				continue
			col_type_for_add = (
				col_type.replace("PRIMARY KEY", "").replace("AUTOINCREMENT", "").replace("NOT NULL", "").strip()
			)
			try:
				conn.execute(f"ALTER TABLE {table_name} ADD COLUMN {col} {col_type_for_add}")
			except sqlite3.OperationalError:
				pass

	# --- Check methods ---
	def check_history(self, conn: sqlite3.Connection) -> bool:
		cur = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='download_history'")
		if not cur.fetchone():
			return False
		return self.HISTORY_MAIN_REQUIRED.issubset(self._columns(conn, "download_history"))

	def check_watch_playlists(self, conn: sqlite3.Connection) -> bool:
		cur = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='watched_playlists'")
		if not cur.fetchone():
			return False
		if not self.WATCH_PLAYLISTS_REQUIRED.issubset(self._columns(conn, "watched_playlists")):
			return False
		cur = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'playlist_%'")
		rows = cur.fetchall()
		for (table_name,) in rows:
			cols = self._columns(conn, table_name)
			required_cols = set(self.PLAYLIST_TRACKS_EXPECTED.keys())
			if not required_cols.issubset(cols):
				return False
		return True

	def check_watch_artists(self, conn: sqlite3.Connection) -> bool:
		cur = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='watched_artists'")
		if not cur.fetchone():
			return False
		if not self.WATCH_ARTISTS_REQUIRED.issubset(self._columns(conn, "watched_artists")):
			return False
		cur = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'artist_%'")
		rows = cur.fetchall()
		for (table_name,) in rows:
			cols = self._columns(conn, table_name)
			required_cols = set(self.ARTIST_ALBUMS_EXPECTED.keys())
			if not required_cols.issubset(cols):
				return False
		return True

	def check_accounts(self, conn: sqlite3.Connection) -> bool:
		cur = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='spotify'")
		if not cur.fetchone():
			return False
		if not self.ACCOUNTS_SPOTIFY_REQUIRED.issubset(self._columns(conn, "spotify")):
			return False
		cur = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='deezer'")
		if not cur.fetchone():
			return False
		if not self.ACCOUNTS_DEEZER_REQUIRED.issubset(self._columns(conn, "deezer")):
			return False
		return True

	# --- Update methods ---
	def update_history(self, conn: sqlite3.Connection) -> None:
		conn.executescript(self.HISTORY_MAIN_SQL)

	def update_watch_playlists(self, conn: sqlite3.Connection) -> None:
		conn.execute(
			"""
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
			)
			"""
		)
		cur = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'playlist_%'")
		for (table_name,) in cur.fetchall():
			conn.execute(
				f"""
				CREATE TABLE IF NOT EXISTS {table_name} (
				  spotify_track_id TEXT PRIMARY KEY,
				  title TEXT,
				  artist_names TEXT,
				  album_name TEXT,
				  album_artist_names TEXT,
				  track_number INTEGER,
				  album_spotify_id TEXT,
				  duration_ms INTEGER,
				  added_at_playlist TEXT,
				  added_to_db INTEGER,
				  is_present_in_spotify INTEGER DEFAULT 1,
				  last_seen_in_spotify INTEGER,
				  snapshot_id TEXT,
				  final_path TEXT
				)
				"""
			)
			self._ensure_table_schema(conn, table_name, self.PLAYLIST_TRACKS_EXPECTED, f"playlist tracks {table_name}")

	def update_watch_artists(self, conn: sqlite3.Connection) -> None:
		conn.execute(
			"""
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
			)
			"""
		)
		cur = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'artist_%'")
		for (table_name,) in cur.fetchall():
			conn.execute(
				f"""
				CREATE TABLE IF NOT EXISTS {table_name} (
				  album_spotify_id TEXT PRIMARY KEY,
				  artist_spotify_id TEXT,
				  name TEXT,
				  album_group TEXT,
				  album_type TEXT,
				  release_date TEXT,
				  release_date_precision TEXT,
				  total_tracks INTEGER,
				  link TEXT,
				  image_url TEXT,
				  added_to_db INTEGER,
				  last_seen_on_spotify INTEGER,
				  download_task_id TEXT,
				  download_status INTEGER DEFAULT 0,
				  is_fully_downloaded_managed_by_app INTEGER DEFAULT 0
				)
				"""
			)
			self._ensure_table_schema(conn, table_name, self.ARTIST_ALBUMS_EXPECTED, f"artist albums {table_name}")

	def update_accounts(self, conn: sqlite3.Connection) -> None:
		conn.executescript(self.ACCOUNTS_SPOTIFY_SQL)
		conn.executescript(self.ACCOUNTS_DEEZER_SQL) 