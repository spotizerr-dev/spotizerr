import { Link, useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import apiClient from '../lib/api-client';
import { useQueue } from '../contexts/queue-context';
import type { TrackType, ImageType } from '../types/spotify';

interface SimplifiedAlbum {
    id: string;
    name: string;
    images: ImageType[];
    album_type: string;
}

interface TrackDetails extends TrackType {
  album: SimplifiedAlbum;
}

export const Track = () => {
  const { trackId } = useParams({ from: '/track/$trackId' });
  const [track, setTrack] = useState<TrackDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { addItem, toggleVisibility } = useQueue();

  useEffect(() => {
    const fetchTrack = async () => {
      if (!trackId) return;
      try {
        const response = await apiClient.get<TrackDetails>(`/track/info?id=${trackId}`);
        setTrack(response.data);
      } catch (err) {
        setError('Failed to load track details.');
        console.error(err);
      }
    };
    fetchTrack();
  }, [trackId]);

  const handleDownload = () => {
    if (!track) return;
    addItem({ id: track.id, type: 'track', name: track.name });
    toggleVisibility();
  };

  if (error) return <div className="text-red-500">{error}</div>;
  if (!track) return <div>Loading...</div>;

  const minutes = Math.floor(track.duration_ms / 60000);
  const seconds = ((track.duration_ms % 60000) / 1000).toFixed(0).padStart(2, '0');

  return (
    <div className="flex flex-col md:flex-row items-center gap-8 p-4">
      <img
        src={track.album.images[0]?.url || '/placeholder.jpg'}
        alt={track.album.name}
        className="w-64 h-64 object-cover rounded-lg shadow-2xl"
      />
      <div className="flex-grow space-y-3 text-center md:text-left">
        <h1 className="text-4xl font-extrabold">{track.name}</h1>
        <p className="text-xl text-gray-500">
          By{' '}
          {track.artists.map((artist, index) => (
            <span key={artist.id}>
              <Link to="/artist/$artistId" params={{ artistId: artist.id }} className="hover:underline">
                {artist.name}
              </Link>
              {index < track.artists.length - 1 && ', '}
            </span>
          ))}
        </p>
        <p className="text-lg text-gray-400">
          From the {track.album.album_type}{' '}
          <Link to="/album/$albumId" params={{ albumId: track.album.id }} className="hover:underline font-semibold">
            {track.album.name}
          </Link>
        </p>
        <div className="flex items-center justify-center md:justify-start gap-4 text-sm text-gray-500">
            <span>{minutes}:{seconds}</span>
            {track.explicit && <span className="px-2 py-0.5 bg-gray-200 dark:bg-gray-700 text-xs font-semibold rounded-full">EXPLICIT</span>}
        </div>
        <div className="pt-4">
          <button
            onClick={handleDownload}
            className="px-6 py-3 bg-green-600 text-white rounded-full hover:bg-green-700 transition-colors flex items-center justify-center gap-2 text-lg"
          >
            <img src="/download.svg" alt="" className="w-6 h-6" />
            Download
          </button>
        </div>
      </div>
    </div>
  );
};
