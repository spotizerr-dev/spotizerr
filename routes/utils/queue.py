import os
import sys
import json
import time
import string
import random
import traceback
import threading
import signal
import atexit
from multiprocessing import Process, Event
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
    MAX_RETRIES = config_data.get("maxRetries", 3)
    RETRY_DELAY = config_data.get("retryDelaySeconds", 5)
    RETRY_DELAY_INCREASE = config_data.get("retry_delay_increase", 5)
    # Hardcode the queue state file to be in the config/state directory
    QUEUE_STATE_FILE = "./config/state/queue_state.json"
except Exception as e:
    print(f"Error loading configuration: {e}")
    # Fallback to default values if there's an error reading the config.
    MAX_CONCURRENT_DL = 3
    MAX_RETRIES = 3
    RETRY_DELAY = 5
    RETRY_DELAY_INCREASE = 5
    QUEUE_STATE_FILE = "./config/state/queue_state.json"

PRG_DIR = './prgs'  # directory where .prg files will be stored

# ------------------------------------------------------------------------------
# Utility Functions and Classes
# ------------------------------------------------------------------------------

def get_config_params():
    """
    Get common download parameters from the config file.
    This centralizes parameter retrieval and reduces redundancy in API calls.
    
    Returns:
        dict: A dictionary containing common parameters from config
    """
    try:
        with open(CONFIG_PATH, 'r') as f:
            config = json.load(f)
            
        return {
            'spotify': config.get('spotify', ''),
            'deezer': config.get('deezer', ''),
            'fallback': config.get('fallback', False),
            'spotifyQuality': config.get('spotifyQuality', 'NORMAL'),
            'deezerQuality': config.get('deezerQuality', 'MP3_128'),
            'realTime': config.get('realTime', False),
            'customDirFormat': config.get('customDirFormat', '%ar_album%/%album%'),
            'customTrackFormat': config.get('customTrackFormat', '%tracknum%. %music%'),
            'tracknum_padding': config.get('tracknum_padding', True),
            'maxRetries': config.get('maxRetries', 3),
            'retryDelaySeconds': config.get('retryDelaySeconds', 5),
            'retry_delay_increase': config.get('retry_delay_increase', 5)
        }
    except Exception as e:
        print(f"Error reading config for parameters: {e}")
        # Return defaults if config read fails
        return {
            'spotify': '',
            'deezer': '',
            'fallback': False,
            'spotifyQuality': 'NORMAL',
            'deezerQuality': 'MP3_128',
            'realTime': False,
            'customDirFormat': '%ar_album%/%album%',
            'customTrackFormat': '%tracknum%. %music%',
            'tracknum_padding': True,
            'maxRetries': 3,
            'retryDelaySeconds': 5,
            'retry_delay_increase': 5
        }

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
            if line:  # Only write non-empty lines
                try:
                    self.file.write(line + '\n')
                    self.file.flush()
                except (IOError, OSError) as e:
                    print(f"Error writing to file: {e}")

    def flush(self):
        try:
            self.file.flush()
        except (IOError, OSError) as e:
            print(f"Error flushing file: {e}")
            
    def close(self):
        """
        Close the underlying file object.
        """
        try:
            self.file.flush()
            self.file.close()
        except (IOError, OSError) as e:
            print(f"Error closing file: {e}")

def handle_termination(signum, frame):
    """
    Signal handler for graceful termination of download processes.
    Called when a SIGTERM signal is received.
    
    Args:
        signum: The signal number
        frame: The current stack frame
    """
    try:
        print(f"Process received termination signal {signum}")
        sys.exit(0)
    except Exception as e:
        print(f"Error during termination: {e}")
        sys.exit(1)

class StdoutRedirector:
    """
    Class that redirects stdout/stderr to a file.
    All print statements will be captured and written directly to the target file.
    """
    def __init__(self, file_wrapper):
        self.file_wrapper = file_wrapper
        
    def write(self, message):
        if message and not message.isspace():
            # Pass the message directly without wrapping it in JSON
            self.file_wrapper.write(message.rstrip())
        
    def flush(self):
        self.file_wrapper.flush()

