import sqlite3
from pathlib import Path
import pytest

import sqlite3
from pathlib import Path
import pytest

from routes.migrations.v3_1_0 import MigrationV3_1_0

# Override the autouse credentials fixture from conftest for this module
@pytest.fixture(scope="session", autouse=True)
def setup_credentials_for_tests():
    # No-op to avoid external API calls
    yield


def _create_310_watch_artists_db(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(str(db_path)) as conn:
        conn.executescript(
            """
            CREATE TABLE watched_artists (
                spotify_id TEXT PRIMARY KEY,
                name TEXT
            );
            CREATE TABLE "artist_a1b2c3" (
                album_spotify_id TEXT PRIMARY KEY,
                artist_spotify_id TEXT,
                name TEXT,
                album_type TEXT,
                release_date TEXT,
                total_tracks INTEGER,
                link TEXT,
                image_url TEXT,
                added_to_db INTEGER,
                last_seen_on_spotify INTEGER
            );
            """
        )
        conn.execute("INSERT INTO watched_artists (spotify_id) VALUES (?)", ('a1b2c3',))


def test_watch_artists_migration(tmp_path):
    # 1. Setup mock v3.1.0 database
    db_path = tmp_path / "artists.db"
    _create_310_watch_artists_db(db_path)

    # 2. Run the migration
    migration = MigrationV3_1_0()
    with sqlite3.connect(db_path) as conn:
        # Sanity check before migration
        cur = conn.execute('PRAGMA table_info("artist_a1b2c3")')
        columns_before = {row[1] for row in cur.fetchall()}
        assert 'download_status' not in columns_before

        # Apply migration
        migration.update_watch_artists(conn)

        # 3. Assert migration was successful
        cur = conn.execute('PRAGMA table_info("artist_a1b2c3")')
        columns_after = {row[1] for row in cur.fetchall()}

    expected_columns = migration.ARTIST_ALBUMS_EXPECTED_COLUMNS.keys()
    assert set(expected_columns).issubset(columns_after)
