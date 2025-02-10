import os
import sys
import json
import time
import string
import random
import traceback
import threading
from multiprocessing import Process
from queue import Queue, Empty

# ------------------------------------------------------------------------------
# Configuration
# ------------------------------------------------------------------------------

# Load configuration from ./config/main.json and get the max_concurrent_dl value.
CONFIG_PATH = './config/main.json'
try:
    with open(CONFIG_PATH, 'r') as f:
        config_data = json.load(f)
    MAX_CONCURRENT_DL = config_data.get("maxConcurrentDownloads", 3)
except Exception as e:
    # Fallback to a default value if there's an error reading the config.
    MAX_CONCURRENT_DL = 3

PRG_DIR = './prgs'  # directory where .prg files will be stored

# ------------------------------------------------------------------------------
# Utility Functions and Classes
# ------------------------------------------------------------------------------

def generate_random_filename(length=6, extension=".prg"):
    """Generate a random filename with the given extension."""
    chars = string.ascii_lowercase + string.digits
    return ''.join(random.choice(chars) for _ in range(length)) + extension

class FlushingFileWrapper:
    """
    A file wrapper that flushes after writing each line and
    skips lines whose JSON content has a "type" of "track".
    """
    def __init__(self, file):
        self.file = file

    def write(self, text):
        for line in text.split('\n'):
            line = line.strip()
            if line and line.startswith('{'):
                try:
                    obj = json.loads(line)
                    if obj.get("type") == "track":
                        continue  # skip lines that represent track messages
                except ValueError:
                    pass  # not valid JSON; write the line as is
                self.file.write(line + '\n')
        self.file.flush()

    def flush(self):
        self.file.flush()

def run_download_task(task, prg_path):
    """
    This function is executed in a separate process.
    It opens the given prg file (in append mode), calls the appropriate download
    function (album, track, or playlist), and writes a completion or error status
    to the file.
    """
    try:
        # Determine which download function to use based on task type.
        download_type = task.get("download_type")
        if download_type == "album":
            from routes.utils.album import download_album
            download_func = download_album
        elif download_type == "track":
            from routes.utils.track import download_track
            download_func = download_track
        elif download_type == "playlist":
            from routes.utils.playlist import download_playlist
            download_func = download_playlist
        else:
            raise ValueError(f"Unsupported download type: {download_type}")

        # Open the .prg file in append mode so as not to overwrite the queued lines.
        with open(prg_path, 'a') as f:
            flushing_file = FlushingFileWrapper(f)
            original_stdout = sys.stdout
            sys.stdout = flushing_file

            try:
                # Call the appropriate download function with parameters from the task.
                download_func(
                    service=task.get("service"),
                    url=task.get("url"),
                    main=task.get("main"),
                    fallback=task.get("fallback"),
                    quality=task.get("quality"),
                    fall_quality=task.get("fall_quality"),
                    real_time=task.get("real_time", False),
                    custom_dir_format=task.get("custom_dir_format", "%ar_album%/%album%/%copyright%"),
                    custom_track_format=task.get("custom_track_format", "%tracknum%. %music% - %artist%")
                )
                flushing_file.write(json.dumps({"status": "complete"}) + "\n")
            except Exception as e:
                flushing_file.write(json.dumps({
                    "status": "error",
                    "message": str(e),
                    "traceback": traceback.format_exc()
                }) + "\n")
            finally:
                sys.stdout = original_stdout  # restore original stdout
    except Exception as e:
        # If something fails even before opening the prg file properly.
        with open(prg_path, 'a') as f:
            error_data = json.dumps({
                "status": "error",
                "message": str(e),
                "traceback": traceback.format_exc()
            })
            f.write(error_data + "\n")

# ------------------------------------------------------------------------------
# Download Queue Manager Class
# ------------------------------------------------------------------------------

