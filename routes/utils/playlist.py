import os
import json
import traceback
from deezspot.spotloader import SpoLogin
from deezspot.deezloader import DeeLogin
from pathlib import Path

def download_playlist(
    service,
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
        # Load Spotify client credentials if available
        spotify_client_id = None
        spotify_client_secret = None
        
        # Smartly determine where to look for Spotify search credentials
        if service == 'spotify' and fallback:
            # If fallback is enabled, use the fallback account for Spotify search credentials
            search_creds_path = Path(f'./creds/spotify/{fallback}/search.json')
        else:
            # Otherwise use the main account for Spotify search credentials
            search_creds_path = Path(f'./creds/spotify/{main}/search.json')
            
        if search_creds_path.exists():
            try:
                with open(search_creds_path, 'r') as f:
                    search_creds = json.load(f)
                    spotify_client_id = search_creds.get('client_id')
                    spotify_client_secret = search_creds.get('client_secret')
            except Exception as e:
                print(f"Error loading Spotify search credentials: {e}")
                
        if service == 'spotify':
            if fallback:
                if quality is None:
                    quality = 'FLAC'
                if fall_quality is None:
                    fall_quality = 'HIGH'
                    
                # First attempt: use DeeLogin's download_playlistspo with the 'main' (Deezer credentials)
                deezer_error = None
                try:
                    # Load Deezer credentials from 'main' under deezer directory
                    deezer_creds_dir = os.path.join('./creds/deezer', main)
                    deezer_creds_path = os.path.abspath(os.path.join(deezer_creds_dir, 'credentials.json'))
                    with open(deezer_creds_path, 'r') as f:
                        deezer_creds = json.load(f)
                    # Initialize DeeLogin with Deezer credentials
                    dl = DeeLogin(
                        arl=deezer_creds.get('arl', ''),
                        spotify_client_id=spotify_client_id,
                        spotify_client_secret=spotify_client_secret,
                        progress_callback=progress_callback
                    )
                    # Download using download_playlistspo; pass the custom formatting parameters.
                    dl.download_playlistspo(
                        link_playlist=url,
                        output_dir="./downloads",
                        quality_download=quality,
                        recursive_quality=True,
                        recursive_download=False,
                        not_interface=False,
                        make_zip=False,
                        method_save=1,
                        custom_dir_format=custom_dir_format,
                        custom_track_format=custom_track_format,
                        pad_tracks=pad_tracks,
                        initial_retry_delay=initial_retry_delay,
                        retry_delay_increase=retry_delay_increase,
                        max_retries=max_retries
                    )
                except Exception as e:
                    deezer_error = e
                    # Immediately report the Deezer error
                    print(f"ERROR: Deezer playlist download attempt failed: {e}")
                    traceback.print_exc()
                    print("Attempting Spotify fallback...")
                    
                    # Load fallback Spotify credentials and attempt download
                    try:
                        spo_creds_dir = os.path.join('./creds/spotify', fallback)
                        spo_creds_path = os.path.abspath(os.path.join(spo_creds_dir, 'credentials.json'))
                        
                        # We've already loaded the Spotify client credentials above based on fallback
                        
                        spo = SpoLogin(
                            credentials_path=spo_creds_path,
                            spotify_client_id=spotify_client_id,
                            spotify_client_secret=spotify_client_secret,
                            progress_callback=progress_callback
                        )
                        spo.download_playlist(
                            link_playlist=url,
                            output_dir="./downloads",
                            quality_download=fall_quality,
                            recursive_quality=True,
                            recursive_download=False,
                            not_interface=False,
                            method_save=1,
                            make_zip=False,
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
                # Original behavior: use Spotify main
                if quality is None:
                    quality = 'HIGH'
                creds_dir = os.path.join('./creds/spotify', main)
                credentials_path = os.path.abspath(os.path.join(creds_dir, 'credentials.json'))
                spo = SpoLogin(
                    credentials_path=credentials_path,
                    spotify_client_id=spotify_client_id,
                    spotify_client_secret=spotify_client_secret,
                    progress_callback=progress_callback
                )
                spo.download_playlist(
                    link_playlist=url,
                    output_dir="./downloads",
                    quality_download=quality,
                    recursive_quality=True,
                    recursive_download=False,
                    not_interface=False,
                    method_save=1,
                    make_zip=False,
                    real_time_dl=real_time,
                    custom_dir_format=custom_dir_format,
                    custom_track_format=custom_track_format,
                    pad_tracks=pad_tracks,
                    initial_retry_delay=initial_retry_delay,
                    retry_delay_increase=retry_delay_increase,
                    max_retries=max_retries
                )
        elif service == 'deezer':
            if quality is None:
                quality = 'FLAC'
            # Existing code for Deezer, using main as Deezer account.
            creds_dir = os.path.join('./creds/deezer', main)
            creds_path = os.path.abspath(os.path.join(creds_dir, 'credentials.json'))
            with open(creds_path, 'r') as f:
                creds = json.load(f)
            dl = DeeLogin(
                arl=creds.get('arl', ''),
                spotify_client_id=spotify_client_id,
                spotify_client_secret=spotify_client_secret,
                progress_callback=progress_callback
            )
            dl.download_playlistdee(
                link_playlist=url,
                output_dir="./downloads",
                quality_download=quality,
                recursive_quality=False,
                recursive_download=False,
                method_save=1,
                make_zip=False,
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
        raise  # Re-raise the exception after logging
