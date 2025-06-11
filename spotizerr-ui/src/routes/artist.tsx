import { Link, useParams } from "@tanstack/react-router";
import { useEffect, useState, useContext } from "react";
import { toast } from "sonner";
import apiClient from "../lib/api-client";
import type { AlbumType, ArtistType, TrackType } from "../types/spotify";
import { QueueContext } from "../contexts/queue-context";
import { useSettings } from "../contexts/settings-context";

export const Artist = () => {
  const { artistId } = useParams({ from: "/artist/$artistId" });
  const [artist, setArtist] = useState<ArtistType | null>(null);
  const [albums, setAlbums] = useState<AlbumType[]>([]);
  const [topTracks, setTopTracks] = useState<TrackType[]>([]);
  const [isWatched, setIsWatched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const context = useContext(QueueContext);
  const { settings } = useSettings();

  if (!context) {
    throw new Error("useQueue must be used within a QueueProvider");
  }
  const { addItem } = context;

  useEffect(() => {
    const fetchArtistData = async () => {
      if (!artistId) return;
      try {
        // Since the backend doesn't provide a single endpoint, we make multiple calls
        const artistPromise = apiClient.get<ArtistType>(`/artist/info?id=${artistId}`);
        const topTracksPromise = apiClient.get<{ tracks: TrackType[] }>(`/artist/${artistId}/top-tracks`);
        const albumsPromise = apiClient.get<{ items: AlbumType[] }>(`/artist/${artistId}/albums`);
        const watchStatusPromise = apiClient.get<{ is_watched: boolean }>(`/artist/watch/${artistId}/status`);

        const [artistRes, topTracksRes, albumsRes, watchStatusRes] = await Promise.allSettled([
          artistPromise,
          topTracksPromise,
          albumsPromise,
          watchStatusPromise,
        ]);

        if (artistRes.status === "fulfilled") {
          setArtist(artistRes.value.data);
        } else {
          throw new Error("Failed to load artist details");
        }

        if (topTracksRes.status === "fulfilled") {
          setTopTracks(topTracksRes.value.data.tracks);
        }

        if (albumsRes.status === "fulfilled") {
          setAlbums(albumsRes.value.data.items);
        }

        if (watchStatusRes.status === "fulfilled") {
          setIsWatched(watchStatusRes.value.data.is_watched);
        }
      } catch (err) {
        setError("Failed to load artist page");
        console.error(err);
      }
    };

    fetchArtistData();
  }, [artistId]);

  const handleDownloadTrack = (track: TrackType) => {
    if (!track.id) return;
    toast.info(`Adding ${track.name} to queue...`);
    addItem({ spotifyId: track.id, type: "track", name: track.name });
  };

  const handleDownloadArtist = () => {
    if (!artistId || !artist) return;
    toast.info(`Adding ${artist.name} to queue...`);
    addItem({
      spotifyId: artistId,
      type: "artist",
      name: artist.name,
    });
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

  if (!artist) {
    return <div>Loading...</div>;
  }

  const filteredAlbums = albums.filter((album) => {
    if (settings?.explicitFilter) {
      return !album.name.toLowerCase().includes("remix");
    }
    return true;
  });

  return (
    <div className="artist-page">
      <div className="artist-header">
        <img src={artist.images[0]?.url} alt={artist.name} className="artist-image" />
        <h1>{artist.name}</h1>
        <div className="flex gap-2">
          <button onClick={handleDownloadArtist} className="download-all-btn">
            Download All
          </button>
          <button onClick={handleToggleWatch} className="watch-btn">
            {isWatched ? "Unwatch" : "Watch"}
          </button>
        </div>
      </div>

      <h2>Top Tracks</h2>
      <div className="track-list">
        {topTracks.map((track) => (
          <div key={track.id} className="track-item">
            <Link to="/track/$trackId" params={{ trackId: track.id }}>
              {track.name}
            </Link>
            <button onClick={() => handleDownloadTrack(track)}>Download</button>
          </div>
        ))}
      </div>

      <h2>Albums</h2>
      <div className="album-grid">
        {filteredAlbums.map((album) => (
          <div key={album.id} className="album-card">
            <Link to="/album/$albumId" params={{ albumId: album.id }}>
              <img src={album.images[0]?.url} alt={album.name} />
              <p>{album.name}</p>
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
};
