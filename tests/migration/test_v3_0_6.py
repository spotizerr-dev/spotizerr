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
		# Create a fully-specified children table from docs and add rows
		conn.execute(
			"""
			CREATE TABLE IF NOT EXISTS album_f9e8d7c6b5 (
			  id INTEGER PRIMARY KEY AUTOINCREMENT,
			  title TEXT NOT NULL,
			  artists TEXT,
			  album_title TEXT,
			  duration_ms INTEGER,
			  track_number INTEGER,
			  disc_number INTEGER,
			  explicit BOOLEAN,
			  status TEXT NOT NULL,
			  external_ids TEXT,
			  genres TEXT,
			  isrc TEXT,
			  timestamp REAL NOT NULL,
			  position INTEGER,
			  metadata TEXT
			)
			"""
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
				"album",
				"Random Access Memories",
				"[\"Daft Punk\"]",
				"partial",
				"spotify",
				"FLAC",
				"1411",
				13,
				12,
				1,
				0,
				"album_f9e8d7c6b5",
				"celery-task-id-789",
				"{\"spotify\": \"4m2880jivSbbyEGAKfITCa\"}",
				"{\"callback_type\": \"album\"}",
				"{\"year\": 2013, \"month\": 5, \"day\": 17}",
				"[\"disco\", \"funk\"]",
				"[{\"url\": \"https://i.scdn.co/image/...\"}]",
				None,
				"album",
				4478293,
				0
			),
		)
		conn.executemany(
			"""
			INSERT INTO album_f9e8d7c6b5 (
				title, artists, album_title, duration_ms, track_number, disc_number, explicit, status,
				external_ids, genres, isrc, timestamp, position, metadata
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s','now'), ?, ?)
			""",
			[
				(
					"Get Lucky (feat. Pharrell Williams & Nile Rodgers)",
					"[\"Daft Punk\", \"Pharrell Williams\", \"Nile Rodgers\"]",
					"Random Access Memories",
					369626,
					8,
					1,
					0,
					"completed",
					"{\"spotify\": \"69kOkLUCdZlE8ApD28j1JG\", \"isrc\": \"GBUJH1300019\"}",
					"[]",
					"GBUJH1300019",
					0,
					"{\"album\": {...}, \"type\": \"track\"}",
				),
				(
					"Lose Yourself to Dance (feat. Pharrell Williams)",
					"[\"Daft Punk\", \"Pharrell Williams\"]",
					"Random Access Memories",
					353893,
					6,
					1,
					0,
					"failed",
					"{\"spotify\": \"5L95vS64r8PAj5M8H1oYkm\", \"isrc\": \"GBUJH1300017\"}",
					"[]",
					"GBUJH1300017",
					0,
					"{\"album\": {...}, \"failure_reason\": \"Could not find matching track on Deezer.\"}",
				),
			]
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
		# Insert a sample watched playlist row (docs example)
		pconn.execute(
			"""
			INSERT OR REPLACE INTO watched_playlists (
				spotify_id, name, owner_id, owner_name, total_tracks, link, snapshot_id, last_checked, added_at, is_active
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			""",
			(
				"37i9dQZF1DXcBWIGoYBM5M",
				"Today's Top Hits",
				"spotify",
				"Spotify",
				50,
				"https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
				"MTY3NzE4NjgwMCwwMDAwMDAwMDk1ODVmYjI5ZDY5MGUzN2Q4Y2U4OWY2YmY1ZDE4ZTAy",
				1677187000,
				1677186950,
				1,
			),
		)
		# Create a legacy/minimal playlist dynamic table to test schema upgrade
		pconn.execute(
			"CREATE TABLE IF NOT EXISTS playlist_legacy (spotify_track_id TEXT PRIMARY KEY, title TEXT)"
		)
		# Create a fully-specified playlist dynamic table (docs example) and add rows
		pconn.execute(
			"""
			CREATE TABLE IF NOT EXISTS playlist_37i9dQZF1DXcBWIGoYBM5M (
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
			  is_present_in_spotify INTEGER,
			  last_seen_in_spotify INTEGER,
			  snapshot_id TEXT,
			  final_path TEXT
			)
			"""
		)
		pconn.executemany(
			"""
			INSERT OR REPLACE INTO playlist_37i9dQZF1DXcBWIGoYBM5M (
				spotify_track_id, title, artist_names, album_name, album_artist_names, track_number, album_spotify_id,
				duration_ms, added_at_playlist, added_to_db, is_present_in_spotify, last_seen_in_spotify, snapshot_id, final_path
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			""",
			[
				(
					"4k6Uh1HXdhtusDW5y80vNN",
					"As It Was",
					"Harry Styles",
					"Harry's House",
					"Harry Styles",
					4,
					"5r36AJ6VOJtp00oxSkNaAO",
					167303,
					"2023-02-20T10:00:00Z",
					1677186980,
					1,
					1677187000,
					"MTY3NzE4NjgwMCwwMDAwMDAwMDk1ODVmYjI5ZDY5MGUzN2Q4Y2U4OWY2YmY1ZDE4ZTAy",
					"/downloads/music/Harry Styles/Harry's House/04 - As It Was.flac",
				),
				(
					"5ww2BF9slyYgAno5EAsoOJ",
					"Flowers",
					"Miley Cyrus",
					"Endless Summer Vacation",
					"Miley Cyrus",
					1,
					"1lw0K2sIKi84gav3e4pG3c",
					194952,
					"2023-02-23T12:00:00Z",
					1677186995,
					1,
					1677187000,
					"MTY3NzE4NjgwMCwwMDAwMDAwMDk1ODVmYjI5ZDY5MGUzN2Q4Y2U4OWY2YmY1ZDE4ZTAy",
					None,
				),
			]
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
		# Insert a sample watched artist row (docs example)
		aconn.execute(
			"""
			INSERT OR REPLACE INTO watched_artists (
				spotify_id, name, link, total_albums_on_spotify, last_checked, added_at, is_active, genres, popularity, image_url
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			""",
			(
				"4oLeXFyACqeem2VImYeBFe",
				"Madeon",
				"https://open.spotify.com/artist/4oLeXFyACqeem2VImYeBFe",
				45,
				1677188000,
				1677187900,
				1,
				"electro house, filter house, french house",
				65,
				"https://i.scdn.co/image/ab6761610000e5eb...",
			),
		)
		# Create a legacy/minimal artist dynamic table to test schema upgrade
		aconn.execute(
			"CREATE TABLE IF NOT EXISTS artist_legacy (album_spotify_id TEXT PRIMARY KEY, name TEXT)"
		)
		# Create a fully-specified artist dynamic table (docs example) and add rows
		aconn.execute(
			"""
			CREATE TABLE IF NOT EXISTS artist_4oLeXFyACqeem2VImYeBFe (
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
			  download_status INTEGER,
			  is_fully_downloaded_managed_by_app INTEGER
			)
			"""
		)
		aconn.executemany(
			"""
			INSERT OR REPLACE INTO artist_4oLeXFyACqeem2VImYeBFe (
				album_spotify_id, artist_spotify_id, name, album_group, album_type, release_date, release_date_precision,
				total_tracks, link, image_url, added_to_db, last_seen_on_spotify, download_task_id, download_status, is_fully_downloaded_managed_by_app
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			""",
			[
				(
					"2GWMnf2ltOQd2v2T62a2m8",
					"4oLeXFyACqeem2VImYeBFe",
					"Good Faith",
					"album",
					"album",
					"2019-11-15",
					"day",
					10,
					"https://open.spotify.com/album/2GWMnf2ltOQd2v2T62a2m8",
					"https://i.scdn.co/image/ab67616d0000b273...",
					1677187950,
					1677188000,
					"celery-task-id-123",
					2,
					1,
				),
				(
					"2smfe2S0AVaxH2I1a5p55n",
					"4oLeXFyACqeem2VImYeBFe",
					"Gonna Be Good",
					"single",
					"single",
					"2023-01-19",
					"day",
					1,
					"https://open.spotify.com/album/2smfe2S0AVaxH2I1a5p55n",
					"https://i.scdn.co/image/ab67616d0000b273...",
					1677187960,
					1677188000,
					"celery-task-id-456",
					1,
					0,
				),
			]
		)


def _create_306_accounts(creds_dir: Path, accounts_db: Path) -> None:
	creds_dir.mkdir(parents=True, exist_ok=True)
	with sqlite3.connect(str(accounts_db)) as conn:
		conn.executescript(
			"""
			CREATE TABLE IF NOT EXISTS spotify (
			  name TEXT PRIMARY KEY,
			  region TEXT,
			  created_at REAL,
			  updated_at REAL
			);
			CREATE TABLE IF NOT EXISTS deezer (
			  name TEXT PRIMARY KEY,
			  arl TEXT,
			  region TEXT,
			  created_at REAL,
			  updated_at REAL
			);
			"""
		)
		conn.execute(
			"INSERT OR REPLACE INTO spotify (name, region, created_at, updated_at) VALUES (?, ?, ?, ?)",
			("my_main_spotify", "US", 1677190000.0, 1677190000.0),
		)
		conn.execute(
			"INSERT OR REPLACE INTO deezer (name, arl, region, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
			("my_hifi_deezer", "a1b2c3d4e5f6a1b2c3d4e5f6...", "FR", 1677190100.0, 1677190100.0),
		)
	# Pre-create creds filesystem
	search_json = creds_dir / "search.json"
	if not search_json.exists():
		search_json.write_text('{"client_id":"your_global_spotify_client_id","client_secret":"your_global_spotify_client_secret"}\n', encoding="utf-8")
	blobs_dir = creds_dir / "blobs" / "my_main_spotify"
	blobs_dir.mkdir(parents=True, exist_ok=True)
	creds_blob = blobs_dir / "credentials.json"
	if not creds_blob.exists():
		creds_blob.write_text(
			'{"version":"v1","access_token":"...","expires_at":1677193600,"refresh_token":"...","scope":"user-read-private user-read-email playlist-read-private"}\n',
			encoding="utf-8",
		)


def _get_columns(db_path: Path, table: str) -> set[str]:
	with sqlite3.connect(str(db_path)) as conn:
		cur = conn.execute(f"PRAGMA table_info({table})")
		return {row[1] for row in cur.fetchall()}


def _get_count(db_path: Path, table: str) -> int:
	with sqlite3.connect(str(db_path)) as conn:
		cur = conn.execute(f"SELECT COUNT(*) FROM {table}")
		return cur.fetchone()[0]


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

	# Create 3.0.6 base schemas and sample data (full simulation)
	_create_306_history_db(history_db)
	_create_306_watch_dbs(playlists_db, artists_db)
	_create_306_accounts(creds_dir, accounts_db)

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
	# Pre-existing children table preserved and correct
	assert _get_columns(history_db, "album_f9e8d7c6b5").issuperset(expected_children_cols)
	assert _get_count(history_db, "album_f9e8d7c6b5") == 2

	# Assert: accounts DB created/preserved with expected tables and columns
	assert accounts_db.exists()
	spotify_cols = _get_columns(accounts_db, "spotify")
	deezer_cols = _get_columns(accounts_db, "deezer")
	assert {"name", "region", "created_at", "updated_at"}.issubset(spotify_cols)
	assert {"name", "arl", "region", "created_at", "updated_at"}.issubset(deezer_cols)

	# Assert: creds filesystem and pre-existing blob preserved
	assert blobs_dir.exists() and blobs_dir.is_dir()
	assert search_json.exists()
	data = json.loads(search_json.read_text())
	assert set(data.keys()) == {"client_id", "client_secret"}
	assert (blobs_dir / "my_main_spotify" / "credentials.json").exists()

	# Assert: watch playlists core and dynamic tables upgraded to/at 3.1.2 schema
	watched_playlists_cols = _get_columns(playlists_db, "watched_playlists")
	assert {
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
	}.issubset(watched_playlists_cols)
	playlist_dynamic_expected = {
		"spotify_track_id",
		"title",
		"artist_names",
		"album_name",
		"album_artist_names",
		"track_number",
		"album_spotify_id",
		"duration_ms",
		"added_at_playlist",
		"added_to_db",
		"is_present_in_spotify",
		"last_seen_in_spotify",
		"snapshot_id",
		"final_path",
	}
	assert _get_columns(playlists_db, "playlist_legacy").issuperset(playlist_dynamic_expected)
	assert _get_columns(playlists_db, "playlist_37i9dQZF1DXcBWIGoYBM5M").issuperset(playlist_dynamic_expected)
	assert _get_count(playlists_db, "playlist_37i9dQZF1DXcBWIGoYBM5M") == 2

	# Assert: watch artists core and dynamic tables upgraded to/at 3.1.2 schema
	watched_artists_cols = _get_columns(artists_db, "watched_artists")
	assert {
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
	}.issubset(watched_artists_cols)
	artist_dynamic_expected = {
		"album_spotify_id",
		"artist_spotify_id",
		"name",
		"album_group",
		"album_type",
		"release_date",
		"release_date_precision",
		"total_tracks",
		"link",
		"image_url",
		"added_to_db",
		"last_seen_on_spotify",
		"download_task_id",
		"download_status",
		"is_fully_downloaded_managed_by_app",
	}
	assert _get_columns(artists_db, "artist_legacy").issuperset(artist_dynamic_expected)
	assert _get_columns(artists_db, "artist_4oLeXFyACqeem2VImYeBFe").issuperset(artist_dynamic_expected)
	assert _get_count(artists_db, "artist_4oLeXFyACqeem2VImYeBFe") == 2 