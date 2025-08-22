import { Link, useParams } from "@tanstack/react-router";
import { useEffect, useState, useContext, useRef, useCallback } from "react";
import apiClient from "../lib/api-client";
import { QueueContext, getStatus } from "../contexts/queue-context";
import { useSettings } from "../contexts/settings-context";
import type { AlbumType, TrackType } from "../types/spotify";
import { toast } from "sonner";
import { FaArrowLeft } from "react-icons/fa";

export const Album = () => {
  const { albumId } = useParams({ from: "/album/$albumId" });
  const [album, setAlbum] = useState<AlbumType | null>(null);
  const [tracks, setTracks] = useState<TrackType[]>([]);
  const [offset, setOffset] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const context = useContext(QueueContext);
  const { settings } = useSettings();
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const PAGE_SIZE = 50;

  if (!context) {
    throw new Error("useQueue must be used within a QueueProvider");
  }
  const { addItem, items } = context;

  // Queue status for this album
  const albumQueueItem = items.find(item => item.downloadType === "album" && item.spotifyId === album?.id);
  const albumStatus = albumQueueItem ? getStatus(albumQueueItem) : null;

  useEffect(() => {
    if (albumStatus === "queued") {
      toast.success(`${album?.name} queued.`);
    } else if (albumStatus === "error") {
      toast.error(`Failed to queue ${album?.name}`);
    }
  }, [albumStatus]);

  const totalTracks = album?.total_tracks ?? 0;
  const hasMore = tracks.length < totalTracks;

  // Initial load
  useEffect(() => {
    const fetchAlbum = async () => {
      if (!albumId) return;
      setIsLoading(true);
      setError(null);
      try {
        const response = await apiClient.get(`/album/info?id=${albumId}&limit=${PAGE_SIZE}&offset=0`);
        const data: AlbumType & { tracks: { items: TrackType[]; total?: number; limit?: number; offset?: number } } = response.data;
        setAlbum(data);
        setTracks(data.tracks.items || []);
        setOffset((data.tracks.items || []).length);
      } catch (err) {
        setError("Failed to load album");
        console.error("Error fetching album:", err);
      } finally {
        setIsLoading(false);
      }
    };

    // reset state when albumId changes
    setAlbum(null);
    setTracks([]);
    setOffset(0);
    if (albumId) {
      fetchAlbum();
    }
  }, [albumId]);

  const loadMore = useCallback(async () => {
    if (!albumId || isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    try {
      const response = await apiClient.get(`/album/info?id=${albumId}&limit=${PAGE_SIZE}&offset=${offset}`);
      const data: AlbumType & { tracks: { items: TrackType[]; total?: number; limit?: number; offset?: number } } = response.data;
      const newItems = data.tracks.items || [];
      setTracks((prev) => [...prev, ...newItems]);
      setOffset((prev) => prev + newItems.length);
    } catch (err) {
      console.error("Error fetching more tracks:", err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [albumId, offset, isLoadingMore, hasMore]);

  // IntersectionObserver to trigger loadMore
  useEffect(() => {
    if (!loadMoreRef.current) return;
    const sentinel = loadMoreRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (first.isIntersecting) {
          loadMore();
        }
      },
      { root: null, rootMargin: "200px", threshold: 0.1 }
    );

    observer.observe(sentinel);
    return () => {
      observer.unobserve(sentinel);
      observer.disconnect();
    };
  }, [loadMore]);

  const handleDownloadTrack = (track: TrackType) => {
    if (!track.id) return;
    toast.info(`Adding ${track.name} to queue...`);
    addItem({ spotifyId: track.id, type: "track", name: track.name });
  };

  const handleDownloadAlbum = () => {
    if (!album) return;
    toast.info(`Adding ${album.name} to queue...`);
    addItem({ spotifyId: album.id, type: "album", name: album.name });
  };

  if (error) {
    return <div className="text-red-500">{error}</div>;
  }

  if (!album || isLoading) {
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

  const hasExplicitTrack = tracks.some((track) => track.explicit);

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Back Button */}
      <div className="mb-4 md:mb-6">
        <button
          onClick={() => window.history.back()}
          className="flex items-center gap-2 p-2 -ml-2 text-sm font-semibold text-content-secondary dark:text-content-secondary-dark hover:text-content-primary dark:hover:text-content-primary-dark hover:bg-surface-muted dark:hover:bg-surface-muted-dark rounded-lg transition-all"
        >
          <FaArrowLeft className="icon-secondary hover:icon-primary" />
          <span>Back to results</span>
        </button>
      </div>

      {/* Album Header - Mobile Optimized */}
      <div className="bg-surface dark:bg-surface-dark border border-border dark:border-border-dark rounded-xl p-4 md:p-6 shadow-sm">
        <div className="flex flex-col items-center gap-4 md:gap-6">
          <img
            src={album.images[0]?.url || "/placeholder.jpg"}
            alt={album.name}
            className="w-32 h-32 sm:w-40 sm:h-40 md:w-48 md:h-48 object-cover rounded-lg shadow-lg mx-auto"
          />
          <div className="flex-grow space-y-2 text-center">
            <h1 className="text-2xl md:text-3xl font-bold text-content-primary dark:text-content-primary-dark leading-tight">{album.name}</h1>
            <p className="text-base md:text-lg text-content-secondary dark:text-content-secondary-dark">
              By{" "}
              {album.artists.map((artist, index) => (
                <span key={artist.id}>
                  <Link to="/artist/$artistId" params={{ artistId: artist.id }} className="hover:underline font-medium">
                    {artist.name}
                  </Link>
                  {index < album.artists.length - 1 && ", "}
                </span>
              ))}
            </p>
            <p className="text-sm text-content-muted dark:text-content-muted-dark">
              {new Date(album.release_date).getFullYear()} • {album.total_tracks} songs
            </p>
            <p className="text-xs text-content-muted dark:text-content-muted-dark">{album.label}</p>
          </div>
        </div>
        
        {/* Download Button - Full Width on Mobile */}
        <div className="mt-4 md:mt-6">
          <button
            onClick={handleDownloadAlbum}
            disabled={(isExplicitFilterEnabled && hasExplicitTrack) || (!!albumQueueItem && albumStatus !== "error")}
            className="w-full px-6 py-3 bg-button-primary hover:bg-button-primary-hover text-button-primary-text rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed font-semibold shadow-sm"
            title={
              isExplicitFilterEnabled && hasExplicitTrack
                ? "Album contains explicit tracks"
                : albumStatus
                ? albumStatus === "queued"
                  ? "Album queued"
                  : albumStatus === "error"
                  ? "Download Full Album"
                  : "Downloading..."
                : "Download Full Album"
            }
          >
            {albumStatus
              ? albumStatus === "queued"
                ? "Queued."
                : albumStatus === "error"
                ? "Download Album"
                : "Downloading..."
              : "Download Album"}
          </button>
        </div>
      </div>

      {/* Tracks Section */}
      <div className="space-y-3 md:space-y-4">
        <h2 className="text-xl font-semibold text-content-primary dark:text-content-primary-dark px-1">Tracks</h2>
        <div className="bg-surface-muted dark:bg-surface-muted-dark rounded-xl p-2 md:p-4 shadow-sm">
          <div className="space-y-1 md:space-y-2">
            {tracks.map((track, index) => {
              if (isExplicitFilterEnabled && track.explicit) {
                return (
                  <div
                    key={`${track.id || "explicit"}-${index}`}
                    className="flex items-center justify-between p-3 md:p-4 bg-surface-muted dark:bg-surface-muted-dark rounded-lg opacity-50"
                  >
                    <div className="flex items-center gap-3 md:gap-4 min-w-0 flex-1">
                      <span className="text-content-muted dark:text-content-muted-dark w-6 md:w-8 text-right text-sm font-medium">{index + 1}</span>
                      <p className="font-medium text-content-muted dark:text-content-muted-dark text-sm md:text-base truncate">Explicit track filtered</p>
                    </div>
                    <span className="text-content-muted dark:text-content-muted-dark text-sm shrink-0">--:--</span>
                  </div>
                );
              }
              return (
                <div
                  key={track.id || `${index}`}
                  className="flex items-center justify-between p-3 md:p-4 hover:bg-surface-secondary dark:hover:bg-surface-secondary-dark rounded-lg transition-colors duration-200 group"
                >
                  <div className="flex items-center gap-3 md:gap-4 min-w-0 flex-1">
                    <span className="text-content-muted dark:text-content-muted-dark w-6 md:w-8 text-right text-sm font-medium">{index + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-content-primary dark:text-content-primary-dark text-sm md:text-base truncate">{track.name}</p>
                      <p className="text-xs md:text-sm text-content-secondary dark:text-content-secondary-dark truncate">
                        {track.artists.map((artist, index) => (
                          <span key={artist.id}>
                            <Link
                              to="/artist/$artistId"
                              params={{
                                artistId: artist.id,
                              }}
                              className="hover:underline"
                            >
                              {artist.name}
                            </Link>
                            {index < track.artists.length - 1 && ", "}
                          </span>
                        ))}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 md:gap-4 shrink-0">
                    <span className="text-content-muted dark:text-content-muted-dark text-xs md:text-sm hidden sm:block">
                      {Math.floor(track.duration_ms / 60000)}:
                      {((track.duration_ms % 60000) / 1000).toFixed(0).padStart(2, "0")}
                    </span>
                    <button
                      onClick={() => handleDownloadTrack(track)}
                      className="w-9 h-9 md:w-10 md:h-10 flex items-center justify-center bg-surface-muted dark:bg-surface-muted-dark hover:bg-surface-accent dark:hover:bg-surface-accent-dark border border-border-muted dark:border-border-muted-dark hover:border-border-accent dark:hover:border-border-accent-dark rounded-full transition-all hover:scale-105 hover:shadow-sm"
                      title="Download"
                    >
                      <img src="/download.svg" alt="Download" className="w-4 h-4 logo" />
                    </button>
                  </div>
                </div>
              );
            })}
            <div ref={loadMoreRef} />
            {isLoadingMore && (
              <div className="p-3 text-center text-content-muted dark:text-content-muted-dark text-sm">Loading more...</div>
            )}
            {!hasMore && tracks.length > 0 && (
              <div className="p-3 text-center text-content-muted dark:text-content-muted-dark text-sm">End of album</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
