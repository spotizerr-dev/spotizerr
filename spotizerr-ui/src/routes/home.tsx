import { useState, useEffect, useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import { useDebounce } from 'use-debounce';
import apiClient from '../lib/api-client';
import { useQueue } from '../contexts/queue-context';

// --- Type Definitions ---
interface Image { url: string; }
interface BaseItem { id: string; name: string; }
interface Artist extends BaseItem { images?: Image[]; }
interface Album extends BaseItem { images?: Image[]; artists: Artist[]; }
interface Track extends BaseItem { album: Album; artists: Artist[]; }
interface Playlist extends BaseItem { images?: Image[]; owner: { display_name: string }; }

type SearchResultItem = Artist | Album | Track | Playlist;
type SearchType = 'artist' | 'album' | 'track' | 'playlist';

// --- Component ---
export function Home() {
  const [query, setQuery] = useState('');
  const [searchType, setSearchType] = useState<SearchType>('track');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [debouncedQuery] = useDebounce(query, 500);
  const { addItem, toggleVisibility } = useQueue();

  useEffect(() => {
    const performSearch = async () => {
      if (debouncedQuery.trim().length < 2) {
        setResults([]);
        return;
      }
      setIsLoading(true);
      try {
        const response = await apiClient.get<{ items: SearchResultItem[] }>('/search', {
          params: { q: debouncedQuery, search_type: searchType, limit: 40 },
        });
        setResults(response.data.items);
      } catch (error) {
        console.error('Search failed:', error);
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    };
    performSearch();
  }, [debouncedQuery, searchType]);

  const handleDownloadTrack = (track: Track) => {
    addItem({ id: track.id, type: 'track', name: track.name });
    toggleVisibility();
  };

  const renderResult = (item: SearchResultItem) => {
    switch (searchType) {
      case 'track': {
        const track = item as Track;
        return (
          <div key={track.id} className="p-2 flex items-center gap-4 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
            <img src={track.album.images?.[0]?.url || '/placeholder.jpg'} alt={track.album.name} className="w-12 h-12 rounded" />
            <div className="flex-grow">
              <p className="font-semibold">{track.name}</p>
              <p className="text-sm text-gray-500">{track.artists.map(a => a.name).join(', ')}</p>
            </div>
            <button onClick={() => handleDownloadTrack(track)} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full">
              <img src="/download.svg" alt="Download" className="w-5 h-5" />
            </button>
          </div>
        );
      }
      case 'album': {
        const album = item as Album;
        return (
          <Link to="/album/$albumId" params={{ albumId: album.id }} key={album.id} className="block p-2 text-center hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
            <img src={album.images?.[0]?.url || '/placeholder.jpg'} alt={album.name} className="w-full h-auto object-cover rounded shadow-md aspect-square" />
            <p className="mt-2 font-semibold truncate">{album.name}</p>
            <p className="text-sm text-gray-500">{album.artists.map(a => a.name).join(', ')}</p>
          </Link>
        );
      }
      case 'artist': {
        const artist = item as Artist;
        return (
          <Link to="/artist/$artistId" params={{ artistId: artist.id }} key={artist.id} className="block p-2 text-center hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
            <img src={artist.images?.[0]?.url || '/placeholder.jpg'} alt={artist.name} className="w-full h-auto object-cover rounded-full shadow-md aspect-square" />
            <p className="mt-2 font-semibold truncate">{artist.name}</p>
          </Link>
        );
      }
       case 'playlist': {
        const playlist = item as Playlist;
        return (
          <Link to="/playlist/$playlistId" params={{ playlistId: playlist.id }} key={playlist.id} className="block p-2 text-center hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
            <img src={playlist.images?.[0]?.url || '/placeholder.jpg'} alt={playlist.name} className="w-full h-auto object-cover rounded shadow-md aspect-square" />
            <p className="mt-2 font-semibold truncate">{playlist.name}</p>
            <p className="text-sm text-gray-500">by {playlist.owner.display_name}</p>
          </Link>
        );
      }
      default:
        return null;
    }
  };

  const gridClass = useMemo(() => {
      switch(searchType) {
          case 'album':
          case 'artist':
          case 'playlist':
              return "grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4";
          case 'track':
              return "flex flex-col gap-1";
          default:
              return "";
      }
  }, [searchType]);

  return (
    <div className="space-y-6">
      <div className="relative">
        <img src="/search.svg" alt="" className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for songs, albums, artists..."
          className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-700 rounded-full bg-gray-100 dark:bg-gray-800"
        />
        <select
          value={searchType}
          onChange={(e) => setSearchType(e.target.value as SearchType)}
          className="absolute right-2 top-1/2 -translate-y-1/2 bg-transparent border-none text-gray-500"
        >
          <option value="track">Tracks</option>
          <option value="album">Albums</option>
          <option value="artist">Artists</option>
          <option value="playlist">Playlists</option>
        </select>
      </div>

      <div>
        {isLoading && <p>Loading...</p>}
        {!isLoading && debouncedQuery && results.length === 0 && <p>No results found.</p>}
        <div className={gridClass}>
          {results.map(renderResult)}
        </div>
      </div>
    </div>
  );
}
