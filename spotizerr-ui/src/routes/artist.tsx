import { Link, useParams } from "@tanstack/react-router";
import { useEffect, useState, useContext } from "react";
import { toast } from "sonner";
import apiClient from "../lib/api-client";
import type { AlbumType, ArtistType, TrackType } from "../types/spotify";
import { QueueContext } from "../contexts/queue-context";
import { useSettings } from "../contexts/settings-context";
import { FaArrowLeft, FaBookmark, FaRegBookmark, FaDownload } from "react-icons/fa";
import { AlbumCard } from "../components/AlbumCard";

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
        const response = await apiClient.get(`/artist/info?id=${artistId}`);
        const artistData = response.data;

                 // Check if we have artist data in the response
         if (artistData?.id && artistData?.name) {
           // Set artist info directly from the response
           setArtist({
             id: artistData.id,
             name: artistData.name,
             images: artistData.images || [],
             external_urls: artistData.external_urls || { spotify: "" },
             followers: artistData.followers || { total: 0 },
             genres: artistData.genres || [],
             popularity: artistData.popularity || 0,
             type: artistData.type || 'artist',
             uri: artistData.uri || ''
           });

          // Check if we have albums data
          if (artistData?.albums?.items && artistData.albums.items.length > 0) {
            setAlbums(artistData.albums.items);
          } else {
            setError("No albums found for this artist.");
            return;
          }
        } else {
          setError("Could not load artist data.");
          return;
        }

        setTopTracks([]);

        const watchStatusResponse = await apiClient.get<{ is_watched: boolean }>(`/artist/watch/${artistId}/status`);
        setIsWatched(watchStatusResponse.data.is_watched);
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

  const handleDownloadAlbum = (album: AlbumType) => {
    toast.info(`Adding ${album.name} to queue...`);
    addItem({ spotifyId: album.id, type: "album", name: album.name });
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

  if (!artist.name) {
    return <div>Artist data could not be fully loaded. Please try again later.</div>;
  }

  const applyFilters = (items: AlbumType[]) => {
    return items.filter((item) => (settings?.explicitFilter ? !item.explicit : true));
  };

  const artistAlbums = applyFilters(albums.filter((album) => album.album_type === "album"));
  const artistSingles = applyFilters(albums.filter((album) => album.album_type === "single"));
  const artistCompilations = applyFilters(albums.filter((album) => album.album_type === "compilation"));

  return (
    <div className="artist-page">
      <div className="mb-6">
        <button
          onClick={() => window.history.back()}
          className="flex items-center gap-2 text-sm font-semibold text-gray-600 hover:text-gray-900 transition-colors"
        >
          <FaArrowLeft />
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
        <h1 className="text-5xl font-bold">{artist.name}</h1>
        <div className="flex gap-4 justify-center mt-4">
          <button
            onClick={handleDownloadArtist}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
          >
            <FaDownload />
            <span>Download All</span>
          </button>
          <button
            onClick={handleToggleWatch}
            className={`flex items-center gap-2 px-4 py-2 rounded-md transition-colors border ${
              isWatched
                ? "bg-blue-500 text-white border-blue-500"
                : "bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800"
            }`}
          >
            {isWatched ? (
              <>
                <FaBookmark />
                <span>Watching</span>
              </>
            ) : (
              <>
                <FaRegBookmark />
                <span>Watch</span>
              </>
            )}
          </button>
        </div>
      </div>

      {topTracks.length > 0 && (
        <div className="mb-12">
          <h2 className="text-3xl font-bold mb-6">Top Tracks</h2>
          <div className="track-list space-y-2">
            {topTracks.map((track) => (
              <div
                key={track.id}
                className="track-item flex items-center justify-between p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <Link to="/track/$trackId" params={{ trackId: track.id }} className="font-semibold">
                  {track.name}
                </Link>
                <button onClick={() => handleDownloadTrack(track)} className="download-btn">
                  Download
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {artistAlbums.length > 0 && (
        <div className="mb-12">
          <h2 className="text-3xl font-bold mb-6">Albums</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            {artistAlbums.map((album) => (
              <AlbumCard key={album.id} album={album} onDownload={() => handleDownloadAlbum(album)} />
            ))}
          </div>
        </div>
      )}

      {artistSingles.length > 0 && (
        <div className="mb-12">
          <h2 className="text-3xl font-bold mb-6">Singles</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            {artistSingles.map((album) => (
              <AlbumCard key={album.id} album={album} onDownload={() => handleDownloadAlbum(album)} />
            ))}
          </div>
        </div>
      )}

      {artistCompilations.length > 0 && (
        <div className="mb-12">
          <h2 className="text-3xl font-bold mb-6">Compilations</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            {artistCompilations.map((album) => (
              <AlbumCard key={album.id} album={album} onDownload={() => handleDownloadAlbum(album)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