class DownloadQueueManager:
    """
    Manages a queue of download tasks, ensuring that no more than
    MAX_CONCURRENT_DL downloads run concurrently.
    """
    def __init__(self, max_concurrent=MAX_CONCURRENT_DL, prg_dir=PRG_DIR):
        self.max_concurrent = max_concurrent
        self.prg_dir = prg_dir
        os.makedirs(self.prg_dir, exist_ok=True)

        self.pending_tasks = Queue()    # holds tasks waiting to run
        self.running_downloads = {}     # maps prg_filename -> Process instance
        self.cancelled_tasks = set()    # holds prg_filenames of tasks that have been cancelled
        self.lock = threading.Lock()    # protects access to running_downloads and cancelled_tasks
        self.worker_thread = threading.Thread(target=self.queue_worker, daemon=True)
        self.running = False

    def start(self):
        """Start the worker thread that monitors the queue."""
        self.running = True
        self.worker_thread.start()

    def stop(self):
        """Stop the worker thread gracefully."""
        self.running = False
        self.worker_thread.join()

    def add_task(self, task):
        """
        Adds a new download task to the queue.
        The task is expected to be a dictionary with all necessary parameters,
        including a "download_type" key (album, track, or playlist).
        A .prg file is created for progress logging with an initial two entries:
          1. The original request (merged with the extra keys: type, name, artist)
          2. A queued status entry (including type, name, artist, and the task's position in the queue)
        
        Returns the generated prg filename so that the caller can later
        check the status or request cancellation.
        """
        # Determine the download type, defaulting to 'unknown' if not provided.
        download_type = task.get("download_type", "unknown")
        # Compute the overall position in the queue:
        # position = (number of running tasks) + (number of pending tasks) + 1.
        position = len(self.running_downloads) + self.pending_tasks.qsize() + 1

        # Generate the prg filename based on the download type and queue position.
        prg_filename = f"{download_type}_{position}.prg"
        prg_path = os.path.join(self.prg_dir, prg_filename)
        task['prg_path'] = prg_path

        # Create and immediately write the initial entries to the .prg file.
        try:
            with open(prg_path, 'w') as f:
                # Merge extra keys into the original request.
                original_request = task.get("orig_request", {})
                for key in ["type", "name", "artist"]:
                    if key in task and task[key] is not None:
                        original_request[key] = task[key]
                f.write(json.dumps({"original_request": original_request}) + "\n")
                
                # Write a queued status entry with the extra parameters and queue position.
                queued_entry = {
                    "status": "queued",
                    "name": task.get("name"),
                    "type": task.get("type"),
                    "artist": task.get("artist"),
                    "position": position
                }
                f.write(json.dumps(queued_entry) + "\n")
        except Exception as e:
            print("Error writing prg file:", e)
        
        self.pending_tasks.put((prg_filename, task))
        return prg_filename

    def cancel_task(self, prg_filename):
        """
        Cancel a download task (either queued or running) by marking it as cancelled or terminating its process.
        If the task is running, its process is terminated.
        If the task is queued, it is marked as cancelled so that it won't be started.
        In either case, a cancellation status is appended to its .prg file.
        
        Returns a dictionary indicating the result.
        """
        prg_path = os.path.join(self.prg_dir, prg_filename)
        with self.lock:
            process = self.running_downloads.get(prg_filename)
            if process and process.is_alive():
                process.terminate()
                process.join()
                del self.running_downloads[prg_filename]
                try:
                    with open(prg_path, 'a') as f:
                        f.write(json.dumps({"status": "cancel"}) + "\n")
                except Exception as e:
                    return {"error": f"Failed to write cancel status: {str(e)}"}
                return {"status": "cancelled"}
            else:
                # Task is not running; mark it as cancelled if it's still pending.
                self.cancelled_tasks.add(prg_filename)
                try:
                    with open(prg_path, 'a') as f:
                        f.write(json.dumps({"status": "cancel"}) + "\n")
                except Exception as e:
                    return {"error": f"Failed to write cancel status: {str(e)}"}
                return {"status": "cancelled"}

    def queue_worker(self):
        """
        Worker thread that continuously monitors the pending_tasks queue.
        It cleans up finished download processes and starts new ones if the
        number of running downloads is less than the allowed maximum.
        """
        while self.running:
            # First, clean up any finished processes.
            with self.lock:
                finished = []
                for prg_filename, process in list(self.running_downloads.items()):
                    if not process.is_alive():
                        finished.append(prg_filename)
                for prg_filename in finished:
                    del self.running_downloads[prg_filename]

            # Start new tasks if there is available capacity.
            if len(self.running_downloads) < self.max_concurrent:
                try:
                    prg_filename, task = self.pending_tasks.get(timeout=1)
                except Empty:
                    time.sleep(0.5)
                    continue

                # Check if the task was cancelled while it was still queued.
                with self.lock:
                    if prg_filename in self.cancelled_tasks:
                        # Task has been cancelled; remove it from the set and skip processing.
                        self.cancelled_tasks.remove(prg_filename)
                        continue

                prg_path = task.get('prg_path')
                # Create and start a new process for the task.
                p = Process(
                    target=run_download_task,
                    args=(task, prg_path)
                )
                with self.lock:
                    self.running_downloads[prg_filename] = p
                p.start()
            else:
                # At capacity; sleep briefly.
                time.sleep(1)

            # Small sleep to avoid a tight loop.
            time.sleep(0.1)

# ------------------------------------------------------------------------------
# Global Instance
# ------------------------------------------------------------------------------

# Create and start a global instance of the queue manager.
download_queue_manager = DownloadQueueManager()
download_queue_manager.start()
