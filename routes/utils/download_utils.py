import logging
import shutil
from pathlib import Path
from .celery_config import get_config_params

# Configure logging
logger = logging.getLogger(__name__)


def get_download_output_dir(config_params: dict = None) -> str:
    """
    Get the output directory for downloads based on configuration.
    If incomplete download folder is configured and accessible, use that; otherwise use standard downloads folder.
    
    Args:
        config_params: Configuration parameters dict. If None, will load from config file.
        
    Returns:
        str: Path to the output directory for downloads
    """
    if config_params is None:
        config_params = get_config_params()
    
    incomplete_folder = config_params.get("incompleteDownloadFolder", "")
    if incomplete_folder and incomplete_folder.strip():
        incomplete_path = Path(incomplete_folder.strip())
        try:
            # Try to create the directory - this will fail if not mapped in Docker
            incomplete_path.mkdir(parents=True, exist_ok=True)
            # Test if we can write to it
            test_file = incomplete_path / ".test_write"
            test_file.touch()
            test_file.unlink()
            logger.info(f"Using incomplete download folder: {incomplete_path}")
            return str(incomplete_path)
        except (PermissionError, OSError) as e:
            logger.warning(f"Incomplete folder '{incomplete_path}' not accessible (not mapped in Docker?): {e}")
            logger.info("Falling back to standard downloads folder")
            return "./downloads"
    
    # Default to standard downloads folder
    return "./downloads"


def get_final_download_dir() -> str:
    """
    Get the final download directory where completed files should be moved.
    This is always the standard downloads folder.
    
    Returns:
        str: Path to the final download directory
    """
    return "./downloads"


def move_download_to_final_folder(download_path: str, relative_path: str = None):
    """
    Move a specific completed download from the incomplete folder to the final downloads folder.
    This should be called when a download actually completes.
    
    Args:
        download_path: Full path to the downloaded file
        relative_path: Optional relative path to use for the final location
    """
    config_params = get_config_params()
    incomplete_folder = config_params.get("incompleteDownloadFolder", "")
    
    if not incomplete_folder or not incomplete_folder.strip():
        return  # No incomplete folder configured
    
    incomplete_path = Path(incomplete_folder.strip())
    final_path = Path("./downloads")
    
    # Check if incomplete folder is accessible
    if not incomplete_path.exists():
        logger.debug(f"Incomplete folder {incomplete_path} does not exist, skipping move")
        return
    
    # Ensure final directory exists
    final_path.mkdir(parents=True, exist_ok=True)
    
    download_file = Path(download_path)
    if not download_file.exists():
        logger.warning(f"Download file not found: {download_path}")
        return
    
    try:
        if relative_path:
            # Use provided relative path
            target_path = final_path / relative_path
        else:
            # Calculate relative path from incomplete folder
            if download_file.is_relative_to(incomplete_path):
                relative_path = download_file.relative_to(incomplete_path)
                target_path = final_path / relative_path
            else:
                logger.warning(f"Download file {download_path} is not in incomplete folder {incomplete_path}")
                return
        
        # Ensure target directory exists
        target_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Move the file using shutil.move() to handle cross-device moves
        shutil.move(str(download_file), str(target_path))
        logger.info(f"Moved completed download: {download_path} -> {target_path}")
        
        # Clean up empty directories in the incomplete folder
        try:
            # Start from the parent directory of the moved file and work up
            current_dir = download_file.parent
            while current_dir != incomplete_path and current_dir.exists():
                # Check if directory is empty
                if not any(current_dir.iterdir()):
                    current_dir.rmdir()
                    logger.info(f"Removed empty directory: {current_dir}")
                    current_dir = current_dir.parent
                else:
                    break
        except Exception as cleanup_error:
            logger.warning(f"Failed to clean up empty directories: {cleanup_error}")
        
    except Exception as e:
        logger.error(f"Failed to move completed download {download_path}: {e}")


def move_all_downloads_from_incomplete_folder(output_dir: str):
    """
    Move all downloaded files from the incomplete folder to the final downloads folder.
    This is a convenience function to handle the common pattern of moving files after a download completes.
    
    Args:
        output_dir: The output directory that was used for the download
    """
    if output_dir == "./downloads":
        return  # No incomplete folder was used
    
    try:
        # Find the downloaded file(s) and move them
        incomplete_path = Path(output_dir)
        if incomplete_path.exists():
            for file_path in incomplete_path.rglob("*"):
                if file_path.is_file():
                    move_download_to_final_folder(str(file_path))
    except Exception as move_error:
        logger.error(f"Failed to move completed downloads: {move_error}")


def cleanup_incomplete_folder_for_task(task_id: str):
    """
    Clean up the incomplete folder for a specific task.
    This should be called when a task is cancelled or fails to remove any partial downloads.
    
    Args:
        task_id: The task ID to clean up incomplete folder for
    """
    try:
        # Get the task info to determine the output directory
        from routes.utils.celery_tasks import get_task_info
        task_info = get_task_info(task_id)
        
        if not task_info:
            logger.warning(f"Task info not found for {task_id}, cannot clean up incomplete folder")
            return
        
        # Get the output directory that was used for this task
        from routes.utils.celery_config import get_config_params
        config_params = get_config_params()
        output_dir = get_download_output_dir(config_params)
        
        if output_dir == "./downloads":
            logger.debug(f"Task {task_id} used standard downloads folder, no incomplete folder to clean")
            return
        
        # Clean up the incomplete folder
        incomplete_path = Path(output_dir)
        try:
            if incomplete_path.exists():
                # Remove all files and directories in the incomplete folder
                import shutil
                shutil.rmtree(incomplete_path)
                logger.info(f"Cleaned up incomplete folder for cancelled task {task_id}: {incomplete_path}")
            else:
                logger.debug(f"Incomplete folder {incomplete_path} does not exist for task {task_id}")
        except (PermissionError, OSError) as access_error:
            # Handle case where incomplete folder is not accessible (not mapped in Docker)
            logger.warning(f"Cannot access incomplete folder {incomplete_path} for task {task_id} (not mapped in Docker?): {access_error}")
            logger.debug(f"Skipping cleanup for task {task_id} - incomplete folder not accessible")
            
    except Exception as cleanup_error:
        logger.error(f"Failed to clean up incomplete folder for task {task_id}: {cleanup_error}")
