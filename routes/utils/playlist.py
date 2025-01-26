import os
import json
import traceback
from deezspot.spotloader import SpoLogin
from deezspot.deezloader import DeeLogin

def download_playlist(service, url, account):
    try:
        if service == 'spotify':
            # Construct Spotify credentials path
            creds_dir = os.path.join('./creds/spotify', account)
            credentials_path = os.path.abspath(os.path.join(creds_dir, 'credentials.json'))
            
            # Initialize Spotify client
            spo = SpoLogin(credentials_path=credentials_path)
            
            # Download Spotify playlist
            spo.download_playlist(
                link_playlist=url,
                output_dir="./downloads/playlists",
                quality_download="NORMAL",
                recursive_quality=True,
                recursive_download=False,
                not_interface=False,
                method_save=1,
                make_zip=True
            )
            
        elif service == 'deezer':
            # Construct Deezer credentials path
            creds_dir = os.path.join('./creds/deezer', account)
            creds_path = os.path.abspath(os.path.join(creds_dir, 'credentials.json'))
            
            # Load Deezer credentials
            with open(creds_path, 'r') as f:
                creds = json.load(f)
            
            # Initialize Deezer client
            dl = DeeLogin(
                arl=creds.get('arl', ''),
                email=creds.get('email', ''),
                password=creds.get('password', '')
            )
            
            # Download Deezer playlist
            dl.download_playlistdee(
                link_playlist=url,
                output_dir="./downloads/playlists",
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