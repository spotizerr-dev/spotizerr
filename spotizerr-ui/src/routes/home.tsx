import { useState, useEffect, useMemo, useContext, useCallback, useRef } from "react";
import { useNavigate, useSearch, useRouterState } from "@tanstack/react-router";
import { useDebounce } from "use-debounce";
import { toast } from "sonner";
import type { TrackType, AlbumType, ArtistType, PlaylistType, SearchResult } from "@/types/spotify";
import { QueueContext } from "@/contexts/queue-context";
import { SearchResultCard } from "@/components/SearchResultCard";
import { indexRoute } from "@/router";

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
          let imageUrl;
          let onDownload;
          let subtitle;

          if (item.model === "track") {
            imageUrl = (item as TrackType).album?.images?.[0]?.url;
            onDownload = () => handleDownloadTrack(item as TrackType);
            subtitle = (item as TrackType).artists?.map((a) => a.name).join(", ");
          } else if (item.model === "album") {
            imageUrl = (item as AlbumType).images?.[0]?.url;
            onDownload = () => handleDownloadAlbum(item as AlbumType);
            subtitle = (item as AlbumType).artists?.map((a) => a.name).join(", ");
          } else if (item.model === "artist") {
            imageUrl = (item as ArtistType).images?.[0]?.url;
            subtitle = "Artist";
          } else if (item.model === "playlist") {
            imageUrl = (item as PlaylistType).images?.[0]?.url;
            subtitle = `By ${(item as PlaylistType).owner?.display_name || "Unknown"}`;
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
        })}
      </div>
    );
  }, [displayedResults, handleDownloadTrack, handleDownloadAlbum]);

  return (
    <div className="max-w-4xl mx-auto p-4">
              <h1 className="text-2xl font-bold mb-6 text-content-primary dark:text-content-primary-dark">Search Spotify</h1>
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for a track, album, or artist"
                      className="flex-1 p-2 border bg-input-background dark:bg-input-background-dark border-input-border dark:border-input-border-dark rounded-md focus:outline-none focus:ring-2 focus:ring-input-focus"
        />
        <select
          value={searchType}
          onChange={(e) => setSearchType(e.target.value as "track" | "album" | "artist" | "playlist")}
                      className="p-2 border bg-input-background dark:bg-input-background-dark border-input-border dark:border-input-border-dark rounded-md focus:outline-none focus:ring-2 focus:ring-input-focus"
        >
          <option value="track">Track</option>
          <option value="album">Album</option>
          <option value="artist">Artist</option>
          <option value="playlist">Playlist</option>
        </select>
      </div>
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
  );
};
