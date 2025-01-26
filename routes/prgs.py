from flask import Blueprint, send_from_directory, abort
import os

prgs_bp = Blueprint('prgs', __name__, url_prefix='/api/prgs')

# Base directory for .prg files
PRGS_DIR = os.path.join(os.getcwd(), 'prgs')

@prgs_bp.route('/<filename>', methods=['GET'])
def get_prg_file(filename):
    """
    Serve a .prg file from the prgs directory.
    """
    try:
        # Security check to prevent path traversal attacks
        if not filename.endswith('.prg') or '..' in filename or '/' in filename:
            abort(400, "Invalid file request")

        # Ensure the file exists in the directory
        return send_from_directory(PRGS_DIR, filename)
    except FileNotFoundError:
        abort(404, "File not found")
    except Exception as e:
        abort(500, f"An error occurred: {e}")
