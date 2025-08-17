import sqlite3
from pathlib import Path
import pytest
import json

# Override the autouse credentials fixture from conftest for this module
@pytest.fixture(scope="session", autouse=True)
def setup_credentials_for_tests():
	yield


def _create_playlists_db_3_1_0(db_path: Path):
	db_path.parent.mkdir(parents=True, exist_ok=True)
	with sqlite3.connect(str(db_path)) as conn:
		# watched_playlists
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
		# example playlist table with all expected columns
		conn.execute(
			"""
			CREATE TABLE IF NOT EXISTS playlist_abc123 (
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


def _create_artists_db_3_1_0(db_path: Path):
	db_path.parent.mkdir(parents=True, exist_ok=True)
	with sqlite3.connect(str(db_path)) as conn:
		# watched_artists
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
		# example artist albums table (using _albums suffix per docs)
		conn.execute(
			"""
			CREATE TABLE IF NOT EXISTS artist_def456_albums (
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


def _create_history_db_3_1_0(db_path: Path):
	db_path.parent.mkdir(parents=True, exist_ok=True)
	with sqlite3.connect(str(db_path)) as conn:
		conn.executescript(
			"""
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
			"""
		)
		# reference children tables to be created by migration
		conn.execute(
			"INSERT INTO download_history (download_type, title, artists, timestamp, status, children_table) VALUES ('album','X','[]',strftime('%s','now'),'completed','album_child1')"
		)
		conn.execute(
			"INSERT INTO download_history (download_type, title, artists, timestamp, status, children_table) VALUES ('playlist','Y','[]',strftime('%s','now'),'completed','playlist_child2')"
		)


def _create_accounts_db_3_1_0(db_path: Path):
	db_path.parent.mkdir(parents=True, exist_ok=True)
	with sqlite3.connect(str(db_path)) as conn:
		conn.execute(
			"""
			CREATE TABLE IF NOT EXISTS spotify (
			  name TEXT PRIMARY KEY,
			  region TEXT,
			  created_at REAL,
			  updated_at REAL
			)
			"""
		)
		conn.execute(
			"""
			CREATE TABLE IF NOT EXISTS deezer (
			  name TEXT PRIMARY KEY,
			  arl TEXT,
			  region TEXT,
			  created_at REAL,
			  updated_at REAL
			)
			"""
		)


def _get_columns(db_path: Path, table: str) -> set[str]:
	with sqlite3.connect(str(db_path)) as conn:
		cur = conn.execute(f"PRAGMA table_info({table})")
		return {row[1] for row in cur.fetchall()}


def test_migration_3_1_0_upgrades_all(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
	data_dir = tmp_path / "data"
	history_db = data_dir / "history" / "download_history.db"
	playlists_db = data_dir / "watch" / "playlists.db"
	artists_db = data_dir / "watch" / "artists.db"
	creds_dir = data_dir / "creds"
	accounts_db = creds_dir / "accounts.db"
	blobs_dir = creds_dir / "blobs"
	search_json = creds_dir / "search.json"

	# Create all DBs to match 3.1.0 schema
	_create_history_db_3_1_0(history_db)
	_create_playlists_db_3_1_0(playlists_db)
	_create_artists_db_3_1_0(artists_db)
	_create_accounts_db_3_1_0(accounts_db)

	from routes.migrations import runner
	monkeypatch.setattr(runner, "DATA_DIR", data_dir)
	monkeypatch.setattr(runner, "HISTORY_DB", history_db)
	monkeypatch.setattr(runner, "WATCH_DIR", data_dir / "watch")
	monkeypatch.setattr(runner, "PLAYLISTS_DB", playlists_db)
	monkeypatch.setattr(runner, "ARTISTS_DB", artists_db)
	monkeypatch.setattr(runner, "CREDS_DIR", creds_dir)
	monkeypatch.setattr(runner, "ACCOUNTS_DB", accounts_db)
	monkeypatch.setattr(runner, "BLOBS_DIR", blobs_dir)
	monkeypatch.setattr(runner, "SEARCH_JSON", search_json)

	# Act: run migrations (should be mostly no-op, but will ensure children tables)
	runner.run_migrations_if_needed()
	runner.run_migrations_if_needed()

	# Children tables created/ensured
	expected_children_cols = {
		"id",
		"title",
		"artists",
		"album_title",
		"duration_ms",
		"track_number",
		"disc_number",
		"explicit",
		"status",
		"external_ids",
		"genres",
		"isrc",
		"timestamp",
		"position",
		"metadata",
	}
	assert _get_columns(history_db, "album_child1").issuperset(expected_children_cols)
	assert _get_columns(history_db, "playlist_child2").issuperset(expected_children_cols)

	# Playlist per-table schema present
	playlist_cols = _get_columns(playlists_db, "playlist_abc123")
	assert {"spotify_track_id", "title", "artist_names", "album_name", "album_artist_names", "track_number", "album_spotify_id", "duration_ms", "added_at_playlist", "added_to_db", "is_present_in_spotify", "last_seen_in_spotify", "snapshot_id", "final_path"}.issubset(playlist_cols)

	# Artist per-table schema present
	artist_cols = _get_columns(artists_db, "artist_def456_albums")
	assert {"album_spotify_id", "artist_spotify_id", "name", "album_group", "album_type", "release_date", "release_date_precision", "total_tracks", "link", "image_url", "added_to_db", "last_seen_on_spotify", "download_task_id", "download_status", "is_fully_downloaded_managed_by_app"}.issubset(artist_cols)

	# Accounts DB present and creds filesystem ensured
	assert accounts_db.exists()
	assert blobs_dir.exists() and blobs_dir.is_dir()
	assert search_json.exists()
	data = json.loads(search_json.read_text())
	assert set(data.keys()) == {"client_id", "client_secret"} 