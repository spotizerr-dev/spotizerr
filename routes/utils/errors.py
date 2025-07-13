class DuplicateDownloadError(Exception):
    def __init__(self, message, existing_task=None):
        if existing_task:
            message = f"{message} (Conflicting Task ID: {existing_task})"
        super().__init__(message)
        self.existing_task = existing_task
