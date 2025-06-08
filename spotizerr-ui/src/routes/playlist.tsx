import { Link, useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import apiClient from '../lib/api-client';
import { useQueue } from '../contexts/queue-context';
import { useSettings } from '../contexts/settings-context';
import { toast } from 'sonner';
import type { ImageType, TrackType } from '../types/spotify';

// --- Type Definitions ---
interface SimplifiedAlbumType {
  id: string;
  name: string;
  images: ImageType[];
}

interface PlaylistTrackType extends TrackType {
  album: SimplifiedAlbumType;
}
interface PlaylistItemType { track: PlaylistTrackType | null; }

interface PlaylistDetailsType {
  id:string;
  name: string;
  description: string | null;
  images: ImageType[];
  owner: { display_name?: string };
  followers?: { total: number };
  tracks: { items: PlaylistItemType[]; total: number; };
}

export const Playlist = () => {
  const { playlistId } = useParams({ from: '/playlist/$playlistId' });
  const [playlist, setPlaylist] = useState<PlaylistDetailsType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { addItem, toggleVisibility } = useQueue();
  const { settings } = useSettings();

  useEffect(() => {
    const fetchPlaylist = async () => {
      if (!playlistId) return;
      setIsLoading(true);
      try {
        const response = await apiClient.get<PlaylistDetailsType>(`/playlist/info?id=${playlistId}`);
        setPlaylist(response.data);
      } catch {
        toast.error('Failed to load playlist details.');
      } finally {
        setIsLoading(false);
      }
    };
    fetchPlaylist();
  }, [playlistId]);

  const handleDownloadTrack = (track: PlaylistTrackType) => {
    addItem({ id: track.id, type: 'track', name: track.name });
    toggleVisibility();
  };

  const handleDownloadPlaylist = () => {
      if (!playlist) return;
      // This assumes a backend endpoint that can handle a whole playlist download by its ID
      addItem({ id: playlist.id, type: 'playlist', name: playlist.name });
      toggleVisibility();
      toast.success(`Queued playlist: ${playlist.name}`);
  }

  if (isLoading) return <div>Loading playlist...</div>;
  if (!playlist) return <div>Playlist not found.</div>;

  const isExplicitFilterEnabled = settings?.explicitFilter ?? false;
  const hasExplicitTrack = playlist.tracks.items.some(item => item.track?.explicit);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row items-start gap-8">
        <img src={playlist.images[0]?.url || '/placeholder.jpg'} alt={playlist.name} className="w-48 h-48 object-cover rounded-lg shadow-lg"/>
        <div className="flex-grow space-y-2">
            <h1 className="text-4xl font-bold">{playlist.name}</h1>
            <p className="text-gray-500">By {playlist.owner.display_name}</p>
            {playlist.description && <p className="text-sm text-gray-400" dangerouslySetInnerHTML={{ __html: playlist.description }} />}
            <p className="text-sm text-gray-500">{playlist.followers?.total.toLocaleString()} followers • {playlist.tracks.total} songs</p>
            <div className="pt-2">
                <button
                    onClick={handleDownloadPlaylist}
                    disabled={isExplicitFilterEnabled && hasExplicitTrack}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-500"
                    title={isExplicitFilterEnabled && hasExplicitTrack ? "Playlist contains explicit tracks and can't be downloaded" : 'Download all tracks in playlist'}
                >
                    Download Playlist
                </button>
            </div>
        </div>
      </div>

      <div>
        <div className="flex flex-col">
          {playlist.tracks.items.map(({ track }, index) => {
            if (!track) return null; // Handle cases where a track might be unavailable

            if (isExplicitFilterEnabled && track.explicit) {
                return (
                    <div key={index} className="flex items-center p-3 text-sm bg-gray-100 dark:bg-gray-800 rounded-lg opacity-60">
                        <span className="w-8 text-gray-500">{index + 1}</span>
                        <span className="font-medium text-gray-500">Explicit track filtered</span>
                    </div>
                );
            }

            return (
              <div key={track.id} className="flex items-center gap-4 p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
                <span className="w-6 text-right text-gray-500">{index + 1}</span>
                <img src={track.album.images[track.album.images.length - 1]?.url || '/placeholder.jpg'} alt="" className="w-10 h-10 rounded" />
                <div className="flex-grow">
                    <p className="font-semibold">{track.name}</p>
                    <p className="text-xs text-gray-500">
                        {track.artists.map(a => <Link key={a.id} to="/artist/$artistId" params={{artistId: a.id}} className="hover:underline">{a.name}</Link>).reduce((prev, curr) => <>{prev}, {curr}</>)}
                        {' • '}
                        <Link to="/album/$albumId" params={{albumId: track.album.id}} className="hover:underline">{track.album.name}</Link>
                    </p>
                </div>
                <span className="text-sm text-gray-500 hidden md:block">
                    {Math.floor(track.duration_ms / 60000)}:{((track.duration_ms % 60000) / 1000).toFixed(0).padStart(2, '0')}
                </span>
                <button onClick={() => handleDownloadTrack(track)} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full">
                  <img src="/download.svg" alt="Download" className="w-5 h-5" />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
