import os
import json
import signal
import subprocess
import logging
import time
import atexit
from pathlib import Path
import threading
import queue
import sys
import uuid

# Import Celery task utilities
from .celery_tasks import (
    ProgressState,
    get_task_info,
    get_last_task_status,
    store_task_status,
    get_all_tasks as get_all_celery_tasks_info,
    cleanup_stale_errors
)
from .celery_config import get_config_params

# Configure logging
logger = logging.getLogger(__name__)

# Configuration
CONFIG_PATH = './data/config/main.json'
CELERY_APP = 'routes.utils.celery_tasks.celery_app'
CELERY_PROCESS = None
CONFIG_CHECK_INTERVAL = 30  # seconds

class CeleryManager:
    """
    Manages Celery workers dynamically based on configuration changes.
    """
    
    def __init__(self):
        self.celery_process = None
        self.current_worker_count = 0
        self.monitoring_thread = None
        self.error_cleanup_thread = None
        self.running = False
        self.log_queue = queue.Queue()
        self.output_threads = []
    
    def _cleanup_stale_tasks(self):
        logger.info("Cleaning up potentially stale Celery tasks...")
        try:
            tasks = get_all_celery_tasks_info() 
            if not tasks:
                logger.info("No tasks found in Redis to check for staleness.")
                return

            active_stale_states = [
                ProgressState.PROCESSING,
                ProgressState.INITIALIZING,
                ProgressState.DOWNLOADING,
                ProgressState.PROGRESS,
                ProgressState.REAL_TIME,
                ProgressState.RETRYING
            ]
            
            stale_tasks_count = 0
            for task_summary in tasks:
                task_id = task_summary.get("task_id")
                if not task_id:
                    continue

                last_status_data = get_last_task_status(task_id)
                if last_status_data:
                    current_status_str = last_status_data.get("status")
                    if current_status_str in active_stale_states:
                        logger.warning(f"Task {task_id} ('{task_summary.get('name', 'Unknown')}') found in stale state '{current_status_str}'. Marking as error.")
                        
                        task_info_details = get_task_info(task_id)
                        config = get_config_params()
                        
                        error_payload = {
                            "status": ProgressState.ERROR,
                            "message": "Task interrupted due to application restart.",
                            "error": "Task interrupted due to application restart.",
                            "timestamp": time.time(),
                            "type": task_info_details.get("type", task_summary.get("type", "unknown")),
                            "name": task_info_details.get("name", task_summary.get("name", "Unknown")),
                            "artist": task_info_details.get("artist", task_summary.get("artist", "")),
                            "can_retry": True,
                            "retry_count": last_status_data.get("retry_count", 0),
                            "max_retries": config.get('maxRetries', 3)
                        }
                        store_task_status(task_id, error_payload)
                        stale_tasks_count += 1
            
            if stale_tasks_count > 0:
                logger.info(f"Marked {stale_tasks_count} stale tasks as 'error'.")
            else:
                logger.info("No stale tasks found that needed cleanup.")

        except Exception as e:
            logger.error(f"Error during stale task cleanup: {e}", exc_info=True)

    def start(self):
        """Start the Celery manager and initial workers"""
        if self.running:
            return
            
        self.running = True
        
        # Clean up stale tasks BEFORE starting/restarting workers
        self._cleanup_stale_tasks()
        
        # Start initial workers
        self._update_workers()
        
        # Start monitoring thread for config changes
        self.monitoring_thread = threading.Thread(target=self._monitor_config, daemon=True)
        self.monitoring_thread.start()

        # Start periodic error cleanup thread
        self.error_cleanup_thread = threading.Thread(target=self._run_periodic_error_cleanup, daemon=True)
        self.error_cleanup_thread.start()
        
        # Register shutdown handler
        atexit.register(self.stop)
    
    def stop(self):
        """Stop the Celery manager and all workers"""
        self.running = False
        
        # Stop all running threads
        for thread in self.output_threads:
            if thread.is_alive():
                # We can't really stop the threads, but they'll exit on their own
                # when the process is terminated since they're daemon threads
                pass
        
        if self.celery_process:
            logger.info("Stopping Celery workers...")
            try:
                # Send SIGTERM to process group
                os.killpg(os.getpgid(self.celery_process.pid), signal.SIGTERM)
                self.celery_process.wait(timeout=5)
            except (subprocess.TimeoutExpired, ProcessLookupError):
                # Force kill if not terminated
                try:
                    os.killpg(os.getpgid(self.celery_process.pid), signal.SIGKILL)
                except ProcessLookupError:
                    pass
            
            self.celery_process = None
            self.current_worker_count = 0
    
    def _get_worker_count(self):
        """Get the configured worker count from config file"""
        try:
            if not Path(CONFIG_PATH).exists():
                return 3  # Default
                
            with open(CONFIG_PATH, 'r') as f:
                config = json.load(f)
            
            return int(config.get('maxConcurrentDownloads', 3))
        except Exception as e:
            logger.error(f"Error reading worker count from config: {e}")
            return 3  # Default on error
    
    def _update_workers(self):
        """Update workers if needed based on configuration"""
        new_worker_count = self._get_worker_count()
        
        if new_worker_count == self.current_worker_count and self.celery_process and self.celery_process.poll() is None:
            return  # No change and process is running
        
        logger.info(f"Updating Celery workers from {self.current_worker_count} to {new_worker_count}")
        
        # Stop existing workers if running
        if self.celery_process:
            try:
                logger.info("Stopping existing Celery workers...")
                os.killpg(os.getpgid(self.celery_process.pid), signal.SIGTERM)
                self.celery_process.wait(timeout=5)
            except (subprocess.TimeoutExpired, ProcessLookupError):
                try:
                    logger.warning("Forcibly killing Celery workers with SIGKILL")
                    os.killpg(os.getpgid(self.celery_process.pid), signal.SIGKILL)
                except ProcessLookupError:
                    pass
            
            # Clear output threads list
            self.output_threads = []
            
            # Wait a moment to ensure processes are terminated
            time.sleep(2)
        
        # Additional cleanup - find and kill any stray Celery processes
        try:
            # This runs a shell command to find and kill all celery processes
            subprocess.run(
                "ps aux | grep 'celery -A routes.utils.celery_tasks.celery_app worker' | grep -v grep | awk '{print $2}' | xargs -r kill -9",
                shell=True,
                stderr=subprocess.PIPE
            )
            logger.info("Killed any stray Celery processes")
            
            # Wait a moment to ensure processes are terminated
            time.sleep(1)
        except Exception as e:
            logger.error(f"Error during stray process cleanup: {e}")
        
        # Start new workers with updated concurrency
        try:
            # Set environment variables to configure Celery logging
            env = os.environ.copy()
            env['PYTHONUNBUFFERED'] = '1'  # Ensure Python output is unbuffered
            
            # Construct command with extra logging options
            cmd = [
                'celery',
                '-A', CELERY_APP,
                'worker',
                '--loglevel=info',
                f'--concurrency={new_worker_count}',
                '-Q', 'downloads',
                '--logfile=-',  # Output logs to stdout
                '--without-heartbeat',  # Reduce log noise
                '--without-gossip',     # Reduce log noise
                '--without-mingle',     # Reduce log noise
                # Add unique worker name to prevent conflicts
                f'--hostname=worker@%h-{uuid.uuid4()}'
            ]
            
            logger.info(f"Starting new Celery workers with command: {' '.join(cmd)}")
            
            self.celery_process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=env,
                preexec_fn=os.setsid,  # New process group for clean termination
                universal_newlines=True,
                bufsize=1  # Line buffered
            )
            
            self.current_worker_count = new_worker_count
            logger.info(f"Started Celery workers with concurrency {new_worker_count}, PID: {self.celery_process.pid}")
            
            # Verify the process started correctly
            time.sleep(2)
            if self.celery_process.poll() is not None:
                # Process exited prematurely
                stdout, stderr = "", ""
                try:
                    stdout, stderr = self.celery_process.communicate(timeout=1)
                except subprocess.TimeoutExpired:
                    pass
                
                logger.error(f"Celery workers failed to start. Exit code: {self.celery_process.poll()}")
                logger.error(f"Stdout: {stdout}")
                logger.error(f"Stderr: {stderr}")
                self.celery_process = None
                raise RuntimeError("Celery workers failed to start")
            
            # Start non-blocking output reader threads for both stdout and stderr
            stdout_thread = threading.Thread(
                target=self._process_output_reader,
                args=(self.celery_process.stdout, "STDOUT"),
                daemon=True
            )
            stdout_thread.start()
            self.output_threads.append(stdout_thread)
            
            stderr_thread = threading.Thread(
                target=self._process_output_reader,
                args=(self.celery_process.stderr, "STDERR"),
                daemon=True
            )
            stderr_thread.start()
            self.output_threads.append(stderr_thread)
            
        except Exception as e:
            logger.error(f"Error starting Celery workers: {e}")
            # In case of failure, make sure we don't leave orphaned processes
            if self.celery_process and self.celery_process.poll() is None:
                try:
                    os.killpg(os.getpgid(self.celery_process.pid), signal.SIGKILL)
                except (ProcessLookupError, OSError):
                    pass
            self.celery_process = None
    
    def _process_output_reader(self, pipe, stream_name):
        """Read and log output from the process"""
        try:
            for line in iter(pipe.readline, ''):
                if not line:
                    break
                    
                line = line.strip()
                if not line:
                    continue
                
                # Format the message to identify it's from Celery
                if "ERROR" in line or "CRITICAL" in line:
                    logger.error(f"Celery[{stream_name}]: {line}")
                elif "WARNING" in line:
                    logger.warning(f"Celery[{stream_name}]: {line}")
                elif "DEBUG" in line:
                    logger.debug(f"Celery[{stream_name}]: {line}")
                else:
                    logger.info(f"Celery[{stream_name}]: {line}")
                    
        except Exception as e:
            logger.error(f"Error processing Celery output: {e}")
        finally:
            pipe.close()
    
    def _monitor_config(self):
        """Monitor configuration file for changes"""
        logger.info("Starting config monitoring thread")
        last_check_time = 0
        
        while self.running:
            try:
                # Check for changes
                if time.time() - last_check_time >= CONFIG_CHECK_INTERVAL:
                    self._update_workers()
                    last_check_time = time.time()
                
                time.sleep(1)
            except Exception as e:
                logger.error(f"Error in config monitoring thread: {e}")
                time.sleep(5)  # Wait before retrying

    def _run_periodic_error_cleanup(self):
        """Periodically triggers the cleanup_stale_errors Celery task."""
        cleanup_interval = 60  # Run cleanup task every 60 seconds
        logger.info(f"Starting periodic error cleanup scheduler (runs every {cleanup_interval}s).")
        while self.running:
            try:
                logger.info("Scheduling cleanup_stale_errors task...")
                cleanup_stale_errors.delay() # Call the Celery task
            except Exception as e:
                logger.error(f"Error scheduling cleanup_stale_errors task: {e}", exc_info=True)
            
            # Wait for the next interval
            # Use a loop to check self.running more frequently to allow faster shutdown
            for _ in range(cleanup_interval):
                if not self.running:
                    break
                time.sleep(1)
        logger.info("Periodic error cleanup scheduler stopped.")

# Create single instance
celery_manager = CeleryManager() 