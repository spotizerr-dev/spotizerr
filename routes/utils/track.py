import os
import json
import traceback
from deezspot.spotloader import SpoLogin
from deezspot.deezloader import DeeLogin
from pathlib import Path

def download_track(
    url,
    main,
    fallback=None,
    quality=None,
    fall_quality=None,
    real_time=False,
    custom_dir_format="%ar_album%/%album%/%copyright%",
    custom_track_format="%tracknum%. %music% - %artist%",
    pad_tracks=True,
    initial_retry_delay=5,
    retry_delay_increase=5,
    max_retries=3,
    progress_callback=None
):
    try:
        # Detect URL source (Spotify or Deezer) from URL
        is_spotify_url = 'open.spotify.com' in url.lower()
        is_deezer_url = 'deezer.com' in url.lower()
        
        # Determine service exclusively from URL
        if is_spotify_url:
            service = 'spotify'
        elif is_deezer_url:
            service = 'deezer'
        else:
            # If URL can't be detected, raise an error
            error_msg = "Invalid URL: Must be from open.spotify.com or deezer.com"
            print(f"ERROR: {error_msg}")
            raise ValueError(error_msg)
            
        print(f"DEBUG: track.py - URL detection: is_spotify_url={is_spotify_url}, is_deezer_url={is_deezer_url}")
        print(f"DEBUG: track.py - Service determined from URL: {service}")
        print(f"DEBUG: track.py - Credentials: main={main}, fallback={fallback}")
        
        # Load Spotify client credentials if available
        spotify_client_id = None
        spotify_client_secret = None
        
        # Smartly determine where to look for Spotify search credentials
        if service == 'spotify' and fallback:
            # If fallback is enabled, use the fallback account for Spotify search credentials
            search_creds_path = Path(f'./data/creds/spotify/{fallback}/search.json')
            print(f"DEBUG: Using Spotify search credentials from fallback: {search_creds_path}")
        else:
            # Otherwise use the main account for Spotify search credentials
            search_creds_path = Path(f'./data/creds/spotify/{main}/search.json')
            print(f"DEBUG: Using Spotify search credentials from main: {search_creds_path}")
            
        if search_creds_path.exists():
            try:
                with open(search_creds_path, 'r') as f:
                    search_creds = json.load(f)
                    spotify_client_id = search_creds.get('client_id')
                    spotify_client_secret = search_creds.get('client_secret')
                    print(f"DEBUG: Loaded Spotify client credentials successfully")
            except Exception as e:
                print(f"Error loading Spotify search credentials: {e}")
                
        # For Spotify URLs: check if fallback is enabled, if so use the fallback logic,
        # otherwise download directly from Spotify
        if service == 'spotify':
            if fallback:
                if quality is None:
                    quality = 'FLAC'
                if fall_quality is None:
                    fall_quality = 'HIGH'
                    
                # First attempt: use Deezer's download_trackspo with 'main' (Deezer credentials)
                deezer_error = None
                try:
                    deezer_creds_dir = os.path.join('./data/creds/deezer', main)
                    deezer_creds_path = os.path.abspath(os.path.join(deezer_creds_dir, 'credentials.json'))
                    
                    # DEBUG: Print Deezer credential paths being used
                    print(f"DEBUG: Looking for Deezer credentials at:")
                    print(f"DEBUG:   deezer_creds_dir = {deezer_creds_dir}")
                    print(f"DEBUG:   deezer_creds_path = {deezer_creds_path}")
                    print(f"DEBUG:   Directory exists = {os.path.exists(deezer_creds_dir)}")
                    print(f"DEBUG:   Credentials file exists = {os.path.exists(deezer_creds_path)}")
                    
                    # List available directories to compare
                    print(f"DEBUG: Available Deezer credential directories:")
                    for dir_name in os.listdir('./data/creds/deezer'):
                        print(f"DEBUG:   ./data/creds/deezer/{dir_name}")
                    
                    with open(deezer_creds_path, 'r') as f:
                        deezer_creds = json.load(f)
                    dl = DeeLogin(
                        arl=deezer_creds.get('arl', ''),
                        spotify_client_id=spotify_client_id,
                        spotify_client_secret=spotify_client_secret,
                        progress_callback=progress_callback
                    )
                    dl.download_trackspo(
                        link_track=url,
                        output_dir="./downloads",
                        quality_download=quality,
                        recursive_quality=False,
                        recursive_download=False,
                        not_interface=False,
                        method_save=1,
                        custom_dir_format=custom_dir_format,
                        custom_track_format=custom_track_format,
                        initial_retry_delay=initial_retry_delay,
                        retry_delay_increase=retry_delay_increase,
                        max_retries=max_retries
                    )
                except Exception as e:
                    deezer_error = e
                    # Immediately report the Deezer error
                    print(f"ERROR: Deezer download attempt failed: {e}")
                    traceback.print_exc()
                    print("Attempting Spotify fallback...")
                    
                    # If the first attempt fails, use the fallback Spotify credentials
                    try:
                        spo_creds_dir = os.path.join('./data/creds/spotify', fallback)
                        spo_creds_path = os.path.abspath(os.path.join(spo_creds_dir, 'credentials.json'))
                        
                        # We've already loaded the Spotify client credentials above based on fallback
                        
                        spo = SpoLogin(
                            credentials_path=spo_creds_path,
                            spotify_client_id=spotify_client_id,
                            spotify_client_secret=spotify_client_secret,
                            progress_callback=progress_callback
                        )
                        spo.download_track(
                            link_track=url,
                            output_dir="./downloads",
                            quality_download=fall_quality,
                            recursive_quality=False,
                            recursive_download=False,
                            not_interface=False,
                            method_save=1,
                            real_time_dl=real_time,
                            custom_dir_format=custom_dir_format,
                            custom_track_format=custom_track_format,
                            pad_tracks=pad_tracks,
                            initial_retry_delay=initial_retry_delay,
                            retry_delay_increase=retry_delay_increase,
                            max_retries=max_retries
                        )
                    except Exception as e2:
                        # If fallback also fails, raise an error indicating both attempts failed
                        raise RuntimeError(
                            f"Both main (Deezer) and fallback (Spotify) attempts failed. "
                            f"Deezer error: {deezer_error}, Spotify error: {e2}"
                        ) from e2
            else:
                # Directly use Spotify main account
                if quality is None:
                    quality = 'HIGH'
                creds_dir = os.path.join('./data/creds/spotify', main)
                credentials_path = os.path.abspath(os.path.join(creds_dir, 'credentials.json'))
                spo = SpoLogin(
                    credentials_path=credentials_path,
                    spotify_client_id=spotify_client_id,
                    spotify_client_secret=spotify_client_secret,
                    progress_callback=progress_callback
                )
                spo.download_track(
                    link_track=url,
                    output_dir="./downloads",
                    quality_download=quality,
                    recursive_quality=False,
                    recursive_download=False,
                    not_interface=False,
                    method_save=1,
                    real_time_dl=real_time,
                    custom_dir_format=custom_dir_format,
                    custom_track_format=custom_track_format,
                    pad_tracks=pad_tracks,
                    initial_retry_delay=initial_retry_delay,
                    retry_delay_increase=retry_delay_increase,
                    max_retries=max_retries
                )
        # For Deezer URLs: download directly from Deezer
        elif service == 'deezer':
            if quality is None:
                quality = 'FLAC'
            # Deezer download logic remains unchanged, with the custom formatting parameters passed along.
            creds_dir = os.path.join('./data/creds/deezer', main)
            creds_path = os.path.abspath(os.path.join(creds_dir, 'credentials.json'))
            with open(creds_path, 'r') as f:
                creds = json.load(f)
            dl = DeeLogin(
                arl=creds.get('arl', ''),
                spotify_client_id=spotify_client_id,
                spotify_client_secret=spotify_client_secret,
                progress_callback=progress_callback
            )
            dl.download_trackdee(
                link_track=url,
                output_dir="./downloads",
                quality_download=quality,
                recursive_quality=False,
                recursive_download=False,
                method_save=1,
                custom_dir_format=custom_dir_format,
                custom_track_format=custom_track_format,
                pad_tracks=pad_tracks,
                initial_retry_delay=initial_retry_delay,
                retry_delay_increase=retry_delay_increase,
                max_retries=max_retries
            )
        else:
            raise ValueError(f"Unsupported service: {service}")
    except Exception as e:
        traceback.print_exc()
        raise
