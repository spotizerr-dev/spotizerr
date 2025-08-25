import traceback
from typing import Optional
from deezspot.spotloader import SpoLogin
from deezspot.deezloader import DeeLogin
from routes.utils.credentials import (
    get_credential,
    _get_global_spotify_api_creds,
    get_spotify_blob_path,
)
from routes.utils.redis_rate_limiter import global_rate_limiter


@global_rate_limiter.rate_limit_decorator
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
    save_cover=True,
    initial_retry_delay=5,
    retry_delay_increase=5,
    max_retries=3,
    progress_callback=None,
    convert_to=None,
    bitrate=None,
    artist_separator="; ",
    recursive_quality=False,
    spotify_metadata=True,
    _is_celery_task_execution=False,  # Added for consistency, not currently used for duplicate check
    real_time_multiplier: Optional[int] = None,
    pad_number_width: Optional[int] = None,
):
    try:
        _pad_number_width = int(pad_number_width) if pad_number_width is not None else 0
        _real_time_multiplier = int(real_time_multiplier) if real_time_multiplier is not None else 0
        # Detect URL source (Spotify or Deezer) from URL
        is_spotify_url = "open.spotify.com" in url.lower()
        is_deezer_url = "deezer.com" in url.lower()

        service = ""
        if is_spotify_url:
            service = "spotify"
        elif is_deezer_url:
            service = "deezer"
        else:
            error_msg = "Invalid URL: Must be from open.spotify.com or deezer.com"
            print(f"ERROR: {error_msg}")
            raise ValueError(error_msg)

        print(f"DEBUG: track.py - Service determined from URL: {service}")
        print(
            f"DEBUG: track.py - Credentials provided: main_account_name='{main}', fallback_account_name='{fallback}'"
        )

        # Get global Spotify API credentials for SpoLogin and DeeLogin (if it uses Spotify search)
        global_spotify_client_id, global_spotify_client_secret = (
            _get_global_spotify_api_creds()
        )
        if not global_spotify_client_id or not global_spotify_client_secret:
            # This is a critical failure if Spotify operations are involved
            warning_msg = "WARN: track.py - Global Spotify client_id/secret not found in search.json. Spotify operations will likely fail."
            print(warning_msg)
            # Depending on flow, might want to raise error here if service is 'spotify'
            # For now, let it proceed and fail at SpoLogin/DeeLogin init if keys are truly needed and missing.

        if service == "spotify":
            if fallback:  # Fallback is a Deezer account name for a Spotify URL
                if quality is None:
                    quality = "FLAC"  # Deezer quality for first attempt
                if fall_quality is None:
                    fall_quality = (
                        "HIGH"  # Spotify quality for fallback (if Deezer fails)
                    )

                deezer_error = None
                try:
                    # Attempt 1: Deezer via download_trackspo (using 'fallback' as Deezer account name)
                    print(
                        f"DEBUG: track.py - Spotify URL. Attempt 1: Deezer (account: {fallback})"
                    )
                    deezer_fallback_creds = get_credential("deezer", fallback)
                    arl = deezer_fallback_creds.get("arl")
                    if not arl:
                        raise ValueError(
                            f"ARL not found for Deezer account '{fallback}'."
                        )

                    dl = DeeLogin(
                        arl=arl,
                        spotify_client_id=global_spotify_client_id,  # Global creds
                        spotify_client_secret=global_spotify_client_secret,  # Global creds
                        progress_callback=progress_callback,
                    )
                    # download_trackspo means: Spotify URL, download via Deezer
                    dl.download_trackspo(
                        link_track=url,  # Spotify URL
                        output_dir="./downloads",
                        quality_download=quality,  # Deezer quality
                        recursive_quality=recursive_quality,
                        recursive_download=False,
                        not_interface=False,
                        custom_dir_format=custom_dir_format,
                        custom_track_format=custom_track_format,
                        save_cover=save_cover,
                        initial_retry_delay=initial_retry_delay,
                        retry_delay_increase=retry_delay_increase,
                        max_retries=max_retries,
                        convert_to=convert_to,
                        bitrate=bitrate,
                        artist_separator=artist_separator,
                        spotify_metadata=spotify_metadata,
                        pad_number_width=_pad_number_width,
                    )
                    print(
                        f"DEBUG: track.py - Track download via Deezer (account: {fallback}) successful for Spotify URL."
                    )
                except Exception as e:
                    deezer_error = e
                    print(
                        f"ERROR: track.py - Deezer attempt (account: {fallback}) for Spotify URL failed: {e}"
                    )
                    traceback.print_exc()
                    print(
                        f"DEBUG: track.py - Attempting Spotify direct download (account: {main})..."
                    )

                    # Attempt 2: Spotify direct via download_track (using 'main' as Spotify account for blob)
                    try:
                        if (
                            not global_spotify_client_id
                            or not global_spotify_client_secret
                        ):
                            raise ValueError(
                                "Global Spotify API credentials (client_id/secret) not configured for Spotify download."
                            )

                        # Use get_spotify_blob_path directly
                        blob_file_path = get_spotify_blob_path(main)
                        if (
                            not blob_file_path.exists()
                        ):  # Check existence on the Path object
                            raise FileNotFoundError(
                                f"Spotify credentials blob file not found at {str(blob_file_path)} for account '{main}'"
                            )

                        spo = SpoLogin(
                            credentials_path=str(
                                blob_file_path
                            ),  # Account specific blob
                            spotify_client_id=global_spotify_client_id,  # Global API keys
                            spotify_client_secret=global_spotify_client_secret,  # Global API keys
                            progress_callback=progress_callback,
                        )
                        spo.download_track(
                            link_track=url,  # Spotify URL
                            output_dir="./downloads",
                            quality_download=fall_quality,  # Spotify quality
                            recursive_quality=recursive_quality,
                            recursive_download=False,
                            not_interface=False,
                            real_time_dl=real_time,
                            custom_dir_format=custom_dir_format,
                            custom_track_format=custom_track_format,
                            pad_tracks=pad_tracks,
                            save_cover=save_cover,
                            initial_retry_delay=initial_retry_delay,
                            retry_delay_increase=retry_delay_increase,
                            max_retries=max_retries,
                            convert_to=convert_to,
                            bitrate=bitrate,
                            artist_separator=artist_separator,
                            pad_number_width=_pad_number_width,
                        )
                        print(
                            f"DEBUG: track.py - Spotify direct download (account: {main} for blob) successful."
                        )
                    except Exception as e2:
                        print(
                            f"ERROR: track.py - Spotify direct download (account: {main} for blob) also failed: {e2}"
                        )
                        raise RuntimeError(
                            f"Both Deezer attempt (account: {fallback}) and Spotify direct (account: {main} for blob) failed. "
                            f"Deezer error: {deezer_error}, Spotify error: {e2}"
                        ) from e2
            else:
                # Spotify URL, no fallback. Direct Spotify download using 'main' (Spotify account for blob)
                if quality is None:
                    quality = "HIGH"  # Default Spotify quality
                print(
                    f"DEBUG: track.py - Spotify URL, no fallback. Direct download with Spotify account (for blob): {main}"
                )

                if not global_spotify_client_id or not global_spotify_client_secret:
                    raise ValueError(
                        "Global Spotify API credentials (client_id/secret) not configured for Spotify download."
                    )

                # Use get_spotify_blob_path directly
                blob_file_path = get_spotify_blob_path(main)
                if not blob_file_path.exists():  # Check existence on the Path object
                    raise FileNotFoundError(
                        f"Spotify credentials blob file not found at {str(blob_file_path)} for account '{main}'"
                    )

                spo = SpoLogin(
                    credentials_path=str(blob_file_path),  # Account specific blob
                    spotify_client_id=global_spotify_client_id,  # Global API keys
                    spotify_client_secret=global_spotify_client_secret,  # Global API keys
                    progress_callback=progress_callback,
                )
                spo.download_track(
                    link_track=url,
                    output_dir="./downloads",
                    quality_download=quality,
                    recursive_quality=recursive_quality,
                    recursive_download=False,
                    not_interface=False,
                    real_time_dl=real_time,
                    custom_dir_format=custom_dir_format,
                    custom_track_format=custom_track_format,
                    pad_tracks=pad_tracks,
                    save_cover=save_cover,
                    initial_retry_delay=initial_retry_delay,
                    retry_delay_increase=retry_delay_increase,
                    max_retries=max_retries,
                    convert_to=convert_to,
                    bitrate=bitrate,
                    artist_separator=artist_separator,
                    real_time_multiplier=_real_time_multiplier,
                    pad_number_width=_pad_number_width,
                )
                print(
                    f"DEBUG: track.py - Direct Spotify download (account: {main} for blob) successful."
                )

        elif service == "deezer":
            # Deezer URL. Direct Deezer download using 'main' (Deezer account name for ARL)
            if quality is None:
                quality = "FLAC"  # Default Deezer quality
            print(
                f"DEBUG: track.py - Deezer URL. Direct download with Deezer account: {main}"
            )
            deezer_main_creds = get_credential("deezer", main)  # For ARL
            arl = deezer_main_creds.get("arl")
            if not arl:
                raise ValueError(f"ARL not found for Deezer account '{main}'.")

            dl = DeeLogin(
                arl=arl,  # Account specific ARL
                spotify_client_id=global_spotify_client_id,  # Global Spotify keys for internal Spo use by DeeLogin
                spotify_client_secret=global_spotify_client_secret,  # Global Spotify keys
                progress_callback=progress_callback,
            )
            dl.download_trackdee(  # Deezer URL, download via Deezer
                link_track=url,
                output_dir="./downloads",
                quality_download=quality,
                recursive_quality=recursive_quality,
                recursive_download=False,
                custom_dir_format=custom_dir_format,
                custom_track_format=custom_track_format,
                pad_tracks=pad_tracks,
                save_cover=save_cover,
                initial_retry_delay=initial_retry_delay,
                retry_delay_increase=retry_delay_increase,
                max_retries=max_retries,
                convert_to=convert_to,
                bitrate=bitrate,
                artist_separator=artist_separator,
                pad_number_width=_pad_number_width,
            )
            print(
                f"DEBUG: track.py - Direct Deezer download (account: {main}) successful."
            )
        else:
            # Should be caught by initial service check, but as a safeguard
            raise ValueError(f"Unsupported service determined: {service}")
    except Exception:
        traceback.print_exc()
        raise
