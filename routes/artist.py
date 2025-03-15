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
from routes.utils.queue import download_queue_manager, get_config_params

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
      - album_type: string(s); comma-separated values such as "album,single,appears_on,compilation"
    """
    # Retrieve essential parameters from the request.
    service = request.args.get('service')
    url = request.args.get('url')
    album_type = request.args.get('album_type')
    
    # Get common parameters from config
    config_params = get_config_params()
    
    # Allow request parameters to override config values
    main = request.args.get('main')
    fallback = request.args.get('fallback')
    quality = request.args.get('quality')
    fall_quality = request.args.get('fall_quality')
    real_time_arg = request.args.get('real_time')
    custom_dir_format = request.args.get('custom_dir_format')
    custom_track_format = request.args.get('custom_track_format')
    pad_tracks_arg = request.args.get('tracknum_padding')
    
    # Use config values as defaults when parameters are not provided
    if not main:
        main = config_params['spotify'] if service == 'spotify' else config_params['deezer']
    
    if not fallback and config_params['fallback'] and service == 'spotify':
        fallback = config_params['spotify']
        
    if not quality:
        quality = config_params['spotifyQuality'] if service == 'spotify' else config_params['deezerQuality']
        
    if not fall_quality and fallback:
        fall_quality = config_params['spotifyQuality']
    
    # Parse boolean parameters
    real_time = real_time_arg.lower() in ['true', '1', 'yes'] if real_time_arg is not None else config_params['realTime']
    pad_tracks = pad_tracks_arg.lower() in ['true', '1', 'yes'] if pad_tracks_arg is not None else config_params['tracknum_padding']
    
    # Use config values for formatting if not provided
    if not custom_dir_format:
        custom_dir_format = config_params['customDirFormat']
    
    if not custom_track_format:
        custom_track_format = config_params['customTrackFormat']
    
    # Use default album_type if not specified
    if not album_type:
        album_type = "album,single,compilation"
    
    # Validate required parameters
    if not all([service, url, main, quality]):
        return Response(
            json.dumps({"error": "Missing parameters: service, url, main, or quality"}),
            status=400,
            mimetype='application/json'
        )

    # Sanitize main and fallback to prevent directory traversal.
    if main:
        main = os.path.basename(main)
    if fallback:
        fallback = os.path.basename(fallback)

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
            custom_track_format=custom_track_format,
            pad_tracks=pad_tracks
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
    
    if not spotify_id:
        return Response(
            json.dumps({"error": "Missing parameter: id"}),
            status=400,
            mimetype='application/json'
        )
    
    try:
        from routes.utils.get_info import get_spotify_info
        artist_info = get_spotify_info(spotify_id, "artist")
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
