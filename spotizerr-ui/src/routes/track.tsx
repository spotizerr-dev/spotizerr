import { Link, useParams } from "@tanstack/react-router";
import { useEffect, useState, useContext } from "react";
import apiClient from "../lib/api-client";
import type { TrackType } from "../types/spotify";
import { toast } from "sonner";
import { QueueContext } from "../contexts/queue-context";
import { FaSpotify, FaArrowLeft } from "react-icons/fa";

// Helper to format milliseconds to mm:ss
const formatDuration = (ms: number) => {
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}:${seconds.padStart(2, "0")}`;
};

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
    return (
      <div className="flex justify-center items-center h-full">
        <p className="text-red-500 text-lg">{error}</p>
      </div>
    );
  }

  if (!track) {
    return (
      <div className="flex justify-center items-center h-full">
        <p className="text-lg">Loading...</p>
      </div>
    );
  }

  const imageUrl = track.album.images?.[0]?.url;

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-8">
      <div className="mb-6">
        <button
          onClick={() => window.history.back()}
          className="flex items-center gap-2 text-sm font-semibold text-gray-600 hover:text-gray-900 transition-colors"
        >
          <FaArrowLeft />
          <span>Back to results</span>
        </button>
      </div>
      <div className="bg-white shadow-lg rounded-lg overflow-hidden md:flex">
        {imageUrl && (
          <div className="md:w-1/3">
            <img src={imageUrl} alt={track.album.name} className="w-full h-auto object-cover" />
          </div>
        )}
        <div className="p-6 md:w-2/3 flex flex-col justify-between">
          <div>
            <div className="flex items-baseline justify-between">
              <h1 className="text-3xl font-bold text-gray-900">{track.name}</h1>
              {track.explicit && (
                <span className="text-xs bg-gray-700 text-white px-2 py-1 rounded-full">EXPLICIT</span>
              )}
            </div>
            <div className="text-lg text-gray-600 mt-1">
              {track.artists.map((artist, index) => (
                <span key={artist.id}>
                  <Link to="/artist/$artistId" params={{ artistId: artist.id }}>
                    {artist.name}
                  </Link>
                  {index < track.artists.length - 1 && ", "}
                </span>
              ))}
            </div>
            <p className="text-md text-gray-500 mt-4">
              From the album{" "}
              <Link to="/album/$albumId" params={{ albumId: track.album.id }} className="font-semibold">
                {track.album.name}
              </Link>
            </p>
            <div className="mt-4 text-sm text-gray-600">
              <p>Release Date: {track.album.release_date}</p>
              <p>Duration: {formatDuration(track.duration_ms)}</p>
            </div>
            <div className="mt-4">
              <p className="text-sm text-gray-600">Popularity:</p>
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div className="bg-green-500 h-2.5 rounded-full" style={{ width: `${track.popularity}%` }}></div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4 mt-6">
            <button
              onClick={handleDownloadTrack}
              className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-full transition duration-300"
            >
              Download
            </button>
            <a
              href={track.external_urls.spotify}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-gray-700 hover:text-black transition duration-300"
              aria-label="Listen on Spotify"
            >
              <FaSpotify size={24} />
              <span className="font-semibold">Listen on Spotify</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
