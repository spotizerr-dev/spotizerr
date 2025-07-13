import { Link, useParams } from "@tanstack/react-router";
import { useEffect, useState, useContext } from "react";
import apiClient from "../lib/api-client";
import { useSettings } from "../contexts/settings-context";
import { toast } from "sonner";
import type { PlaylistType, TrackType } from "../types/spotify";
import { QueueContext } from "../contexts/queue-context";
import { FaArrowLeft } from "react-icons/fa";
import { FaDownload } from "react-icons/fa6";

export const Playlist = () => {
  const { playlistId } = useParams({ from: "/playlist/$playlistId" });
  const [playlist, setPlaylist] = useState<PlaylistType | null>(null);
  const [isWatched, setIsWatched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const context = useContext(QueueContext);
  const { settings } = useSettings();

  if (!context) {
    throw new Error("useQueue must be used within a QueueProvider");
  }
  const { addItem } = context;

  useEffect(() => {
    const fetchPlaylist = async () => {
      if (!playlistId) return;
      try {
        const response = await apiClient.get<PlaylistType>(`/playlist/info?id=${playlistId}`);
        setPlaylist(response.data);
      } catch (err) {
        setError("Failed to load playlist");
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

    fetchPlaylist();
    checkWatchStatus();
  }, [playlistId]);

  const handleDownloadTrack = (track: TrackType) => {
    if (!track?.id) return;
    addItem({ spotifyId: track.id, type: "track", name: track.name });
    toast.info(`Adding ${track.name} to queue...`);
  };

  const handleDownloadPlaylist = () => {
    if (!playlist) return;
    addItem({
      spotifyId: playlist.id,
      type: "playlist",
      name: playlist.name,
    });
    toast.info(`Adding ${playlist.name} to queue...`);
  };

  const handleToggleWatch = async () => {
    if (!playlistId) return;
    try {
      if (isWatched) {
        await apiClient.delete(`/playlist/watch/${playlistId}`);
        toast.success(`Removed ${playlist?.name} from watchlist.`);
      } else {
        await apiClient.put(`/playlist/watch/${playlistId}`);
        toast.success(`Added ${playlist?.name} to watchlist.`);
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

  if (!playlist) {
    return <div className="p-8 text-center">Loading...</div>;
  }

  const filteredTracks = playlist.tracks.items.filter(({ track }) => {
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
      <div className="flex flex-col md:flex-row items-start gap-6">
        <img
          src={playlist.images[0]?.url || "/placeholder.jpg"}
          alt={playlist.name}
          className="w-48 h-48 object-cover rounded-lg shadow-lg"
        />
        <div className="flex-grow space-y-2">
          <h1 className="text-3xl font-bold">{playlist.name}</h1>
          {playlist.description && <p className="text-gray-500 dark:text-gray-400">{playlist.description}</p>}
          <div className="text-sm text-gray-400 dark:text-gray-500">
            <p>
              By {playlist.owner.display_name} • {playlist.followers.total.toLocaleString()} followers •{" "}
              {playlist.tracks.total} songs
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

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Tracks</h2>
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
        </div>
      </div>
    </div>
  );
};
