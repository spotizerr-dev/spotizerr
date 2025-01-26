from flask import Blueprint, jsonify, request
from routes.utils.search import search  # Corrected import

search_bp = Blueprint('search', __name__)

@search_bp.route('/search', methods=['GET'])
def handle_search():
    try:
        # Get query parameters
        query = request.args.get('q', '')
        search_type = request.args.get('search_type', '')
        limit = int(request.args.get('limit', 10))

        # Validate parameters
        if not query:
            return jsonify({'error': 'Missing search query'}), 400

        valid_types = ['track', 'album', 'artist', 'playlist', 'episode']
        if search_type not in valid_types:
            return jsonify({'error': 'Invalid search type'}), 400

        # Perform the search with corrected parameter name
        raw_results = search(
            query=query,
            search_type=search_type,  # Fixed parameter name
            limit=limit
        )
        
        return jsonify({
            'data': raw_results,
            'error': None
        })

    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500