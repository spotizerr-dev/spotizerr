from flask import Blueprint, request, jsonify
from routes.utils.credentials import (
    get_credential,
    list_credentials,
    create_credential,
    delete_credential,
    edit_credential
)
from pathlib import Path

credentials_bp = Blueprint('credentials', __name__)

@credentials_bp.route('/<service>', methods=['GET'])
def handle_list_credentials(service):
    try:
        return jsonify(list_credentials(service))
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@credentials_bp.route('/<service>/<name>', methods=['GET', 'POST', 'PUT', 'DELETE'])
def handle_single_credential(service, name):
    try:
        # Get credential type from query parameters, default to 'credentials'
        cred_type = request.args.get('type', 'credentials')
        if cred_type not in ['credentials', 'search']:
            return jsonify({"error": "Invalid credential type. Must be 'credentials' or 'search'"}), 400
        
        if request.method == 'GET':
            return jsonify(get_credential(service, name, cred_type))
            
        elif request.method == 'POST':
            data = request.get_json()
            create_credential(service, name, data, cred_type)
            return jsonify({"message": f"{cred_type.capitalize()} credential created successfully"}), 201
            
        elif request.method == 'PUT':
            data = request.get_json()
            edit_credential(service, name, data, cred_type)
            return jsonify({"message": f"{cred_type.capitalize()} credential updated successfully"})
            
        elif request.method == 'DELETE':
            delete_credential(service, name, cred_type if cred_type != 'credentials' else None)
            return jsonify({"message": f"{cred_type.capitalize()} credential deleted successfully"})

    except (ValueError, FileNotFoundError, FileExistsError) as e:
        status_code = 400
        if isinstance(e, FileNotFoundError):
            status_code = 404
        elif isinstance(e, FileExistsError):
            status_code = 409
        return jsonify({"error": str(e)}), status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@credentials_bp.route('/search/<service>/<name>', methods=['GET', 'POST', 'PUT'])
def handle_search_credential(service, name):
    """Special route specifically for search credentials"""
    try:
        if request.method == 'GET':
            return jsonify(get_credential(service, name, 'search'))
            
        elif request.method in ['POST', 'PUT']:
            data = request.get_json()
            
            # Validate required fields
            if not data.get('client_id') or not data.get('client_secret'):
                return jsonify({"error": "Both client_id and client_secret are required"}), 400
                
            # For POST, first check if the credentials directory exists
            if request.method == 'POST' and not any(Path(f'./data/{service}/{name}').glob('*.json')):
                return jsonify({"error": f"Account '{name}' doesn't exist. Create it first."}), 404
            
            # Create or update search credentials
            method_func = create_credential if request.method == 'POST' else edit_credential
            method_func(service, name, data, 'search')
            
            action = "created" if request.method == 'POST' else "updated"
            return jsonify({"message": f"Search credentials {action} successfully"})

    except (ValueError, FileNotFoundError) as e:
        status_code = 400 if isinstance(e, ValueError) else 404
        return jsonify({"error": str(e)}), status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@credentials_bp.route('/all/<service>', methods=['GET'])
def handle_all_credentials(service):
    try:
        credentials = []
        for name in list_credentials(service):
            # For each credential, get both the main credentials and search credentials if they exist
            cred_data = {
                "name": name,
                "credentials": get_credential(service, name, 'credentials')
            }
            
            # For Spotify accounts, also try to get search credentials
            if service == 'spotify':
                try:
                    search_creds = get_credential(service, name, 'search')
                    if search_creds:  # Only add if not empty
                        cred_data["search"] = search_creds
                except:
                    pass  # Ignore errors if search.json doesn't exist
                    
            credentials.append(cred_data)
            
        return jsonify(credentials)
    except (ValueError, FileNotFoundError) as e:
        status_code = 400 if isinstance(e, ValueError) else 404
        return jsonify({"error": str(e)}), status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 500