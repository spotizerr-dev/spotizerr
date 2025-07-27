import { Link, useParams } from "@tanstack/react-router";
import { useEffect, useState, useContext, useRef, useCallback } from "react";
import apiClient from "../lib/api-client";
import { useSettings } from "../contexts/settings-context";
import { toast } from "sonner";
import type { PlaylistType, TrackType, PlaylistMetadataType, PlaylistTracksResponseType, PlaylistItemType } from "../types/spotify";
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
    <div className="space-y-6">
      <div className="mb-6">
        <button
          onClick={() => window.history.back()}
          className="flex items-center gap-2 text-sm font-semibold text-gray-600 hover:text-gray-900 transition-colors"
        >
          <FaArrowLeft />
          <span>Back to results</span>
        </button>
      </div>
      
      {/* Playlist Header */}
      <div className="flex flex-col md:flex-row items-start gap-6">
        <img
          src={playlistMetadata.images[0]?.url || "/placeholder.jpg"}
          alt={playlistMetadata.name}
          className="w-48 h-48 object-cover rounded-lg shadow-lg"
        />
        <div className="flex-grow space-y-2">
          <h1 className="text-3xl font-bold">{playlistMetadata.name}</h1>
          {playlistMetadata.description && (
            <p className="text-gray-500 dark:text-gray-400">{playlistMetadata.description}</p>
          )}
          <div className="text-sm text-gray-400 dark:text-gray-500">
            <p>
              By {playlistMetadata.owner.display_name} • {playlistMetadata.followers.total.toLocaleString()} followers •{" "}
              {totalTracks} songs
            </p>
          </div>
          <div className="flex gap-2 pt-2">
            <button
              onClick={handleDownloadPlaylist}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Download All
            </button>
            <button
              onClick={handleToggleWatch}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                isWatched
                  ? "bg-red-600 text-white hover:bg-red-700"
                  : "bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600"
              }`}
            >
              <img
                src={isWatched ? "/eye-crossed.svg" : "/eye.svg"}
                alt="Watch status"
                className="w-5 h-5"
                style={{ filter: !isWatched ? "invert(1)" : undefined }}
              />
              {isWatched ? "Unwatch" : "Watch"}
            </button>
          </div>
        </div>
      </div>

      {/* Tracks Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Tracks</h2>
          {tracks.length > 0 && (
            <span className="text-sm text-gray-500">
              Showing {tracks.length} of {totalTracks} tracks
            </span>
          )}
        </div>
        
        <div className="space-y-2">
          {filteredTracks.map(({ track }, index) => {
            if (!track) return null;
            return (
              <div
                key={track.id}
                className="flex items-center justify-between p-3 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                <div className="flex items-center gap-4">
                  <span className="text-gray-500 dark:text-gray-400 w-8 text-right">{index + 1}</span>
                  <img
                    src={track.album.images.at(-1)?.url}
                    alt={track.album.name}
                    className="w-10 h-10 object-cover rounded"
                  />
                  <div>
                    <Link to="/track/$trackId" params={{ trackId: track.id }} className="font-medium hover:underline">
                      {track.name}
                    </Link>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {track.artists.map((artist, index) => (
                        <span key={artist.id}>
                          <Link to="/artist/$artistId" params={{ artistId: artist.id }} className="hover:underline">
                            {artist.name}
                          </Link>
                          {index < track.artists.length - 1 && ", "}
                        </span>
                      ))}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-gray-500 dark:text-gray-400">
                    {Math.floor(track.duration_ms / 60000)}:
                    {((track.duration_ms % 60000) / 1000).toFixed(0).padStart(2, "0")}
                  </span>
                  <button
                    onClick={() => handleDownloadTrack(track)}
                    className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full"
                    title="Download"
                  >
                    <FaDownload />
                  </button>
                </div>
              </div>
            );
          })}
          
          {/* Loading indicator */}
          {loadingTracks && (
            <div className="flex justify-center py-4">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          )}
          
          {/* Intersection observer target */}
          {hasMoreTracks && (
            <div ref={loadingRef} className="h-4" />
          )}
          
          {/* End of tracks indicator */}
          {!hasMoreTracks && tracks.length > 0 && (
            <div className="text-center py-4 text-gray-500">
              All tracks loaded
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
