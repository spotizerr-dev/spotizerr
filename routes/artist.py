#!/usr/bin/env python3
"""
Artist endpoint blueprint.
"""

from flask import Blueprint, Response, request
import json
import os
import random
import string
import traceback

artist_bp = Blueprint('artist', __name__)

def log_json(message_dict):
    print(json.dumps(message_dict))


@artist_bp.route('/download', methods=['GET'])
def handle_artist_download():
    """
    Enqueues album download tasks for the given artist using the new artist module.
    Expected query parameters:
      - url: string (a Spotify artist URL)
      - service: string ("spotify" or "deezer")
      - main: string (e.g., a credentials directory name)
      - fallback: string (optional)
      - quality: string (e.g., "MP3_128")
      - fall_quality: string (optional, e.g., "HIGH")
      - real_time: bool (e.g., "true" or "false")
      - album_type: string(s); comma-separated values such as "album,single,appears_on,compilation"
      - custom_dir_format: string (optional, default: "%ar_album%/%album%/%copyright%")
      - custom_track_format: string (optional, default: "%tracknum%. %music% - %artist%")
      
    Since the new download_artist_albums() function simply enqueues album tasks via
    the global queue manager, it returns a list of album PRG filenames. These are sent
    back immediately in the JSON response.
    """
    service = request.args.get('service')
    url = request.args.get('url')
    main = request.args.get('main')
    fallback = request.args.get('fallback')
    quality = request.args.get('quality')
    fall_quality = request.args.get('fall_quality')
    album_type = request.args.get('album_type')
    real_time_arg = request.args.get('real_time', 'false')
    real_time = real_time_arg.lower() in ['true', '1', 'yes']

    # New query parameters for custom formatting.
    custom_dir_format = request.args.get('custom_dir_format', "%ar_album%/%album%/%copyright%")
    custom_track_format = request.args.get('custom_track_format', "%tracknum%. %music% - %artist%")

    # Sanitize main and fallback to prevent directory traversal.
    if main:
        main = os.path.basename(main)
    if fallback:
        fallback = os.path.basename(fallback)

    # Check for required parameters.
    if not all([service, url, main, quality, album_type]):
        return Response(
            json.dumps({"error": "Missing parameters"}),
            status=400,
            mimetype='application/json'
        )

    # Validate credentials based on the selected service.
    try:
        if service == 'spotify':
            if fallback:
                # When a fallback is provided, validate both Deezer and Spotify fallback credentials.
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
                spotify_creds_path = os.path.abspath(os.path.join('./creds/spotify', main, 'credentials.json'))
                if not os.path.isfile(spotify_creds_path):
                    return Response(
                        json.dumps({"error": "Invalid Spotify credentials directory"}),
                        status=400,
                        mimetype='application/json'
                    )
        elif service == 'deezer':
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

    try:
        # Import and call the updated download_artist_albums() function.
        from routes.utils.artist import download_artist_albums
        album_prg_files = download_artist_albums(
            service=service,
            url=url,
            main=main,
            fallback=fallback,
            quality=quality,
            fall_quality=fall_quality,
            real_time=real_time,
            album_type=album_type,
            custom_dir_format=custom_dir_format,
            custom_track_format=custom_track_format
        )
        # Return the list of album PRG filenames.
        return Response(
            json.dumps({
                "status": "complete",
                "album_prg_files": album_prg_files,
                "message": "Artist download completed – album tasks have been queued."
            }),
            status=202,
            mimetype='application/json'
        )
    except Exception as e:
        return Response(
            json.dumps({
                "status": "error",
                "message": str(e),
                "traceback": traceback.format_exc()
            }),
            status=500,
            mimetype='application/json'
        )


@artist_bp.route('/download/cancel', methods=['GET'])
def cancel_artist_download():
    """
    Cancelling an artist download is not supported since the endpoint only enqueues album tasks.
    (Cancellation for individual album tasks can be implemented via the queue manager.)
    """
    return Response(
        json.dumps({"error": "Artist download cancellation is not supported."}),
        status=400,
        mimetype='application/json'
    )


@artist_bp.route('/info', methods=['GET'])
def get_artist_info():
    """
    Retrieves Spotify artist metadata given a Spotify artist ID.
    Expects a query parameter 'id' with the Spotify artist ID.
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
            print(f"Using main from config for artist info: {main}")
    
    # Validate main parameter
    if not main:
        return Response(
            json.dumps({"error": "Missing parameter: main (Spotify account)"}),
            status=400,
            mimetype='application/json'
        )
    
    try:
        from routes.utils.get_info import get_spotify_info
        artist_info = get_spotify_info(spotify_id, "artist", main=main)
        return Response(
            json.dumps(artist_info),
            status=200,
            mimetype='application/json'
        )
    except Exception as e:
        return Response(
            json.dumps({
                "error": str(e),
                "traceback": traceback.format_exc()
            }),
            status=500,
            mimetype='application/json'
        )
