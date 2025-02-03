from flask import Blueprint, abort, jsonify
import os
import json

prgs_bp = Blueprint('prgs', __name__, url_prefix='/api/prgs')

# Base directory for files
PRGS_DIR = os.path.join(os.getcwd(), 'prgs')

@prgs_bp.route('/<filename>', methods=['GET'])
def get_prg_file(filename):
    """
    Return a JSON object with the resource type, its name (title) and the last line (progress update) of the PRG file.
    If the file is empty, return default values.
    """
    try:
        # Security check to prevent path traversal attacks.
        if '..' in filename or '/' in filename:
            abort(400, "Invalid file request")

        filepath = os.path.join(PRGS_DIR, filename)

        with open(filepath, 'r') as f:
            content = f.read()
            lines = content.splitlines()

        # If the file is empty, return default values.
        if not lines:
            return jsonify({
                "type": "",
                "name": "",
                "last_line": None
            })

        # Process the initialization line (first line) to extract type and name.
        try:
            init_data = json.loads(lines[0])
        except Exception as e:
            # If parsing fails, use defaults.
            init_data = {}

        resource_type = init_data.get("type", "")
        # Determine the name based on type.
        if resource_type == "track":
            resource_name = init_data.get("song", "")
        elif resource_type == "album":
            resource_name = init_data.get("album", "")
        elif resource_type == "playlist":
            resource_name = init_data.get("name", "")
        elif resource_type == "artist":
            resource_name = init_data.get("artist", "")
        else:
            resource_name = ""

        # Get the last line from the file.
        last_line_raw = lines[-1]
        # Try to parse the last line as JSON.
        try:
            last_line_parsed = json.loads(last_line_raw)
        except Exception:
            last_line_parsed = last_line_raw  # Fallback to returning raw string if JSON parsing fails.

        return jsonify({
            "type": resource_type,
            "name": resource_name,
            "last_line": last_line_parsed
        })
    except FileNotFoundError:
        abort(404, "File not found")
    except Exception as e:
        abort(500, f"An error occurred: {e}")


@prgs_bp.route('/delete/<filename>', methods=['DELETE'])
def delete_prg_file(filename):
    """
    Delete the specified .prg file from the prgs directory.
    """
    try:
        # Security checks to prevent path traversal and ensure correct file type.
        if '..' in filename or '/' in filename:
            abort(400, "Invalid file request")
        if not filename.endswith('.prg'):
            abort(400, "Only .prg files can be deleted")
        
        filepath = os.path.join(PRGS_DIR, filename)
        
        if not os.path.isfile(filepath):
            abort(404, "File not found")
        
        os.remove(filepath)
        return {'message': f'File {filename} deleted successfully'}, 200
    except FileNotFoundError:
        abort(404, "File not found")
    except Exception as e:
        abort(500, f"An error occurred: {e}")


@prgs_bp.route('/list', methods=['GET'])
def list_prg_files():
    """
    Retrieve a list of all .prg files in the prgs directory.
    """
    try:
        prg_files = []
        if os.path.isdir(PRGS_DIR):
            with os.scandir(PRGS_DIR) as entries:
                for entry in entries:
                    if entry.is_file() and entry.name.endswith('.prg'):
                        prg_files.append(entry.name)
        return jsonify(prg_files)
    except Exception as e:
        abort(500, f"An error occurred: {e}")
