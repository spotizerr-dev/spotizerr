import logging
import sqlite3
from pathlib import Path
from typing import Optional

from .v3_3_0 import MigrationV3_3_0

logger = logging.getLogger(__name__)

DATA_DIR = Path("./data")

# Credentials
CREDS_DIR = DATA_DIR / "creds"
ACCOUNTS_DB = CREDS_DIR / "accounts.db"
BLOBS_DIR = CREDS_DIR / "blobs"
SEARCH_JSON = CREDS_DIR / "search.json"


def _safe_connect(path: Path) -> Optional[sqlite3.Connection]:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(path))
        conn.row_factory = sqlite3.Row
        return conn
    except Exception as e:
        logger.error(f"Failed to open SQLite DB {path}: {e}")
        return None


def _ensure_creds_filesystem() -> None:
    try:
        BLOBS_DIR.mkdir(parents=True, exist_ok=True)
        if not SEARCH_JSON.exists():
            SEARCH_JSON.write_text(
                '{ "client_id": "", "client_secret": "" }\n', encoding="utf-8"
            )
            logger.info(f"Created default global Spotify creds file at {SEARCH_JSON}")
    except Exception:
        logger.error(
            "Failed to ensure credentials filesystem (blobs/search.json)", exc_info=True
        )


def run_migrations_if_needed():
    # Check if data directory exists
    if not DATA_DIR.exists():
        return

    try:
        # Validate configuration version strictly at 3.3.0
        MigrationV3_3_0.assert_config_version_is_3_3_0()

        # No schema changes in 3.3.0 path; just ensure Accounts DB can be opened
        with _safe_connect(ACCOUNTS_DB) as conn:
            if conn:
                conn.commit()

    except Exception as e:
        logger.error("Error during migration: %s", e, exc_info=True)
        raise
    else:
        _ensure_creds_filesystem()
        logger.info("Migration validation completed (3.3.0 gate)")