def run_download_task(task, prg_path, stop_event=None):
    """
    Process a download task based on its type (album, track, playlist, artist).
    This function is run in a separate process.

    Args:
        task (dict): The task details
        prg_path (str): Path to the .prg file for progress updates
        stop_event (threading.Event, optional): Used to signal the process to stop gracefully.
    """
    # Register signal handler for graceful termination
    signal.signal(signal.SIGTERM, handle_termination)
    
    # Extract common parameters from the task
    download_type = task.get("download_type", "unknown")
    service = task.get("service", "")
    url = task.get("url", "")
    main = task.get("main", "")
    fallback = task.get("fallback", None)
    quality = task.get("quality", None)
    fall_quality = task.get("fall_quality", None)
    real_time = task.get("real_time", False)
    custom_dir_format = task.get("custom_dir_format", "%ar_album%/%album%/%copyright%")
    custom_track_format = task.get("custom_track_format", "%tracknum%. %music% - %artist%")
    pad_tracks = task.get("pad_tracks", True)
    
    # Extract retry configuration parameters from the task or use defaults
    max_retries = task.get("max_retries", MAX_RETRIES)
    initial_retry_delay = task.get("initial_retry_delay", RETRY_DELAY)
    retry_delay_increase = task.get("retry_delay_increase", RETRY_DELAY_INCREASE)
    
    # Get the current retry count (or 0 if not set)
    retry_count = task.get("retry_count", 0)
    
    # Calculate current retry delay based on the retry count
    current_retry_delay = initial_retry_delay + (retry_count * retry_delay_increase)
    
    # Initialize variables for cleanup in finally block
    wrapper = None
    original_stdout = sys.stdout
    original_stderr = sys.stderr
    
    try:
        # Initialize a FlushingFileWrapper for real-time progress updates
        try:
            prg_file = open(prg_path, 'a')
            wrapper = FlushingFileWrapper(prg_file)
        except Exception as e:
            print(f"Error opening PRG file {prg_path}: {e}")
            return
        
        # If this is a retry, log the retry and delay
        if retry_count > 0:
            wrapper.write(json.dumps({
                "status": "retrying",
                "retry_count": retry_count,
                "max_retries": max_retries,
                "retry_delay": current_retry_delay,
                "timestamp": time.time(),
                "message": f"Retry attempt {retry_count}/{max_retries} after {current_retry_delay}s delay"
            }) + "\n")
                
            # Sleep for the calculated delay before attempting retry
            time.sleep(current_retry_delay)
        
        # Redirect stdout and stderr to the progress file
        stdout_redirector = StdoutRedirector(wrapper)
        sys.stdout = stdout_redirector
        sys.stderr = stdout_redirector
        
        # Check for early termination
        if stop_event and stop_event.is_set():
            wrapper.write(json.dumps({
                "status": "interrupted",
                "message": "Task was interrupted before starting the download",
                "timestamp": time.time()
            }) + "\n")
            return
        
        # Dispatch to the appropriate download function based on download_type
        if download_type == "track":
            from routes.utils.track import download_track
            download_track(
                service=service,
                url=url,
                main=main,
                fallback=fallback,
                quality=quality,
                fall_quality=fall_quality,
                real_time=real_time,
                custom_dir_format=custom_dir_format,
                custom_track_format=custom_track_format,
                pad_tracks=pad_tracks,
                initial_retry_delay=initial_retry_delay,
                retry_delay_increase=retry_delay_increase,
                max_retries=max_retries
            )
        elif download_type == "album":
            from routes.utils.album import download_album
            download_album(
                service=service,
                url=url,
                main=main,
                fallback=fallback,
                quality=quality,
                fall_quality=fall_quality,
                real_time=real_time,
                custom_dir_format=custom_dir_format,
                custom_track_format=custom_track_format,
                pad_tracks=pad_tracks,
                initial_retry_delay=initial_retry_delay,
                retry_delay_increase=retry_delay_increase,
                max_retries=max_retries
            )
        elif download_type == "playlist":
            from routes.utils.playlist import download_playlist
            download_playlist(
                service=service,
                url=url,
                main=main,
                fallback=fallback,
                quality=quality,
                fall_quality=fall_quality,
                real_time=real_time,
                custom_dir_format=custom_dir_format,
                custom_track_format=custom_track_format,
                pad_tracks=pad_tracks,
                initial_retry_delay=initial_retry_delay,
                retry_delay_increase=retry_delay_increase,
                max_retries=max_retries
            )
        else:
            wrapper.write(json.dumps({
                "status": "error",
                "message": f"Unsupported download type: {download_type}",
                "can_retry": False,
                "timestamp": time.time()
            }) + "\n")
            return

        # If we got here, the download completed successfully
        wrapper.write(json.dumps({
            "status": "complete",
            "message": f"Download completed successfully.",
            "timestamp": time.time()
        }) + "\n")
        
    except Exception as e:
        if wrapper:
            traceback.print_exc()
            
            # Check if we can retry the task
            can_retry = retry_count < max_retries
            
            # Log the error and if it can be retried
            try:
                wrapper.write(json.dumps({
                    "status": "error",
                    "error": str(e),
                    "traceback": traceback.format_exc(),
                    "can_retry": can_retry,
                    "retry_count": retry_count,
                    "max_retries": max_retries,
                    "retry_delay": current_retry_delay + retry_delay_increase if can_retry else None,
                    "timestamp": time.time(),
                    "message": f"Error: {str(e)}"
                }) + "\n")
            except Exception as inner_error:
                print(f"Error writing error status to PRG file: {inner_error}")
        else:
            print(f"Error in download task (wrapper not available): {e}")
            traceback.print_exc()
    finally:
        # Restore original stdout and stderr
        sys.stdout = original_stdout
        sys.stderr = original_stderr
        
        # Safely clean up wrapper and file
        if wrapper:
            try:
                wrapper.flush()
                wrapper.close()
            except Exception as e:
                print(f"Error closing wrapper: {e}")
                
                # Try to close the underlying file directly if wrapper close fails
                try:
                    if hasattr(wrapper, 'file') and wrapper.file and not wrapper.file.closed:
                        wrapper.file.close()
                except Exception as file_error:
                    print(f"Error directly closing file: {file_error}")

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
        self.running_downloads = {}     # maps prg_filename -> (Process instance, task data, stop_event)
        self.cancelled_tasks = set()    # holds prg_filenames of tasks that have been cancelled
        self.failed_tasks = {}          # maps prg_filename -> (task data, failure count)
        self.lock = threading.Lock()    # protects access to shared data structures
        self.worker_thread = threading.Thread(target=self.queue_worker, daemon=True)
        self.running = False
        self.paused = False
        
        # Print manager configuration for debugging
        print(f"Download Queue Manager initialized with max_concurrent={self.max_concurrent}, using prg_dir={self.prg_dir}")
        
        # Load persisted queue state if available
        self.load_queue_state()
        
        # Register cleanup on application exit
        atexit.register(self.cleanup)

    def start(self):
        """Start the worker thread that monitors the queue."""
        self.running = True
        self.worker_thread.start()
        print("Download queue manager started")

    def pause(self):
        """Pause processing of new tasks."""
        self.paused = True
        print("Download queue processing paused")

    def resume(self):
        """Resume processing of tasks."""
        self.paused = False
        print("Download queue processing resumed")

    def stop(self):
        """Stop the worker thread gracefully."""
        print("Stopping download queue manager...")
        self.running = False
        self.save_queue_state()
        
        # Wait for the worker thread to finish
        if self.worker_thread.is_alive():
            self.worker_thread.join(timeout=5)
        
        # Clean up any running processes
        self.terminate_all_downloads()
        print("Download queue manager stopped")

    def cleanup(self):
        """Clean up resources when the application exits."""
        if self.running:
            self.stop()

    def save_queue_state(self):
        """Save the current queue state to a file for persistence."""
        try:
            # Build a serializable state object
            with self.lock:
                # Get current pending tasks (without removing them)
                pending_tasks = []
                with self.pending_tasks.mutex:
                    for item in list(self.pending_tasks.queue):
                        prg_filename, task = item
                        pending_tasks.append({"prg_filename": prg_filename, "task": task})
                
                # Get failed tasks
                failed_tasks = {}
                for prg_filename, (task, retry_count) in self.failed_tasks.items():
                    failed_tasks[prg_filename] = {"task": task, "retry_count": retry_count}
                
                state = {
                    "pending_tasks": pending_tasks,
                    "failed_tasks": failed_tasks,
                    "cancelled_tasks": list(self.cancelled_tasks)
                }
                
                # Write state to file
                with open(QUEUE_STATE_FILE, 'w') as f:
                    json.dump(state, f)
        except Exception as e:
            print(f"Error saving queue state: {e}")

    def load_queue_state(self):
        """Load queue state from a persistent file if available."""
        try:
            if os.path.exists(QUEUE_STATE_FILE):
                with open(QUEUE_STATE_FILE, 'r') as f:
                    state = json.load(f)
                
                # Restore state
                with self.lock:
                    # Restore pending tasks
                    for task_info in state.get("pending_tasks", []):
                        self.pending_tasks.put((task_info["prg_filename"], task_info["task"]))
                    
                    # Restore failed tasks
                    for prg_filename, task_info in state.get("failed_tasks", {}).items():
                        self.failed_tasks[prg_filename] = (task_info["task"], task_info["retry_count"])
                    
                    # Restore cancelled tasks
                    self.cancelled_tasks = set(state.get("cancelled_tasks", []))
                
                print(f"Loaded queue state: {len(state.get('pending_tasks', []))} pending tasks, {len(state.get('failed_tasks', {}))} failed tasks")
        except Exception as e:
            print(f"Error loading queue state: {e}")

    def add_task(self, task):
        """
        Adds a new download task to the queue.
        The task is expected to be a dictionary with all necessary parameters,
        including a "download_type" key (album, track, playlist, or artist).

        A .prg file is created for progress logging with an initial entries:
          1. The original request (merged with the extra keys: type, name, artist)
          2. A queued status entry (including type, name, artist, and the task's position in the queue)

        Returns the generated prg filename so that the caller can later check the status or request cancellation.
        """
        download_type = task.get("download_type", "unknown")

        # Determine the new task's position by scanning the PRG_DIR for files matching the naming scheme.
        existing_positions = []
        try:
            for filename in os.listdir(self.prg_dir):
                if filename.startswith(f"{download_type}_") and filename.endswith(".prg"):
                    try:
                        # Filename format: download_type_<number>.prg
                        number_part = filename[len(download_type) + 1:-4]
                        pos_num = int(number_part)
                        existing_positions.append(pos_num)
                    except ValueError:
                        continue  # Skip files that do not conform to the naming scheme.
        except Exception as e:
            print(f"Error scanning directory: {e}")
            # If we can't scan the directory, generate a random filename instead
            return self._add_task_with_random_filename(task)
            
        position = max(existing_positions, default=0) + 1

        # Generate the prg filename based on the download type and determined position.
        prg_filename = f"{download_type}_{position}.prg"
        prg_path = os.path.join(self.prg_dir, prg_filename)
        task['prg_path'] = prg_path

        # Initialize retry count and add retry parameters
        task['retry_count'] = 0
        
        # Get retry configuration from config, or use what's provided in the task
        config_params = get_config_params()
        task['max_retries'] = task.get('max_retries', config_params.get('maxRetries', MAX_RETRIES))
        task['initial_retry_delay'] = task.get('initial_retry_delay', config_params.get('retryDelaySeconds', RETRY_DELAY))
        task['retry_delay_increase'] = task.get('retry_delay_increase', config_params.get('retry_delay_increase', RETRY_DELAY_INCREASE))

        # Create and immediately write the initial entries to the .prg file.
        try:
            with open(prg_path, 'w') as f:
                # Merge extra keys into the original request.
                original_request = task.get("orig_request", {}).copy()
                
                # Add essential metadata for retry operations
                original_request["download_type"] = download_type
                
                # Ensure key information is included
                for key in ["type", "name", "artist", "service", "url"]:
                    if key in task and key not in original_request:
                        original_request[key] = task[key]
                
                # Add API endpoint information
                if "endpoint" not in original_request:
                    original_request["endpoint"] = f"/api/{download_type}/download"
                
                # Add explicit display information for the frontend
                original_request["display_title"] = task.get("name", original_request.get("name", "Unknown"))
                original_request["display_type"] = task.get("type", original_request.get("type", download_type))
                original_request["display_artist"] = task.get("artist", original_request.get("artist", ""))
                
                # Write the first entry - the enhanced original request params
                f.write(json.dumps(original_request) + "\n")
                
                # Write the second entry - the queued status
                f.write(json.dumps({
                    "status": "queued",
                    "timestamp": time.time(),
                    "type": task.get("type", ""),
                    "name": task.get("name", ""),
                    "artist": task.get("artist", ""),
                    "retry_count": 0,
                    "max_retries": task.get('max_retries', MAX_RETRIES),
                    "initial_retry_delay": task.get('initial_retry_delay', RETRY_DELAY),
                    "retry_delay_increase": task.get('retry_delay_increase', RETRY_DELAY_INCREASE),
                    "queue_position": self.pending_tasks.qsize() + 1
                }) + "\n")
        except Exception as e:
            print(f"Error writing to PRG file: {e}")
            # If we can't create the file, try with a random filename
            return self._add_task_with_random_filename(task)
        
        # Add the task to the pending queue
        self.pending_tasks.put((prg_filename, task))
        self.save_queue_state()

        print(f"Added task {prg_filename} to download queue")
        return prg_filename

    def _add_task_with_random_filename(self, task):
        """
        Helper method to create a task with a random filename
        in case we can't generate a sequential filename.
        """
        try:
            download_type = task.get("download_type", "unknown")
            random_id = generate_random_filename(extension="")
            prg_filename = f"{download_type}_{random_id}.prg"
            prg_path = os.path.join(self.prg_dir, prg_filename)
            task['prg_path'] = prg_path
            
            # Initialize retry count and add retry parameters
            task['retry_count'] = 0
            
            # Get retry configuration from config, or use what's provided in the task
            config_params = get_config_params()
            task['max_retries'] = task.get('max_retries', config_params.get('maxRetries', MAX_RETRIES))
            task['initial_retry_delay'] = task.get('initial_retry_delay', config_params.get('retryDelaySeconds', RETRY_DELAY))
            task['retry_delay_increase'] = task.get('retry_delay_increase', config_params.get('retry_delay_increase', RETRY_DELAY_INCREASE))
            
            with open(prg_path, 'w') as f:
                # Merge extra keys into the original request
                original_request = task.get("orig_request", {}).copy()
                
                # Add essential metadata for retry operations
                original_request["download_type"] = download_type
                
                # Ensure key information is included
                for key in ["type", "name", "artist", "service", "url"]:
                    if key in task and key not in original_request:
                        original_request[key] = task[key]
                
                # Add API endpoint information
                if "endpoint" not in original_request:
                    original_request["endpoint"] = f"/api/{download_type}/download"
                
                # Add explicit display information for the frontend
                original_request["display_title"] = task.get("name", original_request.get("name", "Unknown"))
                original_request["display_type"] = task.get("type", original_request.get("type", download_type))
                original_request["display_artist"] = task.get("artist", original_request.get("artist", ""))
                
                # Write the first entry - the enhanced original request params
                f.write(json.dumps(original_request) + "\n")
                
                # Write the second entry - the queued status
                f.write(json.dumps({
                    "status": "queued",
                    "timestamp": time.time(),
                    "type": task.get("type", ""),
                    "name": task.get("name", ""),
                    "artist": task.get("artist", ""),
                    "retry_count": 0,
                    "max_retries": task.get('max_retries', MAX_RETRIES),
                    "initial_retry_delay": task.get('initial_retry_delay', RETRY_DELAY),
                    "retry_delay_increase": task.get('retry_delay_increase', RETRY_DELAY_INCREASE),
                    "queue_position": self.pending_tasks.qsize() + 1
                }) + "\n")
            
            self.pending_tasks.put((prg_filename, task))
            self.save_queue_state()
            
            print(f"Added task {prg_filename} to download queue (with random filename)")
            return prg_filename
        except Exception as e:
            print(f"Error adding task with random filename: {e}")
            return None

    def retry_task(self, prg_filename):
        """
        Retry a failed task by creating a new PRG file and adding it back to the queue.
        """
        with self.lock:
            # Check if the task is in failed_tasks
            if prg_filename not in self.failed_tasks:
                return {
                    "status": "error",
                    "message": f"Task {prg_filename} not found in failed tasks"
                }
            
            task, retry_count = self.failed_tasks.pop(prg_filename)
            # Increment the retry count
            task["retry_count"] = retry_count + 1
            
            # Get retry configuration parameters from config, not from the task
            config_params = get_config_params()
            max_retries = config_params.get('maxRetries', MAX_RETRIES)
            initial_retry_delay = config_params.get('retryDelaySeconds', RETRY_DELAY)
            retry_delay_increase = config_params.get('retry_delay_increase', RETRY_DELAY_INCREASE)
            
            # Update task with the latest config values
            task["max_retries"] = max_retries
            task["initial_retry_delay"] = initial_retry_delay
            task["retry_delay_increase"] = retry_delay_increase
            
            # Calculate the new retry delay
            current_retry_delay = initial_retry_delay + (task["retry_count"] * retry_delay_increase)
            
            # If we've exceeded the maximum retries, return an error
            if task["retry_count"] > max_retries:
                return {
                    "status": "error",
                    "message": f"Maximum retry attempts ({max_retries}) exceeded"
                }
            
            # Use the same download type as the original task.
            download_type = task.get("download_type", "unknown")
            
            # Generate a new task with a new PRG filename for the retry.
            # We're using the original file name with a retry count suffix.
            original_name = os.path.splitext(prg_filename)[0]
            new_prg_filename = f"{original_name}_retry{task['retry_count']}.prg"
            new_prg_path = os.path.join(self.prg_dir, new_prg_filename)
            task["prg_path"] = new_prg_path
            
            # Try to load the original request information from the original PRG file
            original_request = {}
            original_prg_path = os.path.join(self.prg_dir, prg_filename)
            try:
                if os.path.exists(original_prg_path):
                    with open(original_prg_path, 'r') as f:
                        first_line = f.readline().strip()
                        if first_line:
                            try:
                                original_request = json.loads(first_line)
                            except json.JSONDecodeError:
                                pass
            except Exception as e:
                print(f"Error reading original request from {prg_filename}: {e}")
            
            # If we couldn't get the original request, use what we have in the task
            if not original_request:
                original_request = task.get("orig_request", {}).copy()
                # Add essential metadata for retry operations
                original_request["download_type"] = download_type
                for key in ["type", "name", "artist", "service", "url"]:
                    if key in task and key not in original_request:
                        original_request[key] = task[key]
                # Add API endpoint information
                if "endpoint" not in original_request:
                    original_request["endpoint"] = f"/api/{download_type}/download"
                
                # Add explicit display information for the frontend
                original_request["display_title"] = task.get("name", "Unknown")
                original_request["display_type"] = task.get("type", download_type)
                original_request["display_artist"] = task.get("artist", "")
            elif not any(key in original_request for key in ["display_title", "display_type", "display_artist"]):
                # Ensure display fields exist if they weren't in the original request
                original_request["display_title"] = original_request.get("name", task.get("name", "Unknown"))
                original_request["display_type"] = original_request.get("type", task.get("type", download_type))
                original_request["display_artist"] = original_request.get("artist", task.get("artist", ""))
            
            # Create and immediately write the retry information to the new PRG file.
            try:
                with open(new_prg_path, 'w') as f:
                    # First, write the original request information
                    f.write(json.dumps(original_request) + "\n")
                    
                    # Then write the queued status with retry information
                    f.write(json.dumps({
                        "status": "queued",
                        "type": task.get("type", "unknown"),
                        "name": task.get("name", "Unknown"),
                        "artist": task.get("artist", "Unknown"),
                        "retry_count": task["retry_count"],
                        "max_retries": max_retries,
                        "retry_delay": current_retry_delay,
                        "timestamp": time.time()
                    }) + "\n")
            except Exception as e:
                print(f"Error creating retry PRG file: {e}")
                return {
                    "status": "error",
                    "message": f"Failed to create retry file: {str(e)}"
                }
            
            # Add the task to the pending_tasks queue.
            self.pending_tasks.put((new_prg_filename, task))
            print(f"Requeued task {new_prg_filename} for retry (attempt {task['retry_count']})")
            
            # Save updated queue state
            self.save_queue_state()
            
            return {
                "status": "requeued",
                "prg_file": new_prg_filename,
                "retry_count": task["retry_count"],
                "max_retries": max_retries,
                "retry_delay": current_retry_delay,
            }

    def cancel_task(self, prg_filename):
        """
        Cancels a running or queued download task by its PRG filename.
        Returns a status dictionary that should be returned to the client.
        """
        prg_path = os.path.join(self.prg_dir, prg_filename)
        
        # First, check if the task is even valid (file exists)
        if not os.path.exists(prg_path):
            return {"status": "error", "message": f"Task {prg_filename} not found"}
            
        with self.lock:
            # Check if task is currently running
            if prg_filename in self.running_downloads:
                # Get the process and stop event
                process, task, stop_event = self.running_downloads[prg_filename]
                
                # Signal the process to stop gracefully using the event
                stop_event.set()
                
                # Give the process a short time to terminate gracefully
                process.join(timeout=2)
                
                # If the process is still alive, terminate it forcefully
                if process.is_alive():
                    print(f"Terminating process for {prg_filename} forcefully")
                    process.terminate()
                    process.join(timeout=1)
                    
                    # If still alive after terminate, kill it
                    if process.is_alive():
                        print(f"Process for {prg_filename} not responding to terminate, killing")
                        try:
                            if hasattr(process, 'kill'):
                                process.kill()
                            else:
                                os.kill(process.pid, signal.SIGKILL)
                        except:
                            print(f"Error killing process for {prg_filename}")
                
                # Clean up by removing from running downloads
                del self.running_downloads[prg_filename]
                
                # Update the PRG file to indicate cancellation
                try:
                    with open(prg_path, 'a') as f:
                        f.write(json.dumps({
                            "status": "cancel",
                            "timestamp": time.time()
                        }) + "\n")
                except Exception as e:
                    print(f"Error writing cancel status: {e}")
                
                print(f"Cancelled running task: {prg_filename}")
                return {"status": "cancelled", "prg_file": prg_filename}
            
            # If not running, check if it's a planned retry
            if prg_filename in self.failed_tasks:
                del self.failed_tasks[prg_filename]
                
                # Update the PRG file to indicate cancellation
                try:
                    with open(prg_path, 'a') as f:
                        f.write(json.dumps({
                            "status": "cancel",
                            "timestamp": time.time()
                        }) + "\n")
                except Exception as e:
                    print(f"Error writing cancel status: {e}")
                
                print(f"Cancelled retry task: {prg_filename}")
                return {"status": "cancelled", "prg_file": prg_filename}
                
            # If not running, it might be queued; mark as cancelled
            self.cancelled_tasks.add(prg_filename)
            
            # If it's in the queue, try to update its status in the PRG file
            try:
                with open(prg_path, 'a') as f:
                    f.write(json.dumps({
                        "status": "cancel", 
                        "timestamp": time.time()
                    }) + "\n")
            except Exception as e:
                print(f"Error writing cancel status: {e}")
            
            print(f"Marked queued task as cancelled: {prg_filename}")
            return {"status": "cancelled", "prg_file": prg_filename}

    def cancel_all_tasks(self):
        """Cancel all currently queued and running tasks."""
        with self.lock:
            # First, mark all pending tasks as cancelled
            with self.pending_tasks.mutex:
                for item in list(self.pending_tasks.queue):
                    prg_filename, _ = item
                    self.cancelled_tasks.add(prg_filename)
                    prg_path = os.path.join(self.prg_dir, prg_filename)
                    try:
                        with open(prg_path, 'a') as f:
                            f.write(json.dumps({
                                "status": "cancel",
                                "message": "Task was cancelled by user",
                                "timestamp": time.time()
                            }) + "\n")
                    except Exception as e:
                        print(f"Error writing cancelled status for {prg_filename}: {e}")
                # Clear the queue        
                self.pending_tasks.queue.clear()
            
            # Next, terminate all running tasks
            for prg_filename, (process, _, stop_event) in list(self.running_downloads.items()):
                if stop_event:
                    stop_event.set()
                    
                if process and process.is_alive():
                    try:
                        process.terminate()
                        prg_path = os.path.join(self.prg_dir, prg_filename)
                        with open(prg_path, 'a') as f:
                            f.write(json.dumps({
                                "status": "cancel",
                                "message": "Task was cancelled by user",
                                "timestamp": time.time()
                            }) + "\n")
                    except Exception as e:
                        print(f"Error cancelling task {prg_filename}: {e}")
            
            # Clear all running downloads
            self.running_downloads.clear()

            # Clear failed tasks
            self.failed_tasks.clear()
            
            self.save_queue_state()
            return {"status": "all_cancelled"}

    def terminate_all_downloads(self):
        """Terminate all running download processes."""
        with self.lock:
            for prg_filename, (process, _, stop_event) in list(self.running_downloads.items()):
                if stop_event:
                    stop_event.set()
                
                if process and process.is_alive():
                    try:
                        process.terminate()
                        process.join(timeout=2)
                        if process.is_alive():
                            print(f"Process for {prg_filename} did not terminate, forcing kill")
                            process.kill()
                            process.join(timeout=1)
                    except Exception as e:
                        print(f"Error terminating process: {e}")
            
            self.running_downloads.clear()

    def get_queue_status(self):
        """Get the current status of the queue."""
        with self.lock:
            running_count = len(self.running_downloads)
            pending_count = self.pending_tasks.qsize()
            failed_count = len(self.failed_tasks)
            
            # Get info about current running tasks
            running_tasks = []
            for prg_filename, (_, task, _) in self.running_downloads.items():
                running_tasks.append({
                    "prg_filename": prg_filename,
                    "name": task.get("name", "Unknown"),
                    "type": task.get("type", "unknown"),
                    "download_type": task.get("download_type", "unknown")
                })
            
            # Get info about failed tasks
            failed_tasks = []
            for prg_filename, (task, retry_count) in self.failed_tasks.items():
                failed_tasks.append({
                    "prg_filename": prg_filename,
                    "name": task.get("name", "Unknown"),
                    "type": task.get("type", "unknown"),
                    "download_type": task.get("download_type", "unknown"),
                    "retry_count": retry_count
                })
            
            return {
                "running": running_count,
                "pending": pending_count,
                "failed": failed_count,
                "max_concurrent": self.max_concurrent,
                "paused": self.paused,
                "running_tasks": running_tasks,
                "failed_tasks": failed_tasks
            }

    def check_for_stuck_tasks(self):
        """
        Scan for tasks that appear to be stuck and requeue them if necessary.
        Called periodically by the queue worker.
        """
        print("Checking for stuck tasks...")
        
        # First, scan the running tasks to see if any processes are defunct
        with self.lock:
            defunct_tasks = []
            stalled_tasks = []
            current_time = time.time()
            
            for prg_filename, (process, task, stop_event) in list(self.running_downloads.items()):
                if not process.is_alive():
                    # Process is no longer alive but wasn't cleaned up
                    defunct_tasks.append((prg_filename, task))
                    print(f"Found defunct task {prg_filename}, process is no longer alive")
                
                # Check task prg file timestamp to detect stalled tasks
                prg_path = os.path.join(self.prg_dir, prg_filename)
                try:
                    last_modified = os.path.getmtime(prg_path)
                    if current_time - last_modified > 300:  # 5 minutes
                        print(f"Task {prg_filename} may be stalled, last activity: {current_time - last_modified:.1f} seconds ago")
                        # Add to stalled tasks list for potential termination
                        stalled_tasks.append((prg_filename, process, task, stop_event))
                except Exception as e:
                    print(f"Error checking task timestamp: {e}")
            
            # Clean up defunct tasks
            for prg_filename, task in defunct_tasks:
                print(f"Cleaning up defunct task: {prg_filename}")
                del self.running_downloads[prg_filename]
                
                # If task still has retries left, requeue it
                retry_count = task.get("retry_count", 0)
                if retry_count < MAX_RETRIES:
                    task["retry_count"] = retry_count + 1
                    print(f"Requeuing task {prg_filename}, retry count: {task['retry_count']}")
                    
                    # Update the PRG file to indicate the task is being requeued
                    prg_path = os.path.join(self.prg_dir, prg_filename)
                    try:
                        with open(prg_path, 'a') as f:
                            f.write(json.dumps({
                                "status": "requeued",
                                "message": "Task was automatically requeued after process died",
                                "retry_count": task["retry_count"],
                                "timestamp": time.time()
                            }) + "\n")
                    except Exception as e:
                        print(f"Error writing to PRG file for requeued task: {e}")
                    
                    self.pending_tasks.put((prg_filename, task))
                else:
                    # No more retries - mark as failed
                    try:
                        with open(prg_path, 'a') as f:
                            f.write(json.dumps({
                                "status": "error",
                                "message": "Task failed - maximum retry count reached",
                                "can_retry": False,
                                "timestamp": time.time()
                            }) + "\n")
                    except Exception as e:
                        print(f"Error writing to PRG file for failed task: {e}")
            
            # Handle stalled tasks
            for prg_filename, process, task, stop_event in stalled_tasks:
                print(f"Terminating stalled task {prg_filename}")
                
                # Signal the process to stop gracefully
                if stop_event:
                    stop_event.set()
                
                # Give it a short time to terminate gracefully
                process.join(timeout=2)
                
                # If still alive, terminate forcefully
                if process.is_alive():
                    process.terminate()
                    process.join(timeout=1)
                    
                    # If still alive after terminate, kill it
                    if process.is_alive():
                        try:
                            if hasattr(process, 'kill'):
                                process.kill()
                            else:
                                os.kill(process.pid, signal.SIGKILL)
                        except Exception as e:
                            print(f"Error killing process for {prg_filename}: {e}")
                
                # Remove from running downloads
                del self.running_downloads[prg_filename]
                
                # If task still has retries left, requeue it
                retry_count = task.get("retry_count", 0)
                if retry_count < MAX_RETRIES:
                    task["retry_count"] = retry_count + 1
                    print(f"Requeuing stalled task {prg_filename}, retry count: {task['retry_count']}")
                    
                    # Update the PRG file to indicate the task is being requeued
                    prg_path = os.path.join(self.prg_dir, prg_filename)
                    try:
                        with open(prg_path, 'a') as f:
                            f.write(json.dumps({
                                "status": "requeued",
                                "message": "Task was automatically requeued after stalling",
                                "retry_count": task["retry_count"],
                                "timestamp": time.time()
                            }) + "\n")
                    except Exception as e:
                        print(f"Error writing to PRG file for requeued task: {e}")
                    
                    self.pending_tasks.put((prg_filename, task))
                else:
                    # No more retries - mark as failed
                    prg_path = os.path.join(self.prg_dir, prg_filename)
                    try:
                        with open(prg_path, 'a') as f:
                            f.write(json.dumps({
                                "status": "error",
                                "message": "Task stalled - maximum retry count reached",
                                "can_retry": False,
                                "timestamp": time.time()
                            }) + "\n")
                    except Exception as e:
                        print(f"Error writing to PRG file for failed task: {e}")
                        
            # Save queue state after processing stuck tasks
            if defunct_tasks or stalled_tasks:
                self.save_queue_state()

    def queue_worker(self):
        """
        Worker thread that continuously monitors the pending_tasks queue.
        It cleans up finished download processes and starts new ones if the
        number of running downloads is less than the allowed maximum.
        """
        last_stuck_check = time.time()
        
        while self.running:
            try:
                # Periodically check for stuck tasks
                current_time = time.time()
                if current_time - last_stuck_check > 60:  # Check every minute
                    self.check_for_stuck_tasks()
                    last_stuck_check = current_time
                
                # First, clean up any finished processes.
                with self.lock:
                    finished = []
                    for prg_filename, (process, task, _) in list(self.running_downloads.items()):
                        if not process.is_alive():
                            finished.append((prg_filename, task))
                    
                    for prg_filename, task in finished:
                        del self.running_downloads[prg_filename]
                        
                        # Check if the task completed successfully or failed
                        prg_path = os.path.join(self.prg_dir, prg_filename)
                        try:
                            # Read the last line of the prg file to check status
                            with open(prg_path, 'r') as f:
                                lines = f.readlines()
                                if lines:
                                    last_line = lines[-1].strip()
                                    try:
                                        status = json.loads(last_line)
                                        # Check if the task failed and can be retried
                                        if status.get("status") == "error" and status.get("can_retry", False):
                                            retry_count = task.get("retry_count", 0)
                                            if retry_count < MAX_RETRIES:
                                                # Add to failed tasks for potential retry
                                                self.failed_tasks[prg_filename] = (task, retry_count)
                                                print(f"Task {prg_filename} failed and can be retried. Current retry count: {retry_count}")
                                    except json.JSONDecodeError:
                                        # Not valid JSON, ignore
                                        pass
                        except Exception as e:
                            print(f"Error checking task completion status: {e}")

                # Get the current count of running downloads with the lock held
                running_count = len(self.running_downloads)
                
                # Log current capacity for debugging
                print(f"Queue status: {running_count}/{self.max_concurrent} running, {self.pending_tasks.qsize()} pending, paused: {self.paused}")

                # Start new tasks if there is available capacity and not paused.
                if running_count < self.max_concurrent and not self.paused:
                    try:
                        # Try to get a new task, but don't block for too long
                        prg_filename, task = self.pending_tasks.get(timeout=1)
                    except Empty:
                        time.sleep(0.5)
                        continue

                    # Check if the task was cancelled while it was still queued.
                    with self.lock:
                        if prg_filename in self.cancelled_tasks:
                            # Task has been cancelled; remove it from the set and skip processing.
                            self.cancelled_tasks.remove(prg_filename)
                            print(f"Task {prg_filename} was cancelled while queued, skipping")
                            continue

                    prg_path = task.get('prg_path')
                    
                    # Write a status update that the task is now processing
                    try:
                        with open(prg_path, 'a') as f:
                            f.write(json.dumps({
                                "status": "processing",
                                "timestamp": time.time()
                            }) + "\n")
                    except Exception as e:
                        print(f"Error writing processing status: {e}")
                    
                    # Create a stop event for graceful shutdown
                    stop_event = Event()
                    
                    # Create and start a new process for the task.
                    p = Process(
                        target=run_download_task,
                        args=(task, prg_path, stop_event)
                    )
                    with self.lock:
                        self.running_downloads[prg_filename] = (p, task, stop_event)
                    p.start()
                    print(f"Started download process for {prg_filename}")
                else:
                    # At capacity or paused; sleep briefly.
                    time.sleep(1)
            except Exception as e:
                print(f"Error in queue worker: {e}")
                traceback.print_exc()
            
            # Small sleep to avoid a tight loop.
            time.sleep(0.1)
            
            # Periodically save queue state
            if random.randint(1, 100) == 1:  # ~1% chance each iteration
                self.save_queue_state()

# ------------------------------------------------------------------------------
# Global Instance
# ------------------------------------------------------------------------------

# Create and start a global instance of the queue manager.
download_queue_manager = DownloadQueueManager()
download_queue_manager.start()
