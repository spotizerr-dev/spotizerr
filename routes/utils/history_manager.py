import sqlite3
import json
import time
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

HISTORY_DIR = Path('./data/history')
HISTORY_DB_FILE = HISTORY_DIR / 'download_history.db'

def init_history_db():
    """Initializes the download history database and creates the table if it doesn't exist."""
    try:
        HISTORY_DIR.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(HISTORY_DB_FILE)
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS download_history (
                task_id TEXT PRIMARY KEY,
                download_type TEXT,
                item_name TEXT,
                item_artist TEXT,
                item_album TEXT,
                item_url TEXT,
                spotify_id TEXT,
                status_final TEXT, -- 'COMPLETED', 'ERROR', 'CANCELLED'
                error_message TEXT,
                timestamp_added REAL,
                timestamp_completed REAL,
                original_request_json TEXT,
                last_status_obj_json TEXT
            )
        """)
        conn.commit()
        logger.info(f"Download history database initialized at {HISTORY_DB_FILE}")
    except sqlite3.Error as e:
        logger.error(f"Error initializing download history database: {e}", exc_info=True)
    finally:
        if conn:
            conn.close()

def add_entry_to_history(history_data: dict):
    """Adds or replaces an entry in the download_history table.

    Args:
        history_data (dict): A dictionary containing the data for the history entry.
                             Expected keys match the table columns.
    """
    required_keys = [
        'task_id', 'download_type', 'item_name', 'item_artist', 'item_album',
        'item_url', 'spotify_id', 'status_final', 'error_message',
        'timestamp_added', 'timestamp_completed', 'original_request_json',
        'last_status_obj_json'
    ]
    # Ensure all keys are present, filling with None if not
    for key in required_keys:
        history_data.setdefault(key, None)

    conn = None
    try:
        conn = sqlite3.connect(HISTORY_DB_FILE)
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR REPLACE INTO download_history (
                task_id, download_type, item_name, item_artist, item_album,
                item_url, spotify_id, status_final, error_message,
                timestamp_added, timestamp_completed, original_request_json,
                last_status_obj_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            history_data['task_id'], history_data['download_type'], history_data['item_name'],
            history_data['item_artist'], history_data['item_album'], history_data['item_url'],
            history_data['spotify_id'], history_data['status_final'], history_data['error_message'],
            history_data['timestamp_added'], history_data['timestamp_completed'],
            history_data['original_request_json'], history_data['last_status_obj_json']
        ))
        conn.commit()
        logger.info(f"Added/Updated history for task_id: {history_data['task_id']}, status: {history_data['status_final']}")
    except sqlite3.Error as e:
        logger.error(f"Error adding entry to download history for task_id {history_data.get('task_id')}: {e}", exc_info=True)
    except Exception as e:
        logger.error(f"Unexpected error adding to history for task_id {history_data.get('task_id')}: {e}", exc_info=True)
    finally:
        if conn:
            conn.close()

def get_history_entries(limit=25, offset=0, sort_by='timestamp_completed', sort_order='DESC', filters=None):
    """Retrieves entries from the download_history table with pagination, sorting, and filtering.

    Args:
        limit (int): Maximum number of entries to return.
        offset (int): Number of entries to skip (for pagination).
        sort_by (str): Column name to sort by.
        sort_order (str): 'ASC' or 'DESC'.
        filters (dict, optional): A dictionary of column_name: value to filter by.
                                  Currently supports exact matches.

    Returns:
        tuple: (list of history entries as dicts, total_count of matching entries)
    """
    conn = None
    try:
        conn = sqlite3.connect(HISTORY_DB_FILE)
        conn.row_factory = sqlite3.Row  # Access columns by name
        cursor = conn.cursor()

        base_query = "FROM download_history"
        count_query = "SELECT COUNT(*) " + base_query
        select_query = "SELECT * " + base_query

        where_clauses = []
        params = []

        if filters:
            for column, value in filters.items():
                # Basic security: ensure column is a valid one (alphanumeric + underscore)
                if column.replace('_', '').isalnum():
                    where_clauses.append(f"{column} = ?")
                    params.append(value)
        
        if where_clauses:
            where_sql = " WHERE " + " AND ".join(where_clauses)
            count_query += where_sql
            select_query += where_sql

        # Get total count for pagination
        cursor.execute(count_query, params)
        total_count = cursor.fetchone()[0]

        # Validate sort_by and sort_order to prevent SQL injection
        valid_sort_columns = [
            'task_id', 'download_type', 'item_name', 'item_artist', 'item_album',
            'item_url', 'status_final', 'timestamp_added', 'timestamp_completed'
        ]
        if sort_by not in valid_sort_columns:
            sort_by = 'timestamp_completed' # Default sort
        
        sort_order_upper = sort_order.upper()
        if sort_order_upper not in ['ASC', 'DESC']:
            sort_order_upper = 'DESC'

        select_query += f" ORDER BY {sort_by} {sort_order_upper} LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        cursor.execute(select_query, params)
        rows = cursor.fetchall()
        
        # Convert rows to list of dicts
        entries = [dict(row) for row in rows]
        return entries, total_count

    except sqlite3.Error as e:
        logger.error(f"Error retrieving history entries: {e}", exc_info=True)
        return [], 0
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    # For testing purposes
    logging.basicConfig(level=logging.INFO)
    init_history_db()
    
    sample_data_complete = {
        'task_id': 'test_task_123',
        'download_type': 'track',
        'item_name': 'Test Song',
        'item_artist': 'Test Artist',
        'item_album': 'Test Album',
        'item_url': 'http://spotify.com/track/123',
        'spotify_id': '123',
        'status_final': 'COMPLETED',
        'error_message': None,
        'timestamp_added': time.time() - 3600,
        'timestamp_completed': time.time(),
        'original_request_json': json.dumps({'param1': 'value1'}),
        'last_status_obj_json': json.dumps({'status': 'complete', 'message': 'Finished!'})
    }
    add_entry_to_history(sample_data_complete)

    sample_data_error = {
        'task_id': 'test_task_456',
        'download_type': 'album',
        'item_name': 'Another Album',
        'item_artist': 'Another Artist',
        'item_album': 'Another Album', # For albums, item_name and item_album are often the same
        'item_url': 'http://spotify.com/album/456',
        'spotify_id': '456',
        'status_final': 'ERROR',
        'error_message': 'Download failed due to network issue.',
        'timestamp_added': time.time() - 7200,
        'timestamp_completed': time.time() - 60,
        'original_request_json': json.dumps({'param2': 'value2'}),
        'last_status_obj_json': json.dumps({'status': 'error', 'error': 'Network issue'})
    }
    add_entry_to_history(sample_data_error)

    # Test updating an entry
    updated_data_complete = {
        'task_id': 'test_task_123',
        'download_type': 'track',
        'item_name': 'Test Song (Updated)',
        'item_artist': 'Test Artist',
        'item_album': 'Test Album II',
        'item_url': 'http://spotify.com/track/123',
        'spotify_id': '123',
        'status_final': 'COMPLETED',
        'error_message': None,
        'timestamp_added': time.time() - 3600,
        'timestamp_completed': time.time() + 100, # Updated completion time
        'original_request_json': json.dumps({'param1': 'value1', 'new_param': 'added'}),
        'last_status_obj_json': json.dumps({'status': 'complete', 'message': 'Finished! With update.'})
    }
    add_entry_to_history(updated_data_complete)

    print(f"Test entries added/updated in {HISTORY_DB_FILE}")

    print("\nFetching all history entries (default sort):")
    entries, total = get_history_entries(limit=5)
    print(f"Total entries: {total}")
    for entry in entries:
        print(entry)

    print("\nFetching history entries (sorted by item_name ASC, limit 2, offset 1):")
    entries_sorted, total_sorted = get_history_entries(limit=2, offset=1, sort_by='item_name', sort_order='ASC')
    print(f"Total entries (should be same as above): {total_sorted}")
    for entry in entries_sorted:
        print(entry)
    
    print("\nFetching history entries with filter (status_final = COMPLETED):")
    entries_filtered, total_filtered = get_history_entries(filters={'status_final': 'COMPLETED'})
    print(f"Total COMPLETED entries: {total_filtered}")
    for entry in entries_filtered:
        print(entry) 