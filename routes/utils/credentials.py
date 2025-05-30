import json
from pathlib import Path
import shutil
from deezspot.spotloader import SpoLogin
from deezspot.deezloader import DeeLogin
import traceback # For logging detailed error messages
import time # For retry delays

def _get_spotify_search_creds(creds_dir: Path):
    """Helper to load client_id and client_secret from search.json for a Spotify account."""
    search_file = creds_dir / 'search.json'
    if search_file.exists():
        try:
            with open(search_file, 'r') as f:
                search_data = json.load(f)
            return search_data.get('client_id'), search_data.get('client_secret')
        except Exception:
            # Log error if search.json is malformed or unreadable
            print(f"Warning: Could not read Spotify search credentials from {search_file}")
            traceback.print_exc()
    return None, None

def _validate_with_retry(service_name, account_name, creds_dir_path, cred_file_path, data_for_validation, is_spotify):
    """
    Attempts to validate credentials with retries for connection errors.
    - For Spotify, cred_file_path is used.
    - For Deezer, data_for_validation (which contains the 'arl' key) is used.
    Returns True if validated, raises ValueError if not.
    """
    max_retries = 5
    last_exception = None

    for attempt in range(max_retries):
        try:
            if is_spotify:
                client_id, client_secret = _get_spotify_search_creds(creds_dir_path)
                SpoLogin(credentials_path=str(cred_file_path), spotify_client_id=client_id, spotify_client_secret=client_secret)
            else: # Deezer
                arl = data_for_validation.get('arl')
                if not arl:
                    # This should be caught by prior checks, but as a safeguard:
                    raise ValueError("Missing 'arl' for Deezer validation.")
                DeeLogin(arl=arl)
            
            print(f"{service_name.capitalize()} credentials for {account_name} validated successfully (attempt {attempt + 1}).")
            return True # Validation successful
        except Exception as e:
            last_exception = e
            error_str = str(e).lower()
            # More comprehensive check for connection-related errors
            is_connection_error = (
                "connection refused" in error_str or
                "connection error" in error_str or
                "timeout" in error_str or 
                "temporary failure in name resolution" in error_str or
                "dns lookup failed" in error_str or
                "network is unreachable" in error_str or
                "ssl handshake failed" in error_str or # Can be network-related
                "connection reset by peer" in error_str
            )

            if is_connection_error and attempt < max_retries - 1:
                retry_delay = 2 + attempt # Increasing delay (2s, 3s, 4s, 5s)
                print(f"Validation for {account_name} ({service_name}) failed on attempt {attempt + 1}/{max_retries} due to connection issue: {e}. Retrying in {retry_delay}s...")
                time.sleep(retry_delay)
                continue # Go to next retry attempt
            else:
                # Not a connection error, or it's the last retry for a connection error
                print(f"Validation for {account_name} ({service_name}) failed on attempt {attempt + 1} with non-retryable error or max retries reached for connection error.")
                break # Exit retry loop

    # If loop finished without returning True, validation failed
    print(f"ERROR: Credential validation definitively failed for {service_name} account {account_name} after {attempt + 1} attempt(s).")
    if last_exception:
        base_error_message = str(last_exception).splitlines()[-1]
        detailed_error_message = f"Invalid {service_name} credentials. Verification failed: {base_error_message}"
        if is_spotify and "incorrect padding" in base_error_message.lower():
            detailed_error_message += ". Hint: Do not throw your password here, read the docs"
        # traceback.print_exc() # Already printed in create/edit, avoid duplicate full trace
        raise ValueError(detailed_error_message)
    else: # Should not happen if loop runs at least once
        raise ValueError(f"Invalid {service_name} credentials. Verification failed (unknown reason after retries).")

