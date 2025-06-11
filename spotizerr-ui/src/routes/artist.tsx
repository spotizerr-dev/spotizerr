import { Link, useParams } from "@tanstack/react-router";
import { useEffect, useState, useContext } from "react";
import { toast } from "sonner";
import apiClient from "../lib/api-client";
import type { AlbumType, ArtistType, TrackType } from "../types/spotify";
import { QueueContext } from "../contexts/queue-context";
import { useSettings } from "../contexts/settings-context";

export const Artist = () => {
  const { artistId } = useParams({ from: "/artist/$artistId" });
  const [artistInfo, setArtistInfo] = useState<{
    artist: ArtistType;
    top_tracks: TrackType[];
    albums: AlbumType[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const context = useContext(QueueContext);
  const { settings } = useSettings();

  if (!context) {
    throw new Error("useQueue must be used within a QueueProvider");
  }
  const { addItem } = context;

  useEffect(() => {
    const fetchArtistInfo = async () => {
      try {
        const response = await apiClient.get(`/artist/info?id=${artistId}`);
        setArtistInfo(response.data);
      } catch (err) {
        setError("Failed to load artist");
        console.error(err);
      }
    };

    if (artistId) {
      fetchArtistInfo();
    }
  }, [artistId]);

  const handleDownloadTrack = (track: TrackType) => {
    if (!track.id) return;
    toast.info(`Adding ${track.name} to queue...`);
    addItem({ spotifyId: track.id, type: "track", name: track.name });
  };

  const handleDownloadArtist = () => {
    if (!artistId || !artistInfo) return;
    toast.info(`Adding ${artistInfo.artist.name} to queue...`);
    addItem({
      spotifyId: artistId,
      type: "artist",
      name: artistInfo.artist.name,
    });
  };

  if (error) {
    return <div className="text-red-500">{error}</div>;
  }

  if (!artistInfo) {
    return <div>Loading...</div>;
  }

  const filteredAlbums = artistInfo.albums.filter((album) => {
    if (settings?.explicitFilter) {
      return !album.name.toLowerCase().includes("remix");
    }
    return true;
  });

  return (
    <div className="artist-page">
      <div className="artist-header">
        <img src={artistInfo.artist.images[0]?.url} alt={artistInfo.artist.name} className="artist-image" />
        <h1>{artistInfo.artist.name}</h1>
        <button onClick={handleDownloadArtist} className="download-all-btn">
          Download All
        </button>
      </div>

      <h2>Top Tracks</h2>
      <div className="track-list">
        {artistInfo.top_tracks.map((track) => (
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
