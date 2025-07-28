import { Link, useParams } from "@tanstack/react-router";
import { useEffect, useState, useContext, useRef, useCallback } from "react";
import apiClient from "../lib/api-client";
import { useSettings } from "../contexts/settings-context";
import { toast } from "sonner";
import type { TrackType, PlaylistMetadataType, PlaylistTracksResponseType, PlaylistItemType } from "../types/spotify";
import { QueueContext } from "../contexts/queue-context";
import { FaArrowLeft } from "react-icons/fa";
import { FaDownload } from "react-icons/fa6";



export const Playlist = () => {
  const { playlistId } = useParams({ from: "/playlist/$playlistId" });
  const [playlistMetadata, setPlaylistMetadata] = useState<PlaylistMetadataType | null>(null);
  const [tracks, setTracks] = useState<PlaylistItemType[]>([]);
  const [isWatched, setIsWatched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingTracks, setLoadingTracks] = useState(false);
  const [hasMoreTracks, setHasMoreTracks] = useState(true);
  const [tracksOffset, setTracksOffset] = useState(0);
  const [totalTracks, setTotalTracks] = useState(0);
  
  const context = useContext(QueueContext);
  const { settings } = useSettings();
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadingRef = useRef<HTMLDivElement>(null);

  if (!context) {
    throw new Error("useQueue must be used within a QueueProvider");
  }
  const { addItem } = context;

  // Load playlist metadata first
  useEffect(() => {
    const fetchPlaylistMetadata = async () => {
      if (!playlistId) return;
      try {
        const response = await apiClient.get<PlaylistMetadataType>(`/playlist/metadata?id=${playlistId}`);
        setPlaylistMetadata(response.data);
        setTotalTracks(response.data.tracks.total);
      } catch (err) {
        setError("Failed to load playlist metadata");
        console.error(err);
      }
    };

    const checkWatchStatus = async () => {
      if (!playlistId) return;
      try {
        const response = await apiClient.get(`/playlist/watch/${playlistId}/status`);
        if (response.data.is_watched) {
          setIsWatched(true);
        }
      } catch {
        console.log("Could not get watch status");
      }
    };

    fetchPlaylistMetadata();
    checkWatchStatus();
  }, [playlistId]);

  // Load tracks progressively
  const loadMoreTracks = useCallback(async () => {
    if (!playlistId || loadingTracks || !hasMoreTracks) return;

    setLoadingTracks(true);
    try {
      const limit = 50; // Load 50 tracks at a time
             const response = await apiClient.get<PlaylistTracksResponseType>(
         `/playlist/tracks?id=${playlistId}&limit=${limit}&offset=${tracksOffset}`
       );

      const newTracks = response.data.items;
      setTracks(prev => [...prev, ...newTracks]);
      setTracksOffset(prev => prev + newTracks.length);
      
      // Check if we've loaded all tracks
      if (tracksOffset + newTracks.length >= totalTracks) {
        setHasMoreTracks(false);
      }
    } catch (err) {
      console.error("Failed to load tracks:", err);
      toast.error("Failed to load more tracks");
    } finally {
      setLoadingTracks(false);
    }
  }, [playlistId, loadingTracks, hasMoreTracks, tracksOffset, totalTracks]);

  // Intersection Observer for infinite scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMoreTracks && !loadingTracks) {
          loadMoreTracks();
        }
      },
      { threshold: 0.1 }
    );

    if (loadingRef.current) {
      observer.observe(loadingRef.current);
    }

    observerRef.current = observer;

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [loadMoreTracks, hasMoreTracks, loadingTracks]);

  // Load initial tracks when metadata is loaded
  useEffect(() => {
    if (playlistMetadata && tracks.length === 0 && totalTracks > 0) {
      loadMoreTracks();
    }
  }, [playlistMetadata, tracks.length, totalTracks, loadMoreTracks]);

  // Reset state when playlist ID changes
  useEffect(() => {
    setTracks([]);
    setTracksOffset(0);
    setHasMoreTracks(true);
    setTotalTracks(0);
  }, [playlistId]);

  const handleDownloadTrack = (track: TrackType) => {
    if (!track?.id) return;
    addItem({ spotifyId: track.id, type: "track", name: track.name });
    toast.info(`Adding ${track.name} to queue...`);
  };

  const handleDownloadPlaylist = () => {
    if (!playlistMetadata) return;
    addItem({
      spotifyId: playlistMetadata.id,
      type: "playlist",
      name: playlistMetadata.name,
    });
    toast.info(`Adding ${playlistMetadata.name} to queue...`);
  };

  const handleToggleWatch = async () => {
    if (!playlistId) return;
    try {
      if (isWatched) {
        await apiClient.delete(`/playlist/watch/${playlistId}`);
        toast.success(`Removed ${playlistMetadata?.name} from watchlist.`);
      } else {
        await apiClient.put(`/playlist/watch/${playlistId}`);
        toast.success(`Added ${playlistMetadata?.name} to watchlist.`);
      }
      setIsWatched(!isWatched);
    } catch (err) {
      toast.error("Failed to update watchlist.");
      console.error(err);
    }
  };

  if (error) {
    return <div className="text-red-500 p-8 text-center">{error}</div>;
  }

  if (!playlistMetadata) {
    return <div className="p-8 text-center">Loading playlist...</div>;
  }

  const filteredTracks = tracks.filter(({ track }) => {
    if (!track) return false;
    if (settings?.explicitFilter && track.explicit) return false;
    return true;
  });

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
      
      {/* Playlist Header - Mobile Optimized */}
      <div className="bg-surface dark:bg-surface-dark border border-border dark:border-border-dark rounded-xl p-4 md:p-6 shadow-sm">
        <div className="flex flex-col items-center gap-4 md:gap-6">
          <img
            src={playlistMetadata.images[0]?.url || "/placeholder.jpg"}
            alt={playlistMetadata.name}
            className="w-32 h-32 sm:w-40 sm:h-40 md:w-48 md:h-48 object-cover rounded-lg shadow-lg mx-auto"
          />
          <div className="flex-grow space-y-2 text-center">
            <h1 className="text-2xl md:text-3xl font-bold text-content-primary dark:text-content-primary-dark leading-tight">{playlistMetadata.name}</h1>
            {playlistMetadata.description && (
              <p className="text-base md:text-lg text-content-secondary dark:text-content-secondary-dark">{playlistMetadata.description}</p>
            )}
            <p className="text-sm text-content-muted dark:text-content-muted-dark">
              By {playlistMetadata.owner.display_name} • {playlistMetadata.followers.total.toLocaleString()} followers • {totalTracks} songs
            </p>
          </div>
        </div>
        
        {/* Action Buttons - Full Width on Mobile */}
        <div className="mt-4 md:mt-6 flex flex-col sm:flex-row gap-2 sm:gap-3">
          <button
            onClick={handleDownloadPlaylist}
            className="flex-1 px-6 py-3 bg-button-primary hover:bg-button-primary-hover text-button-primary-text rounded-lg transition-all font-semibold shadow-sm"
          >
            Download All
          </button>
          <button
            onClick={handleToggleWatch}
            className={`flex items-center justify-center gap-2 px-6 py-3 rounded-lg transition-all font-semibold shadow-sm ${
              isWatched
                ? "bg-error hover:bg-error-hover text-button-primary-text"
                : "bg-surface-muted dark:bg-surface-muted-dark hover:bg-surface-accent dark:hover:bg-surface-accent-dark text-content-primary dark:text-content-primary-dark"
            }`}
          >
            <img
              src={isWatched ? "/eye-crossed.svg" : "/eye.svg"}
              alt="Watch status"
              className={`w-5 h-5 ${isWatched ? "icon-inverse" : "logo"}`}
            />
            {isWatched ? "Unwatch" : "Watch"}
          </button>
        </div>
      </div>

      {/* Tracks Section */}
      <div className="space-y-3 md:space-y-4">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-xl font-semibold text-content-primary dark:text-content-primary-dark">Tracks</h2>
          {tracks.length > 0 && (
            <span className="text-sm text-content-muted dark:text-content-muted-dark">
              Showing {tracks.length} of {totalTracks} tracks
            </span>
          )}
        </div>
        
        <div className="bg-surface-muted dark:bg-surface-muted-dark rounded-xl p-2 md:p-4 shadow-sm">
          <div className="space-y-1 md:space-y-2">
            {filteredTracks.map(({ track }, index) => {
              if (!track) return null;
              return (
                <div
                  key={track.id}
                  className="flex items-center justify-between p-3 md:p-4 hover:bg-surface-secondary dark:hover:bg-surface-secondary-dark rounded-lg transition-colors duration-200 group"
                >
                  <div className="flex items-center gap-3 md:gap-4 min-w-0 flex-1">
                    <span className="text-content-muted dark:text-content-muted-dark w-6 md:w-8 text-right text-sm font-medium">{index + 1}</span>
                    <Link to="/album/$albumId" params={{ albumId: track.album.id }}>
                      <img
                        src={track.album.images.at(-1)?.url}
                        alt={track.album.name}
                        className="w-10 h-10 md:w-12 md:h-12 object-cover rounded hover:scale-105 transition-transform duration-300"
                      />
                    </Link>
                    <div className="min-w-0 flex-1">
                      <Link to="/track/$trackId" params={{ trackId: track.id }} className="font-medium text-content-primary dark:text-content-primary-dark text-sm md:text-base hover:underline block truncate">
                        {track.name}
                      </Link>
                      <p className="text-xs md:text-sm text-content-secondary dark:text-content-secondary-dark truncate">
                        {track.artists.map((artist, index) => (
                          <span key={artist.id}>
                            <Link
                              to="/artist/$artistId"
                              params={{ artistId: artist.id }}
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
            
            {/* Loading indicator */}
            {loadingTracks && (
              <div className="flex justify-center py-4">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            )}
            
            {/* Intersection observer target */}
            {hasMoreTracks && (
              <div ref={loadingRef} className="h-4" />
            )}
            
            {/* End of tracks indicator */}
            {!hasMoreTracks && tracks.length > 0 && (
              <div className="text-center py-4 text-content-muted dark:text-content-muted-dark">
                All tracks loaded
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
