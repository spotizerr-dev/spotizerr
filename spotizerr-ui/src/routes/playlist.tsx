import { Link, useParams } from "@tanstack/react-router";
import { useEffect, useState, useContext } from "react";
import apiClient from "../lib/api-client";
import { useSettings } from "../contexts/settings-context";
import { toast } from "sonner";
import type { ImageType, TrackType } from "../types/spotify";
import { QueueContext } from "../contexts/queue-context";

interface PlaylistItemType {
  track: TrackType | null;
}

interface PlaylistType {
  id: string;
  name: string;
  description: string | null;
  images: ImageType[];
  tracks: {
    items: PlaylistItemType[];
  };
}

export const Playlist = () => {
  const { playlistId } = useParams({ from: "/playlist/$playlistId" });
  const [playlist, setPlaylist] = useState<PlaylistType | null>(null);
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
    fetchPlaylist();
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

  if (error) {
    return <div className="text-red-500">{error}</div>;
  }

  if (!playlist) {
    return <div>Loading...</div>;
  }

  const filteredTracks = playlist.tracks.items.filter(({ track }) => {
    if (!track) return false;
    if (settings?.explicitFilter && track.explicit) return false;
    return true;
  });

  return (
    <div className="playlist-page">
      <div className="playlist-header">
        <img src={playlist.images[0]?.url} alt={playlist.name} className="playlist-image" />
        <div>
          <h1>{playlist.name}</h1>
          <p>{playlist.description}</p>
          <button onClick={handleDownloadPlaylist} className="download-playlist-btn">
            Download All
          </button>
        </div>
      </div>
      <div className="track-list">
        {filteredTracks.map(({ track }) => {
          if (!track) return null;
          return (
            <div key={track.id} className="track-item">
              <Link to="/track/$trackId" params={{ trackId: track.id }}>
                {track.name}
              </Link>
              <button onClick={() => handleDownloadTrack(track)}>Download</button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
