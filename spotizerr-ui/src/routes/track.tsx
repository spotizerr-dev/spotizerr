import { Link, useParams } from "@tanstack/react-router";
import { useEffect, useState, useContext } from "react";
import apiClient from "../lib/api-client";
import type { TrackType } from "../types/spotify";
import { toast } from "sonner";
import { QueueContext, getStatus } from "../contexts/queue-context";
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
  const { addItem, items } = context;

  // Track queue status
  const trackQueueItem = track ? items.find(item => item.downloadType === "track" && item.spotifyId === track.id) : undefined;
  const trackStatus = trackQueueItem ? getStatus(trackQueueItem) : null;

  useEffect(() => {
    if (trackStatus === "queued") {
      toast.success(`${track?.name} queued.`);
    } else if (trackStatus === "error") {
      toast.error(`Failed to queue ${track?.name}`);
    }
  }, [trackStatus]);

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
        <p className="text-error text-lg">{error}</p>
      </div>
    );
  }

  if (!track) {
    return (
      <div className="flex justify-center items-center h-full">
        <p className="text-lg text-content-muted dark:text-content-muted-dark">Loading...</p>
      </div>
    );
  }

  const imageUrl = track.album.images?.[0]?.url;

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-8">
      <div className="mb-4 md:mb-6">
        <button
          onClick={() => window.history.back()}
          className="flex items-center gap-2 p-2 -ml-2 text-sm font-semibold text-content-secondary dark:text-content-secondary-dark hover:text-content-primary dark:hover:text-content-primary-dark hover:bg-surface-muted dark:hover:bg-surface-muted-dark rounded-lg transition-all"
        >
          <FaArrowLeft className="icon-secondary hover:icon-primary" />
          <span>Back to results</span>
        </button>
      </div>
      
      {/* Hero Section with Cover */}
      <div className="bg-gradient-to-b from-surface-muted to-surface dark:from-surface-muted-dark dark:to-surface-dark rounded-lg overflow-hidden mb-8">
        <div className="flex flex-col md:flex-row items-center md:items-end gap-6 p-6 md:p-8">
          {/* Album Cover */}
          <div className="flex-shrink-0">
            {imageUrl ? (
              <img 
                src={imageUrl} 
                alt={track.album.name} 
                className="w-48 h-48 md:w-64 md:h-64 object-cover rounded-lg shadow-2xl"
              />
            ) : (
              <div className="w-48 h-48 md:w-64 md:h-64 bg-surface-accent dark:bg-surface-accent-dark rounded-lg shadow-2xl flex items-center justify-center">
                <img src="/placeholder.jpg" alt="No cover" className="w-16 h-16 opacity-50 logo" />
              </div>
            )}
          </div>
          
          {/* Track Info */}
          <div className="flex-1 text-center md:text-left md:pb-4">
            <div className="flex flex-col md:flex-row md:items-baseline gap-2 md:gap-4 mb-2">
              <h1 className="text-3xl md:text-5xl font-bold text-content-primary dark:text-content-primary-dark leading-tight">
                {track.name}
              </h1>
              {track.explicit && (
                <span className="text-xs bg-surface-dark dark:bg-surface text-content-primary-dark dark:text-content-primary px-3 py-1 rounded-full self-center md:self-auto font-semibold">
                  EXPLICIT
                </span>
              )}
            </div>
            
            <div className="text-lg md:text-xl text-content-secondary dark:text-content-secondary-dark mb-2">
              {track.artists.map((artist, index) => (
                <span key={artist.id}>
                  <Link 
                    to="/artist/$artistId" 
                    params={{ artistId: artist.id }}
                    className="hover:text-content-primary dark:hover:text-content-primary-dark transition-colors"
                  >
                    {artist.name}
                  </Link>
                  {index < track.artists.length - 1 && ", "}
                </span>
              ))}
            </div>
            
            <p className="text-content-muted dark:text-content-muted-dark">
              From{" "}
              <Link 
                to="/album/$albumId" 
                params={{ albumId: track.album.id }} 
                className="font-semibold hover:text-content-primary dark:hover:text-content-primary-dark transition-colors"
              >
                {track.album.name}
              </Link>
            </p>
          </div>
        </div>
      </div>

      {/* Details Section */}
      <div className="bg-surface dark:bg-surface-secondary-dark rounded-lg shadow-lg p-6 md:p-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* Track Details */}
          <div>
            <h2 className="text-lg font-semibold text-content-primary dark:text-content-primary-dark mb-4">Track Details</h2>
            <div className="space-y-2 text-sm text-content-secondary dark:text-content-secondary-dark">
              <div className="flex gap-4">
                <span className="w-24 flex-shrink-0">Release Date:</span>
                <span>{track.album.release_date}</span>
              </div>
              <div className="flex gap-4">
                <span className="w-24 flex-shrink-0">Duration:</span>
                <span>{formatDuration(track.duration_ms)}</span>
              </div>
            </div>
          </div>
          
          {/* Popularity */}
          <div>
            <h2 className="text-lg font-semibold text-content-primary dark:text-content-primary-dark mb-4">Popularity</h2>
            <div className="flex items-center gap-3">
              <div className="flex-1 bg-surface-muted dark:bg-surface-muted-dark rounded-full h-3">
                <div 
                  className="bg-primary h-3 rounded-full transition-all duration-500" 
                  style={{ width: `${track.popularity}%` }}
                ></div>
              </div>
              <span className="text-sm font-medium text-content_secondary dark:text-content-secondary-dark">
                {track.popularity}%
              </span>
            </div>
          </div>
        </div>
        
        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <button
            onClick={handleDownloadTrack}
            disabled={!!trackQueueItem && trackStatus !== "error"}
            className="w-full sm:w-auto bg-button-primary hover:bg-button-primary-hover text-button-primary-text font-bold py-3 px-8 rounded-full transition duration-300 shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {trackStatus
              ? trackStatus === "queued"
                ? "Queued."
                : trackStatus === "error"
                ? "Download"
                : <img src="/spinner.svg" alt="Loading" className="w-5 h-5 animate-spin inline-block" />
              : "Download"}
          </button>
          <a
            href={track.external_urls.spotify}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full sm:w-auto flex items_center justify-center gap-3 text-content-secondary dark:text-content-secondary-dark hover:text-content-primary dark:hover:text-content-primary-dark transition duration-300 py-3 px-8 border border-border dark:border-border-dark rounded-full hover:border-border-accent dark:hover:border-border-accent-dark"
            aria-label="Listen on Spotify"
          >
            <FaSpotify size={20} className="icon-secondary hover:icon-primary" />
            <span className="font-semibold">Listen on Spotify</span>
          </a>
        </div>
      </div>
    </div>
  );
};