def get_credential(service, name, cred_type='credentials'):
    """
    Retrieves existing credential contents by name.
    
    Args:
        service (str): 'spotify' or 'deezer'
        name (str): Custom name of the credential to retrieve
        cred_type (str): 'credentials' or 'search' - type of credential file to read
        
    Returns:
        dict: Credential data as dictionary
        
    Raises:
        FileNotFoundError: If the credential doesn't exist
        ValueError: For invalid service name or cred_type
    """
    if service not in ['spotify', 'deezer']:
        raise ValueError("Service must be 'spotify' or 'deezer'")
    
    if cred_type not in ['credentials', 'search']:
        raise ValueError("Credential type must be 'credentials' or 'search'")
    
    # For Deezer, only credentials.json is supported
    if service == 'deezer' and cred_type == 'search':
        raise ValueError("Search credentials are only supported for Spotify")
    
    creds_dir = Path('./data/creds') / service / name
    file_path = creds_dir / f'{cred_type}.json'
    
    if not file_path.exists():
        if cred_type == 'search':
            # Return empty dict if search.json doesn't exist
            return {}
        raise FileNotFoundError(f"Credential '{name}' not found for {service}")
    
    with open(file_path, 'r') as f:
        return json.load(f)

def list_credentials(service):
    """
    Lists all available credential names for a service
    
    Args:
        service (str): 'spotify' or 'deezer'
        
    Returns:
        list: Array of credential names
        
    Raises:
        ValueError: For invalid service name
    """
    if service not in ['spotify', 'deezer']:
        raise ValueError("Service must be 'spotify' or 'deezer'")
    
    service_dir = Path('./data/creds') / service
    if not service_dir.exists():
        return []
    
    return [d.name for d in service_dir.iterdir() if d.is_dir()]


def create_credential(service, name, data, cred_type='credentials'):
    """
    Creates a new credential file for the specified service.
    
    Args:
        service (str): 'spotify' or 'deezer'
        name (str): Custom name for the credential
        data (dict): Dictionary containing the credential data
        cred_type (str): 'credentials' or 'search' - type of credential file to create
        
    Raises:
        ValueError: If service is invalid, data has invalid fields, or missing required fields
        FileExistsError: If the credential directory already exists (for credentials.json)
    """
    if service not in ['spotify', 'deezer']:
        raise ValueError("Service must be 'spotify' or 'deezer'")
    
    if cred_type not in ['credentials', 'search']:
        raise ValueError("Credential type must be 'credentials' or 'search'")
    
    # For Deezer, only credentials.json is supported
    if service == 'deezer' and cred_type == 'search':
        raise ValueError("Search credentials are only supported for Spotify")
    
    # Validate data structure
    required_fields = []
    allowed_fields = []
    
    if cred_type == 'credentials':
        if service == 'spotify':
            required_fields = ['username', 'credentials']
            allowed_fields = required_fields + ['type']
            data['type'] = 'AUTHENTICATION_STORED_SPOTIFY_CREDENTIALS'
        else:
            required_fields = ['arl']
            allowed_fields = required_fields.copy()
            # Check for extra fields
            extra_fields = set(data.keys()) - set(allowed_fields)
            if extra_fields:
                raise ValueError(f"Deezer credentials can only contain 'arl'. Extra fields found: {', '.join(extra_fields)}")
    elif cred_type == 'search':
        required_fields = ['client_id', 'client_secret']
        allowed_fields = required_fields.copy()
        # Check for extra fields
        extra_fields = set(data.keys()) - set(allowed_fields)
        if extra_fields:
            raise ValueError(f"Search credentials can only contain 'client_id' and 'client_secret'. Extra fields found: {', '.join(extra_fields)}")
    
    for field in required_fields:
        if field not in data:
            raise ValueError(f"Missing required field for {cred_type}: {field}")
    
    # Create directory
    creds_dir = Path('./data/creds') / service / name
    file_created_now = False
    dir_created_now = False

    if cred_type == 'credentials':
        try:
            creds_dir.mkdir(parents=True, exist_ok=False)
            dir_created_now = True
        except FileExistsError:
            # Directory already exists, which is fine for creating credentials.json
            # if it doesn't exist yet, or if we are overwriting (though POST usually means new)
            pass
        except Exception as e:
            raise ValueError(f"Could not create directory {creds_dir}: {e}")

        file_path = creds_dir / 'credentials.json'
        if file_path.exists() and request.method == 'POST': # type: ignore
             # Safety check for POST to not overwrite if file exists unless it's an edit (PUT)
             raise FileExistsError(f"Credential file {file_path} already exists. Use PUT to modify.")

        # Write the credential file first
        try:
            with open(file_path, 'w') as f:
                json.dump(data, f, indent=4)
            file_created_now = True # Mark as created for potential cleanup
        except Exception as e:
            if dir_created_now: # Cleanup directory if file write failed
                try:
                    creds_dir.rmdir()
                except OSError: # rmdir fails if not empty, though it should be
                    pass
            raise ValueError(f"Could not write credential file {file_path}: {e}")

        # --- Validation Step ---
        try:
            _validate_with_retry(
                service_name=service,
                account_name=name,
                creds_dir_path=creds_dir,
                cred_file_path=file_path,
                data_for_validation=data, # 'data' contains the arl for Deezer
                is_spotify=(service == 'spotify')
            )
        except ValueError as val_err: # Catch the specific error from our helper
            print(f"ERROR: Credential validation failed during creation for {service} account {name}: {val_err}")
            traceback.print_exc() # Print full traceback here for creation failure context
            # Clean up the created file and directory if validation fails
            if file_created_now:
                try:
                    file_path.unlink(missing_ok=True)
                except OSError:
                    pass # Ignore if somehow already gone
            if dir_created_now and not any(creds_dir.iterdir()): # Only remove if empty
                try:
                    creds_dir.rmdir()
                except OSError:
                    pass
            raise # Re-raise the ValueError from validation

    elif cred_type == 'search': # Spotify only
        # For search.json, ensure the directory exists (it should if credentials.json exists)
        if not creds_dir.exists():
            # This implies credentials.json was not created first, which is an issue.
            # However, the form logic might allow adding API creds to an existing empty dir.
            # For now, let's create it if it's missing, assuming API creds can be standalone.
            try:
                 creds_dir.mkdir(parents=True, exist_ok=True)
            except Exception as e:
                raise ValueError(f"Could not create directory for search credentials {creds_dir}: {e}")

        file_path = creds_dir / 'search.json'
        # No specific validation for client_id/secret themselves, they are validated in use.
        with open(file_path, 'w') as f:
            json.dump(data, f, indent=4)

