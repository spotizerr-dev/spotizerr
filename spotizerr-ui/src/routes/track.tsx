import { useParams } from "@tanstack/react-router";
import { useEffect, useState, useContext } from "react";
import apiClient from "../lib/api-client";
import type { TrackType } from "../types/spotify";
import { toast } from "sonner";
import { QueueContext } from "../contexts/queue-context";

export const Track = () => {
  const { trackId } = useParams({ from: "/track/$trackId" });
  const [track, setTrack] = useState<TrackType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const context = useContext(QueueContext);

  if (!context) {
    throw new Error("useQueue must be used within a QueueProvider");
  }
  const { addItem } = context;

  useEffect(() => {
    const fetchTrack = async () => {
      if (!trackId) return;
      try {
        const response = await apiClient.get<TrackType>(`/track/info?id=${trackId}`);
        setTrack(response.data);
      } catch (err) {
        setError("Failed to load track");
        console.error(err);
      }
    };
    fetchTrack();
  }, [trackId]);

  const handleDownloadTrack = () => {
    if (!track) return;
    addItem({ spotifyId: track.id, type: "track", name: track.name });
    toast.info(`Adding ${track.name} to queue...`);
  };

  if (error) {
    return <div className="text-red-500">{error}</div>;
  }

  if (!track) {
    return <div>Loading...</div>;
  }

  return (
    <div className="track-page">
      <h1>{track.name}</h1>
      <p>by {track.artists.map((artist) => artist.name).join(", ")}</p>
      <button onClick={handleDownloadTrack}>Download</button>
    </div>
  );
};
