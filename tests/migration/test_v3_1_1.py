import sqlite3
import unittest
from pathlib import Path
from tempfile import mkdtemp
from shutil import rmtree
import pytest

from routes.migrations.v3_1_1 import MigrationV3_1_1

# Override the autouse credentials fixture from conftest for this module
@pytest.fixture(scope="session", autouse=True)
def setup_credentials_for_tests():
    # No-op to avoid external API calls; this shadows the session autouse fixture in conftest.py
    yield


class TestMigrationV3_1_1(unittest.TestCase):
    """
    Tests the dummy migration from 3.1.1 to 3.1.2, ensuring no changes are made.
    """

    def setUp(self):
        self.temp_dir = Path(mkdtemp())
        self.history_db_path = self.temp_dir / "history" / "download_history.db"
        self.artists_db_path = self.temp_dir / "watch" / "artists.db"
        self.playlists_db_path = self.temp_dir / "watch" / "playlists.db"
        self.accounts_db_path = self.temp_dir / "creds" / "accounts.db"
        self._create_mock_databases()

    def tearDown(self):
        rmtree(self.temp_dir)

    def _get_db_schema(self, db_path: Path) -> dict:
        """Helper to get the schema of a database."""
        schema = {}
        with sqlite3.connect(db_path) as conn:
            cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table';")
            tables = [row[0] for row in cursor.fetchall() if not row[0].startswith("sqlite_")]
            for table_name in tables:
                info_cursor = conn.execute(f'PRAGMA table_info("{table_name}")')
                schema[table_name] = {row[1] for row in info_cursor.fetchall()}
        return schema

    def _create_mock_databases(self):
        """Creates a set of mock databases with the 3.1.1 schema."""
        # History DB
        self.history_db_path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(self.history_db_path) as conn:
            conn.executescript(
                """
                CREATE TABLE download_history (
                    id INTEGER PRIMARY KEY, download_type TEXT, title TEXT, artists TEXT,
                    timestamp REAL, status TEXT, service TEXT, quality_format TEXT,
                    quality_bitrate TEXT, total_tracks INTEGER, successful_tracks INTEGER,
                    failed_tracks INTEGER, skipped_tracks INTEGER, children_table TEXT,
                    task_id TEXT, external_ids TEXT, metadata TEXT, release_date TEXT,
                    genres TEXT, images TEXT, owner TEXT, album_type TEXT,
                    duration_total_ms INTEGER, explicit BOOLEAN
                );
                CREATE TABLE playlist_p1l2a3 (
                    id INTEGER PRIMARY KEY, title TEXT, artists TEXT, album_title TEXT,
                    duration_ms INTEGER, track_number INTEGER, disc_number INTEGER,
                    explicit BOOLEAN, status TEXT, external_ids TEXT, genres TEXT,
                    isrc TEXT, timestamp REAL, position INTEGER, metadata TEXT
                );
                """
            )

        # Watch Artists DB
        self.artists_db_path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(self.artists_db_path) as conn:
            conn.executescript(
                """
                CREATE TABLE watched_artists (id TEXT PRIMARY KEY, children_table TEXT);
                INSERT INTO watched_artists (id, children_table) VALUES ('a1b2c3d4', 'artist_a1b2c3d4');
                CREATE TABLE artist_a1b2c3d4 (
                    id TEXT PRIMARY KEY, title TEXT, artists TEXT, album_type TEXT,
                    release_date TEXT, total_tracks INTEGER, external_ids TEXT,
                    images TEXT, album_group TEXT, release_date_precision TEXT,
                    download_task_id TEXT, download_status TEXT,
                    is_fully_downloaded_managed_by_app BOOLEAN
                );
                """
            )

        # Watch Playlists DB
        self.playlists_db_path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(self.playlists_db_path) as conn:
            conn.executescript(
                """
                CREATE TABLE watched_playlists (id TEXT PRIMARY KEY, children_table TEXT);
                CREATE TABLE playlist_p1l2a3 (id TEXT PRIMARY KEY, title TEXT);
                """
            )

        # Accounts DB
        self.accounts_db_path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(self.accounts_db_path) as conn:
            conn.execute("CREATE TABLE accounts (id TEXT PRIMARY KEY, service TEXT, details TEXT);")

    def test_migration_leaves_schema_unchanged(self):
        """Asserts that the dummy migration makes no changes to any database."""
        # Get initial schemas
        initial_schemas = {
            "history": self._get_db_schema(self.history_db_path),
            "artists": self._get_db_schema(self.artists_db_path),
            "playlists": self._get_db_schema(self.playlists_db_path),
            "accounts": self._get_db_schema(self.accounts_db_path),
        }

        # Run the dummy migration
        migration = MigrationV3_1_1()
        with sqlite3.connect(self.history_db_path) as conn:
            migration.update_history(conn)
        with sqlite3.connect(self.artists_db_path) as conn:
            migration.update_watch_artists(conn)
        with sqlite3.connect(self.playlists_db_path) as conn:
            migration.update_watch_playlists(conn)
        with sqlite3.connect(self.accounts_db_path) as conn:
            migration.update_accounts(conn)

        # Get final schemas
        final_schemas = {
            "history": self._get_db_schema(self.history_db_path),
            "artists": self._get_db_schema(self.artists_db_path),
            "playlists": self._get_db_schema(self.playlists_db_path),
            "accounts": self._get_db_schema(self.accounts_db_path),
        }

        # Assert schemas are identical
        self.assertEqual(initial_schemas, final_schemas)


if __name__ == '__main__':
    unittest.main()
