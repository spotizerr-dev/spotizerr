import os
import json
import traceback
from deezspot.spotloader import SpoLogin
from deezspot.deezloader import DeeLogin

def download_track(service, url, main, fallback=None):
    try:
        if service == 'spotify':
            if fallback:
                # First attempt: use Deezer's download_trackspo with 'main' (Deezer credentials)
                try:
                    deezer_creds_dir = os.path.join('./creds/deezer', main)
                    deezer_creds_path = os.path.abspath(os.path.join(deezer_creds_dir, 'credentials.json'))
                    with open(deezer_creds_path, 'r') as f:
                        deezer_creds = json.load(f)
                    dl = DeeLogin(
                        arl=deezer_creds.get('arl', ''),
                        email=deezer_creds.get('email', ''),
                        password=deezer_creds.get('password', '')
                    )
                    dl.download_trackspo(
                        link_track=url,
                        output_dir="./downloads",
                        quality_download="FLAC",
                        recursive_quality=False,
                        recursive_download=False,
                        not_interface=False,
                        method_save=1
                    )
                except Exception as e:
                    # Fallback to Spotify credentials if Deezer fails
                    print(f"Failed to download via Deezer fallback: {e}. Trying Spotify fallback.")
                    spo_creds_dir = os.path.join('./creds/spotify', fallback)
                    spo_creds_path = os.path.abspath(os.path.join(spo_creds_dir, 'credentials.json'))
                    spo = SpoLogin(credentials_path=spo_creds_path)
                    spo.download_track(
                        link_track=url,
                        output_dir="./downloads",
                        quality_download="HIGH",
                        recursive_quality=False,
                        recursive_download=False,
                        not_interface=False,
                        method_save=1
                    )
            else:
                # Directly use Spotify main account
                creds_dir = os.path.join('./creds/spotify', main)
                credentials_path = os.path.abspath(os.path.join(creds_dir, 'credentials.json'))
                spo = SpoLogin(credentials_path=credentials_path)
                spo.download_track(
                    link_track=url,
                    output_dir="./downloads",
                    quality_download="HIGH",
                    recursive_quality=False,
                    recursive_download=False,
                    not_interface=False,
                    method_save=1
                )
        elif service == 'deezer':
            # Deezer download logic remains unchanged
            creds_dir = os.path.join('./creds/deezer', main)
            creds_path = os.path.abspath(os.path.join(creds_dir, 'credentials.json'))
            with open(creds_path, 'r') as f:
                creds = json.load(f)
            dl = DeeLogin(
                arl=creds.get('arl', ''),
                email=creds.get('email', ''),
                password=creds.get('password', '')
            )
            dl.download_trackdee(
                link_track=url,
                output_dir="./downloads",
                quality_download="FLAC",
                recursive_quality=False,
                recursive_download=False,
                method_save=1
            )
        else:
            raise ValueError(f"Unsupported service: {service}")
    except Exception as e:
        traceback.print_exc()
        raise