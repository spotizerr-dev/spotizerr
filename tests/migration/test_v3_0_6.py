import sqlite3
from pathlib import Path
import pytest
import json

# Override the autouse credentials fixture from conftest for this module
@pytest.fixture(scope="session", autouse=True)
def setup_credentials_for_tests():
	# No-op to avoid external API calls; this shadows the session autouse fixture in conftest.py
	yield


def _create_306_history_db(db_path: Path) -> None:
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
			CREATE INDEX IF NOT EXISTS idx_download_history_timestamp ON download_history(timestamp);
			CREATE INDEX IF NOT EXISTS idx_download_history_type_status ON download_history(download_type, status);
			CREATE INDEX IF NOT EXISTS idx_download_history_task_id ON download_history(task_id);
			CREATE UNIQUE INDEX IF NOT EXISTS uq_download_history_task_type_ids ON download_history(task_id, download_type, external_ids);
			"""
		)
		# Insert rows that reference non-existent children tables
		conn.execute(
			"""
			INSERT INTO download_history (
				download_type, title, artists, timestamp, status, service,
				quality_format, quality_bitrate, total_tracks, successful_tracks,
				failed_tracks, skipped_tracks, children_table, task_id,
				external_ids, metadata, release_date, genres, images, owner,
				album_type, duration_total_ms, explicit
			) VALUES (?, ?, ?, strftime('%s','now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			""",
			(
				"album",
				"Test Album",
				"[]",
				"completed",
				"spotify",
				"FLAC",
				"1411kbps",
				10,
				8,
				1,
				1,
				"album_test1",
				"task-album-1",
				"{}",
				"{}",
				"{}",
				"[]",
				"[]",
				"{}",
				"album",
				123456,
				0,
			),
		)
		conn.execute(
			"""
			INSERT INTO download_history (
				download_type, title, artists, timestamp, status, service,
				quality_format, quality_bitrate, total_tracks, successful_tracks,
				failed_tracks, skipped_tracks, children_table, task_id,
				external_ids, metadata, release_date, genres, images, owner,
				album_type, duration_total_ms, explicit
			) VALUES (?, ?, ?, strftime('%s','now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			""",
			(
				"playlist",
				"Test Playlist",
				"[]",
				"partial",
				"spotify",
				"MP3",
				"320kbps",
				20,
				15,
				3,
				2,
				"playlist_test2",
				"task-playlist-1",
				"{}",
				"{}",
				"{}",
				"[]",
				"[]",
				"{}",
				"",
				654321,
				0,
			),
		)
		# Create a legacy children table with too-few columns to test schema upgrade
		conn.execute(
			"CREATE TABLE IF NOT EXISTS album_legacy (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL)"
		)


def _create_306_watch_dbs(playlists_db: Path, artists_db: Path) -> None:
	playlists_db.parent.mkdir(parents=True, exist_ok=True)
	with sqlite3.connect(str(playlists_db)) as pconn:
		pconn.executescript(
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
			);
			"""
		)
	with sqlite3.connect(str(artists_db)) as aconn:
		aconn.executescript(
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
			);
			"""
		)


def _get_columns(db_path: Path, table: str) -> set[str]:
	with sqlite3.connect(str(db_path)) as conn:
		cur = conn.execute(f"PRAGMA table_info({table})")
		return {row[1] for row in cur.fetchall()}


def test_migration_children_tables_created_and_upgraded(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
	# Arrange temp paths
	data_dir = tmp_path / "data"
	history_db = data_dir / "history" / "download_history.db"
	playlists_db = data_dir / "watch" / "playlists.db"
	artists_db = data_dir / "watch" / "artists.db"
	creds_dir = data_dir / "creds"
	accounts_db = creds_dir / "accounts.db"
	blobs_dir = creds_dir / "blobs"
	search_json = creds_dir / "search.json"

	# Create 3.0.6 base schemas and sample data
	_create_306_history_db(history_db)
	_create_306_watch_dbs(playlists_db, artists_db)

	# Point the migration runner to our temp DBs
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

	# Act: run migrations
	runner.run_migrations_if_needed()
	# Run twice to ensure idempotency
	runner.run_migrations_if_needed()

	# Assert: referenced children tables exist with expected columns
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
	assert _get_columns(history_db, "album_test1").issuperset(expected_children_cols)
	assert _get_columns(history_db, "playlist_test2").issuperset(expected_children_cols)
	# Legacy table upgraded
	assert _get_columns(history_db, "album_legacy").issuperset(expected_children_cols)

	# Assert: accounts DB created with expected tables and columns
	assert accounts_db.exists()
	spotify_cols = _get_columns(accounts_db, "spotify")
	deezer_cols = _get_columns(accounts_db, "deezer")
	assert {"name", "region", "created_at", "updated_at"}.issubset(spotify_cols)
	assert {"name", "arl", "region", "created_at", "updated_at"}.issubset(deezer_cols)

	# Assert: creds filesystem
	assert blobs_dir.exists() and blobs_dir.is_dir()
	assert search_json.exists()
	data = json.loads(search_json.read_text())
	assert set(data.keys()) == {"client_id", "client_secret"} 