from flask import Blueprint, request, jsonify
from routes.utils.credentials import (
    get_credential,
    list_credentials,
    create_credential,
    delete_credential,
    edit_credential
)

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
        if request.method == 'GET':
            return jsonify(get_credential(service, name))
            
        elif request.method == 'POST':
            data = request.get_json()
            create_credential(service, name, data)
            return jsonify({"message": "Credential created successfully"}), 201
            
        elif request.method == 'PUT':
            data = request.get_json()
            edit_credential(service, name, data)
            return jsonify({"message": "Credential updated successfully"})
            
        elif request.method == 'DELETE':
            delete_credential(service, name)
            return jsonify({"message": "Credential deleted successfully"})

    except (ValueError, FileNotFoundError, FileExistsError) as e:
        status_code = 400
        if isinstance(e, FileNotFoundError):
            status_code = 404
        elif isinstance(e, FileExistsError):
            status_code = 409
        return jsonify({"error": str(e)}), status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@credentials_bp.route('/all/<service>', methods=['GET'])
def handle_all_credentials(service):
    try:
        credentials = []
        for name in list_credentials(service):
            credentials.append({
                "name": name,
                "data": get_credential(service, name)
            })
        return jsonify(credentials)
    except (ValueError, FileNotFoundError) as e:
        status_code = 400 if isinstance(e, ValueError) else 404
        return jsonify({"error": str(e)}), status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 500