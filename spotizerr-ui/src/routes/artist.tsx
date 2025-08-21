import { Link, useParams } from "@tanstack/react-router";
import { useEffect, useState, useContext, useRef, useCallback } from "react";
import { toast } from "sonner";
import apiClient from "../lib/api-client";
import type { AlbumType, ArtistType, TrackType } from "../types/spotify";
import { QueueContext, getStatus } from "../contexts/queue-context";
import { useSettings } from "../contexts/settings-context";
import { FaArrowLeft, FaBookmark, FaRegBookmark, FaDownload } from "react-icons/fa";
import { AlbumCard } from "../components/AlbumCard";

export const Artist = () => {
  const { artistId } = useParams({ from: "/artist/$artistId" });
  const [artist, setArtist] = useState<ArtistType | null>(null);
  const [albums, setAlbums] = useState<AlbumType[]>([]);
  const [topTracks, setTopTracks] = useState<TrackType[]>([]);
  const [isWatched, setIsWatched] = useState(false);
  const [artistStatus, setArtistStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const context = useContext(QueueContext);
  const { settings } = useSettings();

  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Pagination state
  const LIMIT = 20; // tune as you like
  const [offset, setOffset] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [hasMore, setHasMore] = useState<boolean>(true); // assume more until we learn otherwise

  if (!context) {
    throw new Error("useQueue must be used within a QueueProvider");
  }
  const { addItem, items } = context;

  // Track queue status mapping
  const trackStatuses = topTracks.reduce((acc, t) => {
    const qi = items.find(item => item.downloadType === "track" && item.spotifyId === t.id);
    acc[t.id] = qi ? getStatus(qi) : null;
    return acc;
  }, {} as Record<string, string | null>);

  const applyFilters = useCallback(
    (items: AlbumType[]) => {
      return items.filter((item) => (settings?.explicitFilter ? !item.explicit : true));
    },
    [settings?.explicitFilter]
  );

  // Helper to dedupe albums by id
  const dedupeAppendAlbums = (current: AlbumType[], incoming: AlbumType[]) => {
    const seen = new Set(current.map((a) => a.id));
    const filtered = incoming.filter((a) => !seen.has(a.id));
    return current.concat(filtered);
  };

  // Fetch artist info & first page of albums
  useEffect(() => {
    if (!artistId) return;

    let cancelled = false;

    const fetchInitial = async () => {
      setLoading(true);
      setError(null);
      setAlbums([]);
      setOffset(0);
      setHasMore(true);

      try {
        const resp = await apiClient.get(`/artist/info?id=${artistId}&limit=${LIMIT}&offset=0`);
        const data = resp.data;

        if (cancelled) return;

        if (data?.id && data?.name) {
          // set artist meta
          setArtist({
            id: data.id,
            name: data.name,
            images: data.images || [],
            external_urls: data.external_urls || { spotify: "" },
            followers: data.followers || { total: 0 },
            genres: data.genres || [],
            popularity: data.popularity || 0,
            type: data.type || "artist",
            uri: data.uri || "",
          });

          // top tracks (if provided)
          if (Array.isArray(data.top_tracks)) {
            setTopTracks(data.top_tracks);
          } else {
            setTopTracks([]);
          }

          // albums pagination info
          const items: AlbumType[] = (data?.albums?.items as AlbumType[]) || [];
          const total: number | undefined = data?.albums?.total;

          setAlbums(items);
          setOffset(items.length);
          if (typeof total === "number") {
            setHasMore(items.length < total);
          } else {
            // If server didn't return total, default behavior: stop when an empty page arrives.
            setHasMore(items.length > 0);
          }
        } else {
          setError("Could not load artist data.");
        }

        // fetch watch status
        try {
          const watchStatusResponse = await apiClient.get<{ is_watched: boolean }>(`/artist/watch/${artistId}/status`);
          if (!cancelled) setIsWatched(watchStatusResponse.data.is_watched);
        } catch (e) {
          // ignore watch status errors
          console.warn("Failed to load watch status", e);
        }
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          setError("Failed to load artist page");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchInitial();

    return () => {
      cancelled = true;
    };
  }, [artistId, LIMIT]);

  // Fetch more albums (next page)
  const fetchMoreAlbums = useCallback(async () => {
    if (!artistId || loadingMore || loading || !hasMore) return;
    setLoadingMore(true);

    try {
      const resp = await apiClient.get(`/artist/info?id=${artistId}&limit=${LIMIT}&offset=${offset}`);
      const data = resp.data;
      const items: AlbumType[] = (data?.albums?.items as AlbumType[]) || [];
      const total: number | undefined = data?.albums?.total;

      setAlbums((cur) => dedupeAppendAlbums(cur, items));
      setOffset((cur) => cur + items.length);

      if (typeof total === "number") {
        setHasMore((prev) => prev && offset + items.length < total);
      } else {
        // if server doesn't expose total, stop when we get fewer than LIMIT items
        setHasMore(items.length === LIMIT);
      }
    } catch (err) {
      console.error("Failed to load more albums", err);
      toast.error("Failed to load more albums");
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [artistId, offset, LIMIT, loadingMore, loading, hasMore]);

  // IntersectionObserver to trigger fetchMoreAlbums when sentinel is visible
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    if (!hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            fetchMoreAlbums();
          }
        });
      },
      {
        root: null,
        rootMargin: "400px", // start loading a bit before the sentinel enters viewport
        threshold: 0.1,
      }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchMoreAlbums, hasMore]);

  // --- existing handlers (unchanged) ---
  const handleDownloadTrack = (track: TrackType) => {
    if (!track.id) return;
    toast.info(`Adding ${track.name} to queue...`);
    addItem({ spotifyId: track.id, type: "track", name: track.name });
  };

  const handleDownloadAlbum = (album: AlbumType) => {
    toast.info(`Adding ${album.name} to queue...`);
    addItem({ spotifyId: album.id, type: "album", name: album.name });
  };

  const handleDownloadArtist = async () => {
    setArtistStatus("downloading");
    if (!artistId || !artist) return;

    try {
      toast.info(`Downloading ${artist.name} discography...`);

      // Call the artist download endpoint which returns album task IDs
      const response = await apiClient.get(`/artist/download/${artistId}`);

      if (response.data.queued_albums?.length > 0) {
        setArtistStatus("queued");
        toast.success(`${artist.name} discography queued successfully!`, {
          description: `${response.data.queued_albums.length} albums added to queue.`,
        });
      } else {
        setArtistStatus(null);
        toast.info("No new albums to download for this artist.");
      }
    } catch (error: any) {
      setArtistStatus("error");
      console.error("Artist download failed:", error);
      toast.error("Failed to download artist", {
        description: error.response?.data?.error || "An unexpected error occurred.",
      });
    }
  };

  const handleToggleWatch = async () => {
    if (!artistId || !artist) return;
    try {
      if (isWatched) {
        await apiClient.delete(`/artist/watch/${artistId}`);
        toast.success(`Removed ${artist.name} from watchlist.`);
      } else {
        await apiClient.put(`/artist/watch/${artistId}`);
        toast.success(`Added ${artist.name} to watchlist.`);
      }
      setIsWatched(!isWatched);
    } catch (err) {
      toast.error("Failed to update watchlist.");
      console.error(err);
    }
  };

  if (error) {
    return <div className="text-red-500">{error}</div>;
  }

  if (loading && !artist) {
    return <div>Loading...</div>;
  }

  if (!artist) {
    return <div>Artist data could not be fully loaded. Please try again later.</div>;
  }

  const artistAlbums = applyFilters(albums.filter((album) => album.album_type === "album"));
  const artistSingles = applyFilters(albums.filter((album) => album.album_type === "single"));
  const artistCompilations = applyFilters(albums.filter((album) => album.album_type === "compilation"));

  return (
    <div className="artist-page">
      <div className="mb-4 md:mb-6">
        <button
          onClick={() => window.history.back()}
          className="flex items-center gap-2 p-2 -ml-2 text-sm font-semibold text-content-secondary dark:text-content-secondary-dark hover:text-content-primary dark:hover:text-content-primary-dark hover:bg-surface-muted dark:hover:bg-surface-muted-dark rounded-lg transition-all"
        >
          <FaArrowLeft className="icon-secondary hover:icon-primary" />
          <span>Back to results</span>
        </button>
      </div>
      <div className="artist-header mb-8 text-center">
        {artist.images && artist.images.length > 0 && (
          <img
            src={artist.images[0]?.url}
            alt={artist.name}
            className="artist-image w-48 h-48 rounded-full mx-auto mb-4 shadow-lg"
          />
        )}
        <h1 className="text-5xl font-bold text-content-primary dark:text-content-primary-dark">{artist.name}</h1>
        <div className="flex gap-4 justify-center mt-4">
          <button
            onClick={handleDownloadArtist}
            disabled={artistStatus === "downloading" || artistStatus === "queued"}
            className="flex items-center gap-2 px-4 py-2 bg-button-success hover:bg-button-success-hover text-button-success-text rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title={
              artistStatus === "downloading"
                ? "Downloading..."
                : artistStatus === "queued"
                ? "Queued."
                : "Download All"
            }
          >
            {artistStatus
              ? artistStatus === "queued"
                ? "Queued."
                : artistStatus === "downloading"
                ? "Downloading..."
                : <>
                    <FaDownload className="icon-inverse" />
                    <span>Download All</span>
                  </>
              : <>
                  <FaDownload className="icon-inverse" />
                  <span>Download All</span>
                </>
            }
          </button>
          {settings?.watch?.enabled && (
            <button
              onClick={handleToggleWatch}
              className={`flex items-center gap-2 px-4 py-2 rounded-md transition-colors border ${isWatched
                  ? "bg-button-primary text-button-primary-text border-primary"
                  : "bg-surface dark:bg-surface-dark hover:bg-surface-muted dark:hover:bg-surface-muted-dark border-border dark:border-border-dark text-content-primary dark:text-content-primary-dark"
                }`}
            >
              {isWatched ? (
                <>
                  <FaBookmark className="icon-inverse" />
                  <span>Watching</span>
                </>
              ) : (
                <>
                  <FaRegBookmark className="icon-primary" />
                  <span>Watch</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {topTracks.length > 0 && (
        <div className="mb-12">
          <h2 className="text-3xl font-bold mb-6 text-content-primary dark:text-content-primary-dark">Top Tracks</h2>
          <div className="track-list space-y-2">
            {topTracks.map((track) => (
              <div
                key={track.id}
                className="track-item flex items-center justify-between p-2 rounded-md hover:bg-surface-muted dark:hover:bg-surface-muted-dark transition-colors"
              >
                <Link
                  to="/track/$trackId"
                  params={{ trackId: track.id }}
                  className="font-semibold text-content-primary dark:text-content-primary-dark"
                >
                  {track.name}
                </Link>
                <button
                  onClick={() => handleDownloadTrack(track)}
                  disabled={!!trackStatuses[track.id] && trackStatuses[track.id] !== "error"}
                  className="px-3 py-1 bg-button-secondary hover:bg-button-secondary-hover text-button-secondary-text hover:text-button-secondary-text-hover rounded disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {trackStatuses[track.id]
                    ? trackStatuses[track.id] === "queued"
                      ? "Queued."
                      : trackStatuses[track.id] === "error"
                      ? "Download"
                      : "Downloading..."
                    : "Download"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Albums */}
      {artistAlbums.length > 0 && (
        <div className="mb-12">
          <h2 className="text-3xl font-bold mb-6 text-content-primary dark:text-content-primary-dark">Albums</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            {artistAlbums.map((album) => (
              <AlbumCard key={album.id} album={album} onDownload={() => handleDownloadAlbum(album)} />
            ))}
          </div>
        </div>
      )}

      {/* Singles */}
      {artistSingles.length > 0 && (
        <div className="mb-12">
          <h2 className="text-3xl font-bold mb-6 text-content-primary dark:text-content-primary-dark">Singles</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            {artistSingles.map((album) => (
              <AlbumCard key={album.id} album={album} onDownload={() => handleDownloadAlbum(album)} />
            ))}
          </div>
        </div>
      )}

      {/* Compilations */}
      {artistCompilations.length > 0 && (
        <div className="mb-12">
          <h2 className="text-3xl font-bold mb-6 text-content-primary dark:text-content-primary-dark">Compilations</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            {artistCompilations.map((album) => (
              <AlbumCard key={album.id} album={album} onDownload={() => handleDownloadAlbum(album)} />
            ))}
          </div>
        </div>
      )}

      {/* sentinel + loading */}
      <div className="flex flex-col items-center gap-2">
        {loadingMore && <div className="py-4">Loading more...</div>}
        {!hasMore && !loading && <div className="py-4 text-sm text-content-secondary">End of discography</div>}
        {/* fallback load more button for browsers that block IntersectionObserver or for manual control */}
        {hasMore && !loadingMore && (
          <button
            onClick={() => fetchMoreAlbums()}
            className="px-4 py-2 mb-6 rounded bg-surface-muted hover:bg-surface-muted-dark"
          >
            Load more
          </button>
        )}
        <div ref={sentinelRef} style={{ height: 1, width: "100%" }} />
      </div>
    </div>
  );
};
