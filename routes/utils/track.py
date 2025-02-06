import os
import json
import traceback
from deezspot.spotloader import SpoLogin
from deezspot.deezloader import DeeLogin

def download_track(
    service,
    url,
    main,
    fallback=None,
    quality=None,
    fall_quality=None,
    real_time=False,
    custom_dir_format="%ar_album%/%album%/%copyright%",
    custom_track_format="%tracknum%. %music% - %artist%"
):
    try:
        if service == 'spotify':
            if fallback:
                if quality is None:
                    quality = 'FLAC'
                if fall_quality is None:
                    fall_quality = 'HIGH'
                # First attempt: use Deezer's download_trackspo with 'main' (Deezer credentials)
                try:
                    deezer_creds_dir = os.path.join('./creds/deezer', main)
                    deezer_creds_path = os.path.abspath(os.path.join(deezer_creds_dir, 'credentials.json'))
                    with open(deezer_creds_path, 'r') as f:
                        deezer_creds = json.load(f)
                    dl = DeeLogin(
                        arl=deezer_creds.get('arl', '')
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
                        custom_track_format=custom_track_format
                    )
                except Exception as e:
                    # If the first attempt fails, use the fallback Spotify credentials
                    spo_creds_dir = os.path.join('./creds/spotify', fallback)
                    spo_creds_path = os.path.abspath(os.path.join(spo_creds_dir, 'credentials.json'))
                    spo = SpoLogin(credentials_path=spo_creds_path)
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
                        custom_track_format=custom_track_format
                    )
            else:
                # Directly use Spotify main account
                if quality is None:
                    quality = 'HIGH'
                creds_dir = os.path.join('./creds/spotify', main)
                credentials_path = os.path.abspath(os.path.join(creds_dir, 'credentials.json'))
                spo = SpoLogin(credentials_path=credentials_path)
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
                    custom_track_format=custom_track_format
                )
        elif service == 'deezer':
            if quality is None:
                quality = 'FLAC'
            # Deezer download logic remains unchanged, with the custom formatting parameters passed along.
            creds_dir = os.path.join('./creds/deezer', main)
            creds_path = os.path.abspath(os.path.join(creds_dir, 'credentials.json'))
            with open(creds_path, 'r') as f:
                creds = json.load(f)
            dl = DeeLogin(
                arl=creds.get('arl', '')
            )
            dl.download_trackdee(
                link_track=url,
                output_dir="./downloads",
                quality_download=quality,
                recursive_quality=False,
                recursive_download=False,
                method_save=1,
                custom_dir_format=custom_dir_format,
                custom_track_format=custom_track_format
            )
        else:
            raise ValueError(f"Unsupported service: {service}")
    except Exception as e:
        traceback.print_exc()
        raise
