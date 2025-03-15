from flask import Blueprint, abort, jsonify
import os
import json

prgs_bp = Blueprint('prgs', __name__, url_prefix='/api/prgs')

# Base directory for files
PRGS_DIR = os.path.join(os.getcwd(), 'prgs')

@prgs_bp.route('/<filename>', methods=['GET'])
def get_prg_file(filename):
    """
    Return a JSON object with the resource type, its name (title),
    the last progress update (last line) of the PRG file, and, if available,
    the original request parameters (from the first line of the file).
    
    For resource type and name, the second line of the file is used.
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
                "artist": "",
                "last_line": None,
                "original_request": None,
                "display_title": "",
                "display_type": "",
                "display_artist": ""
            })

        # Attempt to extract the original request from the first line.
        original_request = None
        display_title = ""
        display_type = ""
        display_artist = ""
        
        try:
            first_line = json.loads(lines[0])
            if isinstance(first_line, dict):
                if "original_request" in first_line:
                    original_request = first_line["original_request"]
                else:
                    # The first line might be the original request itself
                    original_request = first_line
                
                # Extract display information from the original request
                if original_request:
                    display_title = original_request.get("display_title", original_request.get("name", ""))
                    display_type = original_request.get("display_type", original_request.get("type", ""))
                    display_artist = original_request.get("display_artist", original_request.get("artist", ""))
        except Exception as e:
            print(f"Error parsing first line of PRG file: {e}")
            original_request = None

        # For resource type and name, use the second line if available.
        resource_type = ""
        resource_name = ""
        resource_artist = ""
        if len(lines) > 1:
            try:
                second_line = json.loads(lines[1])
                # Directly extract 'type' and 'name' from the JSON
                resource_type = second_line.get("type", "")
                resource_name = second_line.get("name", "")
                resource_artist = second_line.get("artist", "")
            except Exception:
                resource_type = ""
                resource_name = ""
                resource_artist = ""
        else:
            resource_type = ""
            resource_name = ""
            resource_artist = ""

        # Get the last line from the file.
        last_line_raw = lines[-1]
        try:
            last_line_parsed = json.loads(last_line_raw)
        except Exception:
            last_line_parsed = last_line_raw  # Fallback to raw string if JSON parsing fails.

        return jsonify({
            "type": resource_type,
            "name": resource_name,
            "artist": resource_artist,
            "last_line": last_line_parsed,
            "original_request": original_request,
            "display_title": display_title,
            "display_type": display_type,
            "display_artist": display_artist
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
