from flask import Blueprint, abort
import os

prgs_bp = Blueprint('prgs', __name__, url_prefix='/api/prgs')

# Base directory for files
PRGS_DIR = os.path.join(os.getcwd(), 'prgs')

@prgs_bp.route('/<filename>', methods=['GET'])
def get_prg_file(filename):
    """
    Return the last line of the specified file from the prgs directory.
    """
    try:
        # Security check to prevent path traversal attacks
        if '..' in filename or '/' in filename:
            abort(400, "Invalid file request")

        filepath = os.path.join(PRGS_DIR, filename)

        # Read the last line of the file
        with open(filepath, 'r') as f:
            content = f.read()
            lines = content.splitlines()
            last_line = lines[-1] if lines else ''

        return last_line
    except FileNotFoundError:
        abort(404, "File not found")
    except Exception as e:
        abort(500, f"An error occurred: {e}")