def delete_credential(service, name, cred_type=None):
    """
    Deletes an existing credential directory or specific credential file.
    
    Args:
        service (str): 'spotify' or 'deezer'
        name (str): Name of the credential to delete
        cred_type (str, optional): If specified ('credentials' or 'search'), only deletes
                               that specific file. If None, deletes the whole directory.
        
    Raises:
        FileNotFoundError: If the credential directory or specified file does not exist
    """
    creds_dir = Path('./data/creds') / service / name
    
    if cred_type:
        if cred_type not in ['credentials', 'search']:
            raise ValueError("Credential type must be 'credentials' or 'search'")
        
        file_path = creds_dir / f'{cred_type}.json'
        if not file_path.exists():
            raise FileNotFoundError(f"{cred_type.capitalize()} credential '{name}' not found for {service}")
        
        # Delete just the specific file
        file_path.unlink()
        
        # If it was credentials.json and no other credential files remain, also delete the directory
        if cred_type == 'credentials' and not any(creds_dir.iterdir()):
            creds_dir.rmdir()
    else:
        # Delete the entire directory
        if not creds_dir.exists():
            raise FileNotFoundError(f"Credential '{name}' not found for {service}")
        
        shutil.rmtree(creds_dir)

def edit_credential(service, name, new_data, cred_type='credentials'):
    """
    Edits an existing credential file.
    
    Args:
        service (str): 'spotify' or 'deezer'
        name (str): Name of the credential to edit
        new_data (dict): Dictionary containing fields to update
        cred_type (str): 'credentials' or 'search' - type of credential file to edit
        
    Raises:
        FileNotFoundError: If the credential does not exist
        ValueError: If new_data contains invalid fields or missing required fields after update
    """
    if service not in ['spotify', 'deezer']:
        raise ValueError("Service must be 'spotify' or 'deezer'")
    
    if cred_type not in ['credentials', 'search']:
        raise ValueError("Credential type must be 'credentials' or 'search'")
    
    # For Deezer, only credentials.json is supported
    if service == 'deezer' and cred_type == 'search':
        raise ValueError("Search credentials are only supported for Spotify")
    
    # Get file path
    creds_dir = Path('./data/creds') / service / name
    file_path = creds_dir / f'{cred_type}.json'
    
    original_data_str = None # Store original data as string to revert
    file_existed_before_edit = file_path.exists()

    if file_existed_before_edit:
        with open(file_path, 'r') as f:
            original_data_str = f.read()
        try:
            data = json.loads(original_data_str)
        except json.JSONDecodeError:
            # If existing file is corrupt, treat as if we are creating it anew for edit
            data = {}
            original_data_str = None # Can't revert to corrupt data
    else:
        # If file doesn't exist, and we're editing (PUT), it's usually an error
        # unless it's for search.json which can be created during an edit flow.
        if cred_type == 'credentials':
            raise FileNotFoundError(f"Cannot edit non-existent credentials file: {file_path}")
        data = {} # Start with empty data for search.json creation

    # Validate new_data fields (data to be merged)
    allowed_fields = []
    if cred_type == 'credentials':
        if service == 'spotify':
            allowed_fields = ['username', 'credentials']
        else:
            allowed_fields = ['arl']
    else:  # search.json
        allowed_fields = ['client_id', 'client_secret']
    
    for key in new_data.keys():
        if key not in allowed_fields:
            raise ValueError(f"Invalid field '{key}' for {cred_type} credentials")
    
    # Update data (merging new_data into existing or empty data)
    data.update(new_data)
    
    # --- Write and Validate Step for 'credentials' type ---
    if cred_type == 'credentials':
        try:
            # Temporarily write new data for validation
            with open(file_path, 'w') as f:
                json.dump(data, f, indent=4)
            
            _validate_with_retry(
                service_name=service,
                account_name=name,
                creds_dir_path=creds_dir,
                cred_file_path=file_path,
                data_for_validation=data, # 'data' is the merged data with 'arl' for Deezer
                is_spotify=(service == 'spotify')
            )
        except ValueError as val_err: # Catch the specific error from our helper
            print(f"ERROR: Edited credential validation failed for {service} account {name}: {val_err}")
            traceback.print_exc() # Print full traceback here for edit failure context
            # Revert or delete the file
            if original_data_str is not None:
                with open(file_path, 'w') as f:
                    f.write(original_data_str) # Restore original content
            elif file_existed_before_edit: # file existed but original_data_str is None (corrupt)
                pass 
            else: # File didn't exist before this edit attempt, so remove it
                try:
                    file_path.unlink(missing_ok=True)
                except OSError:
                    pass # Ignore if somehow already gone
            raise # Re-raise the ValueError from validation
        except Exception as e: # Catch other potential errors like file IO during temp write
            print(f"ERROR: Unexpected error during edit/validation for {service} account {name}: {e}")
            traceback.print_exc()
            # Attempt revert/delete
            if original_data_str is not None:
                with open(file_path, 'w') as f: f.write(original_data_str)
            elif file_existed_before_edit:
                pass
            else:
                try:
                    file_path.unlink(missing_ok=True)
                except OSError: pass
            raise ValueError(f"Failed to save edited {service} credentials due to: {str(e).splitlines()[-1]}")
    
    # For 'search' type, just write, no specific validation here for client_id/secret
    elif cred_type == 'search':
        if not creds_dir.exists(): # Should not happen if we're editing
             raise FileNotFoundError(f"Credential directory {creds_dir} not found for editing search credentials.")
        with open(file_path, 'w') as f:
            json.dump(data, f, indent=4) # `data` here is the merged data for search

    # For Deezer: Strip all fields except 'arl' - This should use `data` which is `updated_data`
    if service == 'deezer' and cred_type == 'credentials':
        if 'arl' not in data:
            raise ValueError("Missing 'arl' field for Deezer credential after edit.")
        data = {'arl': data['arl']}

    # Ensure required fields are present
    required_fields = []
    if cred_type == 'credentials':
        if service == 'spotify':
            required_fields = ['username', 'credentials', 'type']
            data['type'] = 'AUTHENTICATION_STORED_SPOTIFY_CREDENTIALS'
        else:
            required_fields = ['arl']
    else:  # search.json
        required_fields = ['client_id', 'client_secret']
    
    for field in required_fields:
        if field not in data:
            raise ValueError(f"Missing required field '{field}' after update for {cred_type}")
    
    # Save updated data
    with open(file_path, 'w') as f:
        json.dump(data, f, indent=4)