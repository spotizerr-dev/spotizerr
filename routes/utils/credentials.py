import json
from pathlib import Path
import shutil

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
    
    creds_dir = Path('./creds') / service / name
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
    
    service_dir = Path('./creds') / service
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
    creds_dir = Path('./creds') / service / name
    if cred_type == 'credentials':
        try:
            creds_dir.mkdir(parents=True, exist_ok=False)
        except FileExistsError:
            raise FileExistsError(f"Credential '{name}' already exists for {service}")
    else:
        # For search.json, ensure the directory exists (it should if credentials.json exists)
        if not creds_dir.exists():
            raise FileNotFoundError(f"Credential '{name}' not found for {service}")
    
    # Write credentials file
    file_path = creds_dir / f'{cred_type}.json'
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
    creds_dir = Path('./creds') / service / name
    
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
    creds_dir = Path('./creds') / service / name
    file_path = creds_dir / f'{cred_type}.json'
    
    # For search.json, create if it doesn't exist
    if cred_type == 'search' and not file_path.exists():
        if not creds_dir.exists():
            raise FileNotFoundError(f"Credential '{name}' not found for {service}")
        data = {}
    else:
        # Load existing data
        if not file_path.exists():
            raise FileNotFoundError(f"{cred_type.capitalize()} credential '{name}' not found for {service}")
        
        with open(file_path, 'r') as f:
            data = json.load(f)
    
    # Validate new_data fields
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
    
    # Update data
    data.update(new_data)
    
    # For Deezer: Strip all fields except 'arl'
    if service == 'deezer' and cred_type == 'credentials':
        if 'arl' not in data:
            raise ValueError("Missing 'arl' field for Deezer credential")
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