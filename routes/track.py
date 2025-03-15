from flask import Blueprint, Response, request
import os
import json
import traceback
from routes.utils.queue import download_queue_manager

track_bp = Blueprint('track', __name__)

@track_bp.route('/download', methods=['GET'])
def handle_download():
    # Retrieve parameters from the request.
    service = request.args.get('service')
    url = request.args.get('url')
    main = request.args.get('main')
    fallback = request.args.get('fallback')
    quality = request.args.get('quality')
    fall_quality = request.args.get('fall_quality')
    
    # Normalize the real_time parameter; default to False.
    real_time_arg = request.args.get('real_time', 'false')
    real_time = real_time_arg.lower() in ['true', '1', 'yes']
    
    # New custom formatting parameters (with defaults).
    custom_dir_format = request.args.get('custom_dir_format', "%ar_album%/%album%/%copyright%")
    custom_track_format = request.args.get('custom_track_format', "%tracknum%. %music% - %artist%")
    
    # Sanitize main and fallback to prevent directory traversal.
    if main:
        main = os.path.basename(main)
    if fallback:
        fallback = os.path.basename(fallback)
    
    if not all([service, url, main]):
        return Response(
            json.dumps({"error": "Missing parameters"}),
            status=400,
            mimetype='application/json'
        )
    
    # Validate credentials based on service and fallback.
    try:
        if service == 'spotify':
            if fallback:
                # Validate Deezer main credentials and Spotify fallback credentials.
                deezer_creds_path = os.path.abspath(os.path.join('./creds/deezer', main, 'credentials.json'))
                if not os.path.isfile(deezer_creds_path):
                    return Response(
                        json.dumps({"error": "Invalid Deezer credentials directory"}),
                        status=400,
                        mimetype='application/json'
                    )
                spotify_fallback_path = os.path.abspath(os.path.join('./creds/spotify', fallback, 'credentials.json'))
                if not os.path.isfile(spotify_fallback_path):
                    return Response(
                        json.dumps({"error": "Invalid Spotify fallback credentials directory"}),
                        status=400,
                        mimetype='application/json'
                    )
            else:
                # Validate Spotify main credentials.
                spotify_creds_path = os.path.abspath(os.path.join('./creds/spotify', main, 'credentials.json'))
                if not os.path.isfile(spotify_creds_path):
                    return Response(
                        json.dumps({"error": "Invalid Spotify credentials directory"}),
                        status=400,
                        mimetype='application/json'
                    )
        elif service == 'deezer':
            # Validate Deezer main credentials.
            deezer_creds_path = os.path.abspath(os.path.join('./creds/deezer', main, 'credentials.json'))
            if not os.path.isfile(deezer_creds_path):
                return Response(
                    json.dumps({"error": "Invalid Deezer credentials directory"}),
                    status=400,
                    mimetype='application/json'
                )
        else:
            return Response(
                json.dumps({"error": "Unsupported service"}),
                status=400,
                mimetype='application/json'
            )
    except Exception as e:
        return Response(
            json.dumps({"error": f"Credential validation failed: {str(e)}"}),
            status=500,
            mimetype='application/json'
        )
    
    # Capture the original request parameters.
    orig_request = request.args.to_dict()
    
    # Build the task dictionary.
    # The key "download_type" tells the queue handler which download function to call.
    task = {
        "download_type": "track",
        "service": service,
        "url": url,
        "main": main,
        "fallback": fallback,
        "quality": quality,
        "fall_quality": fall_quality,
        "real_time": real_time,
        "custom_dir_format": custom_dir_format,
        "custom_track_format": custom_track_format,
        "orig_request": orig_request,
        # Additional parameters if needed.
        "type": "track",
        "name": request.args.get('name'),
        "artist": request.args.get('artist')
    }
    
    # Add the task to the queue and get the generated process (prg) filename.
    prg_filename = download_queue_manager.add_task(task)
    
    return Response(
        json.dumps({"prg_file": prg_filename}),
        status=202,
        mimetype='application/json'
    )

@track_bp.route('/download/cancel', methods=['GET'])
def cancel_download():
    """
    Cancel a running track download process by its process id (prg file name).
    """
    prg_file = request.args.get('prg_file')
    if not prg_file:
        return Response(
            json.dumps({"error": "Missing process id (prg_file) parameter"}),
            status=400,
            mimetype='application/json'
        )
    
    # Use the queue manager's cancellation method.
    result = download_queue_manager.cancel_task(prg_file)
    status_code = 200 if result.get("status") == "cancelled" else 404
    
    return Response(
        json.dumps(result),
        status=status_code,
        mimetype='application/json'
    )

@track_bp.route('/info', methods=['GET'])
def get_track_info():
    """
    Retrieve Spotify track metadata given a Spotify track ID.
    Expects a query parameter 'id' that contains the Spotify track ID.
    """
    spotify_id = request.args.get('id')
    main = request.args.get('main', '')
    
    if not spotify_id:
        return Response(
            json.dumps({"error": "Missing parameter: id"}),
            status=400,
            mimetype='application/json'
        )
    
    # If main parameter is not provided in the request, get it from config
    if not main:
        from routes.config import get_config
        config = get_config()
        if config and 'spotify' in config:
            main = config['spotify']
            print(f"Using main from config for track info: {main}")
    
    # Validate main parameter
    if not main:
        return Response(
            json.dumps({"error": "Missing parameter: main (Spotify account)"}),
            status=400,
            mimetype='application/json'
        )
    
    try:
        # Import and use the get_spotify_info function from the utility module.
        from routes.utils.get_info import get_spotify_info
        track_info = get_spotify_info(spotify_id, "track", main=main)
        return Response(
            json.dumps(track_info),
            status=200,
            mimetype='application/json'
        )
    except Exception as e:
        error_data = {
            "error": str(e),
            "traceback": traceback.format_exc()
        }
        return Response(
            json.dumps(error_data),
            status=500,
            mimetype='application/json'
        )
