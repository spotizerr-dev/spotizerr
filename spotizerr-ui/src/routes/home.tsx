import { useState, useEffect, useMemo, useContext, useCallback, useRef } from "react";
import { useNavigate, useSearch, useRouterState } from "@tanstack/react-router";
import { useDebounce } from "use-debounce";
import { toast } from "sonner";
import type { TrackType, AlbumType, SearchResult } from "@/types/spotify";
import { QueueContext } from "@/contexts/queue-context";
import { SearchResultCard } from "@/components/SearchResultCard";
import { indexRoute } from "@/router";
import { Music, Disc, User, ListMusic } from "lucide-react";

// Utility function to safely get properties from search results
const safelyGetProperty = <T,>(obj: any, path: string[], fallback: T): T => {
  try {
    let current = obj;
    for (const key of path) {
      if (current == null || typeof current !== 'object') {
        return fallback;
      }
      current = current[key];
    }
    return current ?? fallback;
  } catch {
    return fallback;
  }
};

const PAGE_SIZE = 12;

export const Home = () => {
  const navigate = useNavigate({ from: "/" });
  const { q, type } = useSearch({ from: "/" });
  const { items: allResults } = indexRoute.useLoaderData();
  const isLoading = useRouterState({ select: (s) => s.status === "pending" });

  const [query, setQuery] = useState(q || "");
  const [searchType, setSearchType] = useState<"track" | "album" | "artist" | "playlist">(type || "track");
  const [debouncedQuery] = useDebounce(query, 500);

  const [displayedResults, setDisplayedResults] = useState<SearchResult[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const context = useContext(QueueContext);
  const loaderRef = useRef<HTMLDivElement | null>(null);

  // Removed scroll locking on mobile empty state to avoid blocking scroll globally

  useEffect(() => {
    navigate({ search: (prev) => ({ ...prev, q: debouncedQuery, type: searchType }) });
  }, [debouncedQuery, searchType, navigate]);

  useEffect(() => {
    setDisplayedResults(allResults.slice(0, PAGE_SIZE));
  }, [allResults]);

  if (!context) {
    throw new Error("useQueue must be used within a QueueProvider");
  }
  const { addItem } = context;

  const loadMore = useCallback(() => {
    setIsLoadingMore(true);
    setTimeout(() => {
      const currentLength = displayedResults.length;
      const nextBatch = allResults.slice(currentLength, currentLength + PAGE_SIZE);
      setDisplayedResults((prev) => [...prev, ...nextBatch]);
      setIsLoadingMore(false);
    }, 500); // Simulate network delay
  }, [allResults, displayedResults]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const firstEntry = entries[0];
        if (firstEntry.isIntersecting && allResults.length > displayedResults.length) {
          loadMore();
        }
      },
      { threshold: 1.0 },
    );

    const currentLoader = loaderRef.current;
    if (currentLoader) {
      observer.observe(currentLoader);
    }

    return () => {
      if (currentLoader) {
        observer.unobserve(currentLoader);
      }
    };
  }, [allResults, displayedResults, loadMore]);

  const handleDownloadTrack = useCallback(
    (track: TrackType) => {
      const artistName = track.artists?.map((a) => a.name).join(", ");
      addItem({ spotifyId: track.id, type: "track", name: track.name, artist: artistName });
      toast.info(`Adding ${track.name} to queue...`);
    },
    [addItem],
  );

  const handleDownloadAlbum = useCallback(
    (album: AlbumType) => {
      const artistName = album.artists?.map((a) => a.name).join(", ");
      addItem({ spotifyId: album.id, type: "album", name: album.name, artist: artistName });
      toast.info(`Adding ${album.name} to queue...`);
    },
    [addItem],
  );

  const resultComponent = useMemo(() => {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {displayedResults.map((item) => {
          // Add safety checks for essential properties
          if (!item || !item.id || !item.name || !item.model) {
            return null;
          }

          let imageUrl;
          let onDownload;
          let subtitle;

          if (item.model === "track") {
            imageUrl = safelyGetProperty(item, ['album', 'images', '0', 'url'], undefined);
            onDownload = () => handleDownloadTrack(item as TrackType);
            const artists = safelyGetProperty(item, ['artists'], []);
            subtitle = Array.isArray(artists) ? artists.map((a: any) => safelyGetProperty(a, ['name'], 'Unknown')).join(", ") : "Unknown Artist";
          } else if (item.model === "album") {
            imageUrl = safelyGetProperty(item, ['images', '0', 'url'], undefined);
            onDownload = () => handleDownloadAlbum(item as AlbumType);
            const artists = safelyGetProperty(item, ['artists'], []);
            subtitle = Array.isArray(artists) ? artists.map((a: any) => safelyGetProperty(a, ['name'], 'Unknown')).join(", ") : "Unknown Artist";
          } else if (item.model === "artist") {
            imageUrl = safelyGetProperty(item, ['images', '0', 'url'], undefined);
            subtitle = "Artist";
          } else if (item.model === "playlist") {
            imageUrl = safelyGetProperty(item, ['images', '0', 'url'], undefined);
            const ownerName = safelyGetProperty(item, ['owner', 'display_name'], 'Unknown');
            subtitle = `By ${ownerName}`;
          }

          return (
            <SearchResultCard
              key={item.id}
              id={item.id}
              name={item.name}
              type={item.model}
              imageUrl={imageUrl}
              subtitle={subtitle}
              onDownload={onDownload}
            />
          );
        }).filter(Boolean)} {/* Filter out null components */}
      </div>
    );
  }, [displayedResults, handleDownloadTrack, handleDownloadAlbum]);

  return (
    <div className="max-w-4xl mx-auto h-full flex flex-col md:p-4">
      <div className="text-center mb-4 md:mb-8 px-4 md:px-0">
        <h1 className="text-2xl font-bold text-content-primary dark:text-content-primary-dark">Spotizerr</h1>
      </div>
      <div className="flex flex-col sm:flex-row gap-3 mb-4 md:mb-6 px-4 md:px-0 flex-shrink-0">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for a track, album, artist, or playlist"
          className="flex-1 p-2 border bg-input-background dark:bg-input-background-dark border-input-border dark:border-input-border-dark rounded-md focus:outline-none focus:ring-2 focus:ring-input-focus"
        />
        <div className="flex gap-2">
          {["track", "album", "artist", "playlist"].map((typeOption) => (
            <button
              key={typeOption}
              onClick={() => setSearchType(typeOption as "track" | "album" | "artist" | "playlist")}
              className={`flex items-center gap-1 p-2 rounded-md text-sm font-medium transition-colors border ${
                searchType === typeOption
                  ? "bg-green-600 text-white border-green-600"
                  : "bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 border-gray-300 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600"
              }`}
              
            >
              {
                {
                  track: <Music size={16} />,
                  album: <Disc size={16} />,
                  artist: <User size={16} />,
                  playlist: <ListMusic size={16} />,
                }[typeOption]
              }
              {typeOption.charAt(0).toUpperCase() + typeOption.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className={`flex-1 px-4 md:px-0 pb-4 ${
        // Only restrict overflow on mobile when there are results, otherwise allow normal behavior
        displayedResults.length > 0 ? 'overflow-y-auto md:overflow-visible' : ''
      }`}>
        {isLoading ? (
          <p className="text-center my-4 text-content-muted dark:text-content-muted-dark">Loading results...</p>
        ) : (
              <>
                {resultComponent}
                <div ref={loaderRef} />
                {isLoadingMore && <p className="text-center my-4 text-content-muted dark:text-content-muted-dark">Loading more results...</p>}
              </>
        )}
      </div>
    </div>
  );
};
