import json
from pathlib import Path
import shutil

def create_credential(service, name, data):
    """
    Creates a new credential file for the specified service.
    
    Args:
        service (str): 'spotify' or 'deezer'
        name (str): Custom name for the credential
        data (dict): Dictionary containing the credential data
        
    Raises:
        ValueError: If service is invalid or data is missing required fields
        FileExistsError: If the credential directory already exists
    """
    if service not in ['spotify', 'deezer']:
        raise ValueError("Service must be 'spotify' or 'deezer'")
    
    # Validate data structure
    required_fields = []
    if service == 'spotify':
        required_fields = ['username', 'credentials']
        data['type'] = 'AUTHENTICATION_STORED_SPOTIFY_CREDENTIALS'
    else:
        required_fields = ['arl', 'email', 'password']
    
    for field in required_fields:
        if field not in data:
            raise ValueError(f"Missing required field for {service}: {field}")
    
    # Create directory
    creds_dir = Path('./creds') / service / name
    try:
        creds_dir.mkdir(parents=True, exist_ok=False)
    except FileExistsError:
        raise FileExistsError(f"Credential '{name}' already exists for {service}")
    
    # Write credentials file
    file_path = creds_dir / 'credentials.json'
    with open(file_path, 'w') as f:
        json.dump(data, f, indent=4)

def delete_credential(service, name):
    """
    Deletes an existing credential directory.
    
    Args:
        service (str): 'spotify' or 'deezer'
        name (str): Name of the credential to delete
        
    Raises:
        FileNotFoundError: If the credential directory does not exist
    """
    creds_dir = Path('./creds') / service / name
    if not creds_dir.exists():
        raise FileNotFoundError(f"Credential '{name}' not found for {service}")
    
    shutil.rmtree(creds_dir)

def edit_credential(service, name, new_data):
    """
    Edits an existing credential file.
    
    Args:
        service (str): 'spotify' or 'deezer'
        name (str): Name of the credential to edit
        new_data (dict): Dictionary containing fields to update
        
    Raises:
        FileNotFoundError: If the credential does not exist
        ValueError: If new_data contains invalid fields or missing required fields after update
    """
    # Validate service
    if service not in ['spotify', 'deezer']:
        raise ValueError("Service must be 'spotify' or 'deezer'")
    
    # Load existing data
    creds_dir = Path('./creds') / service / name
    file_path = creds_dir / 'credentials.json'
    if not file_path.exists():
        raise FileNotFoundError(f"Credential '{name}' not found for {service}")
    
    with open(file_path, 'r') as f:
        data = json.load(f)
    
    # Validate new_data fields
    allowed_fields = []
    if service == 'spotify':
        allowed_fields = ['username', 'credentials']
    else:
        allowed_fields = ['arl', 'email', 'password']
    
    for key in new_data.keys():
        if key not in allowed_fields:
            raise ValueError(f"Invalid field '{key}' for {service} credentials")
    
    # Update data
    data.update(new_data)
    
    # Ensure required fields are present
    required_fields = []
    if service == 'spotify':
        required_fields = ['username', 'credentials', 'type']
        data['type'] = 'AUTHENTICATION_STORED_SPOTIFY_CREDENTIALS'  # Ensure type is correct
    else:
        required_fields = ['arl', 'email', 'password']
    
    for field in required_fields:
        if field not in data:
            raise ValueError(f"Missing required field '{field}' after update for {service}")
    
    # Save updated data
    with open(file_path, 'w') as f:
        json.dump(data, f, indent=4)