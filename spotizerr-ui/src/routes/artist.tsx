import { Link, useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import apiClient from '../lib/api-client';
import { useQueue } from '../contexts/queue-context';
import type { AlbumType } from '../types/spotify';

interface ArtistInfo {
  artist: {
    name: string;
    images: { url: string }[];
    followers: { total: number };
  };
  topTracks: Track[];
  albums: AlbumGroup;
}

interface Track {
  id: string;
  name:string;
  duration_ms: number;
  album: {
    id: string;
    name: string;
    images: { url: string }[];
  };
}

interface UAlbum extends AlbumType {
  is_known?: boolean;
}

interface AlbumGroup {
  album: UAlbum[];
  single: UAlbum[];
  appears_on: UAlbum[];
}

export const Artist = () => {
  const { artistId } = useParams({ from: '/artist/$artistId' });
  const [artistInfo, setArtistInfo] = useState<ArtistInfo | null>(null);
  const [isWatched, setIsWatched] = useState(false);
  const [isWatchEnabled, setIsWatchEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const { addItem, toggleVisibility } = useQueue();

  useEffect(() => {
    const fetchAllData = async () => {
      if (!artistId) return;
      setIsLoading(true);
      try {
        const [infoRes, watchConfigRes, watchStatusRes] = await Promise.all([
          apiClient.get<ArtistInfo>(`/artist/info?id=${artistId}`),
          apiClient.get('/config/watch'),
          apiClient.get(`/artist/watch/status?id=${artistId}`),
        ]);

        setArtistInfo(infoRes.data);
        setIsWatchEnabled(watchConfigRes.data.enabled);
        setIsWatched(watchStatusRes.data.is_watched);

      } catch {
        // The API client interceptor will now handle showing the error toast
      } finally {
        setIsLoading(false);
      }
    };
    fetchAllData();
  }, [artistId]);

  const handleDownloadTrack = (track: Track) => {
    addItem({ id: track.id, type: 'track', name: track.name });
    toggleVisibility();
  };

  const handleDownloadAll = () => {
    if (!artistId || !artistInfo) return;
    addItem({ id: artistId, type: 'artist', name: artistInfo.artist.name });
    toggleVisibility();
  };

  const handleWatch = async () => {
    if (!artistId) return;
    const originalState = isWatched;
    setIsWatched(!originalState); // Optimistic update
    try {
      await apiClient.post(originalState ? '/artist/unwatch' : '/artist/watch', { artistId });
      toast.success(`Artist ${originalState ? 'unwatched' : 'watched'} successfully.`);
    } catch {
      setIsWatched(originalState); // Revert on error
    }
  };

  const handleSync = async () => {
    if (!artistId) return;
    toast.info('Syncing artist...', { id: 'sync-artist' });
    try {
      await apiClient.post('/artist/sync', { artistId });
      toast.success('Artist sync completed.', { id: 'sync-artist' });
    } catch {
      toast.error('Artist sync failed.', { id: 'sync-artist' });
    }
  };

   const handleMarkAsKnown = async (albumId: string, known: boolean) => {
    if (!artistId) return;
    try {
      await apiClient.post('/artist/album/mark', { artistId, albumId, known });
      setArtistInfo(prev => {
          if (!prev) return null;
          const updateAlbums = (albums: UAlbum[]) => albums.map(a => a.id === albumId ? { ...a, is_known: known } : a);
          return {
              ...prev,
              albums: {
                  album: updateAlbums(prev.albums.album),
                  single: updateAlbums(prev.albums.single),
                  appears_on: updateAlbums(prev.albums.appears_on),
              }
          }
      });
      toast.success(`Album marked as ${known ? 'seen' : 'unseen'}.`);
    } catch {
        // Error toast handled by interceptor
    }
  };

  if (isLoading) return <div>Loading artist...</div>;
  if (!artistInfo) return <div className="p-4 text-center">Could not load artist details.</div>;


  const { artist, topTracks, albums } = artistInfo;

  const renderAlbumCard = (album: UAlbum) => (
    <div key={album.id} className="w-40 flex-shrink-0 group relative">
      <Link to="/album/$albumId" params={{ albumId: album.id }}>
        <img
          src={album.images[0]?.url || '/placeholder.jpg'}
          alt={album.name}
          className={`w-full h-40 object-cover rounded-lg shadow-md group-hover:shadow-lg transition-shadow ${album.is_known ? 'opacity-50' : ''}`}
        />
        <p className="mt-2 text-sm font-semibold truncate">{album.name}</p>
        <p className="text-xs text-gray-500">{new Date(album.release_date).getFullYear()}</p>
      </Link>
      {isWatched && (
        <button
            onClick={() => handleMarkAsKnown(album.id, !album.is_known)}
            title={album.is_known ? 'Mark as not seen' : 'Mark as seen'}
            className="absolute top-1 right-1 bg-white/70 dark:bg-black/70 p-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
        >
            <img src={album.is_known ? '/check.svg' : '/plus-circle.svg'} alt="Mark" className="w-5 h-5" />
        </button>
      )}
    </div>
  );

  return (
    <div className="space-y-8">
      {/* Artist Header */}
      <div className="flex flex-col md:flex-row items-center gap-8">
        <img
          src={artist.images[0]?.url || '/placeholder.jpg'}
          alt={artist.name}
          className="w-48 h-48 rounded-full object-cover shadow-2xl"
        />
        <div className="text-center md:text-left flex-grow">
          <h1 className="text-5xl font-extrabold">{artist.name}</h1>
          <p className="text-gray-500 mt-2">{artist.followers.total.toLocaleString()} followers</p>
          <div className="mt-4 flex flex-wrap gap-2 justify-center md:justify-start">
             <button
                onClick={handleDownloadAll}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center justify-center gap-2"
            >
                <img src="/download.svg" alt="" className="w-5 h-5" />
                Download All
            </button>
             {isWatchEnabled && (
                <>
                    <button
                        onClick={handleWatch}
                        className={`px-4 py-2 rounded-lg transition-colors flex items-center justify-center gap-2 ${
                            isWatched
                                ? 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600'
                                : 'bg-blue-600 text-white hover:bg-blue-700'
                        }`}
                    >
                        <img src={isWatched ? '/eye-crossed.svg' : '/eye.svg'} alt="" className="w-5 h-5" />
                        {isWatched ? 'Unwatch' : 'Watch'}
                    </button>
                    {isWatched && (
                        <button
                            onClick={handleSync}
                            className="p-2 rounded-lg bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                            title="Sync Artist"
                        >
                            <img src="/refresh-cw.svg" alt="Sync" className="w-5 h-5" />
                        </button>
                    )}
                </>
            )}
          </div>
        </div>
      </div>

      {/* Top Tracks */}
      <section>
        <h2 className="text-2xl font-bold mb-4">Top Tracks</h2>
        <div className="space-y-2">
          {topTracks.map((track) => (
            <div key={track.id} className="flex items-center justify-between p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
              <div className="flex items-center gap-4">
                <img src={track.album.images[2]?.url || '/placeholder.jpg'} alt={track.album.name} className="w-12 h-12 rounded-md" />
                <div>
                  <p className="font-semibold">{track.name}</p>
                  <p className="text-sm text-gray-500">
                     {Math.floor(track.duration_ms / 60000)}:
                    {((track.duration_ms % 60000) / 1000).toFixed(0).padStart(2, '0')}
                  </p>
                </div>
              </div>
              <button onClick={() => handleDownloadTrack(track)} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full">
                <img src="/download.svg" alt="Download" className="w-5 h-5" />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Albums */}
      <section>
        <h2 className="text-2xl font-bold mb-4">Albums</h2>
        <div className="flex gap-4 overflow-x-auto pb-4">
          {albums.album.map(renderAlbumCard)}
        </div>
      </section>

      {/* Singles */}
       <section>
        <h2 className="text-2xl font-bold mb-4">Singles & EPs</h2>
        <div className="flex gap-4 overflow-x-auto pb-4">
          {albums.single.map(renderAlbumCard)}
        </div>
      </section>

      {/* Appears On */}
      <section>
        <h2 className="text-2xl font-bold mb-4">Appears On</h2>
        <div className="flex gap-4 overflow-x-auto pb-4">
          {albums.appears_on.map(renderAlbumCard)}
        </div>
      </section>
    </div>
  );
}
