import { Link, useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import apiClient from '../lib/api-client';
import { useQueue } from '../contexts/queue-context';
import { useSettings } from '../contexts/settings-context';
import type { AlbumType, TrackType } from '../types/spotify';

export const Album = () => {
  const { albumId } = useParams({ from: '/album/$albumId' });
  const [album, setAlbum] = useState<AlbumType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { addItem, toggleVisibility } = useQueue();
  const { settings } = useSettings();

  useEffect(() => {
    const fetchAlbum = async () => {
      try {
        const response = await apiClient.get(`/album/info?id=${albumId}`);
        setAlbum(response.data);
      } catch (err) {
        setError('Failed to load album');
        console.error('Error fetching album:', err);
      }
    };

    if (albumId) {
      fetchAlbum();
    }
  }, [albumId]);

  const handleDownloadTrack = (track: TrackType) => {
    addItem({ id: track.id, type: 'track', name: track.name });
    toggleVisibility();
  };

  const handleDownloadAlbum = () => {
    if (!album) return;
    addItem({ id: album.id, type: 'album', name: album.name });
    toggleVisibility();
  };

  if (error) {
    return <div className="text-red-500">{error}</div>;
  }

  if (!album) {
    return <div>Loading...</div>;
  }

  const isExplicitFilterEnabled = settings?.explicitFilter ?? false;

  // Show placeholder for an entirely explicit album
  if (isExplicitFilterEnabled && album.explicit) {
    return (
      <div className="p-8 text-center border rounded-lg">
        <h2 className="text-2xl font-bold">Explicit Content Filtered</h2>
        <p className="mt-2 text-gray-500">This album has been filtered based on your settings.</p>
      </div>
    );
  }

  const hasExplicitTrack = album.tracks.items.some(track => track.explicit);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row items-start gap-6">
        <img
          src={album.images[0]?.url || '/placeholder.jpg'}
          alt={album.name}
          className="w-48 h-48 object-cover rounded-lg shadow-lg"
        />
        <div className="flex-grow space-y-2">
          <h1 className="text-3xl font-bold">{album.name}</h1>
          <p className="text-lg text-gray-500 dark:text-gray-400">
            By{' '}
            {album.artists.map((artist, index) => (
              <span key={artist.id}>
                <Link
                  to="/artist/$artistId"
                  params={{ artistId: artist.id }}
                  className="hover:underline"
                >
                  {artist.name}
                </Link>
                {index < album.artists.length - 1 && ', '}
              </span>
            ))}
          </p>
          <p className="text-sm text-gray-400 dark:text-gray-500">
            {new Date(album.release_date).getFullYear()} • {album.total_tracks} songs
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-600">
            {album.label}
          </p>
        </div>
        <div className="flex flex-col items-center gap-2">
           <button
            onClick={handleDownloadAlbum}
            disabled={isExplicitFilterEnabled && hasExplicitTrack}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
            title={isExplicitFilterEnabled && hasExplicitTrack ? 'Album contains explicit tracks' : 'Download Full Album'}
          >
            Download Album
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Tracks</h2>
        <div className="space-y-2">
          {album.tracks.items.map((track, index) => {
            if (isExplicitFilterEnabled && track.explicit) {
              return (
                <div key={index} className="flex items-center justify-between p-3 bg-gray-100 dark:bg-gray-800 rounded-lg opacity-50">
                   <div className="flex items-center gap-4">
                     <span className="text-gray-500 dark:text-gray-400 w-8 text-right">{index + 1}</span>
                    <p className="font-medium text-gray-500">Explicit track filtered</p>
                  </div>
                  <span className="text-gray-500">--:--</span>
                </div>
              )
            }
            return (
              <div
                key={track.id}
                className="flex items-center justify-between p-3 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                <div className="flex items-center gap-4">
                  <span className="text-gray-500 dark:text-gray-400 w-8 text-right">{index + 1}</span>
                  <div>
                    <p className="font-medium">{track.name}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {track.artists.map((artist, index) => (
                       <span key={artist.id}>
                          <Link
                            to="/artist/$artistId"
                            params={{ artistId: artist.id }}
                            className="hover:underline"
                          >
                            {artist.name}
                          </Link>
                          {index < track.artists.length - 1 && ', '}
                        </span>
                      ))}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-gray-500 dark:text-gray-400">
                    {Math.floor(track.duration_ms / 60000)}:
                    {((track.duration_ms % 60000) / 1000).toFixed(0).padStart(2, '0')}
                  </span>
                  <button
                    onClick={() => handleDownloadTrack(track)}
                    className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full"
                    title="Download"
                  >
                    <img src="/download.svg" alt="Download" className="w-5 h-5" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  );
}
