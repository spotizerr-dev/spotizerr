import { useState, useEffect, useMemo, useContext, useCallback } from "react";
import { Link } from "@tanstack/react-router";
import { useDebounce } from "use-debounce";
import apiClient from "../lib/api-client";
import { toast } from "sonner";
import type { TrackType, AlbumType, ArtistType } from "../types/spotify";
import { QueueContext } from "../contexts/queue-context";

type SearchResult = (TrackType | AlbumType | ArtistType) & {
  model: "track" | "album" | "artist";
};

export const Home = () => {
  const [query, setQuery] = useState("");
  const [searchType, setSearchType] = useState<"track" | "album" | "artist">("track");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [debouncedQuery] = useDebounce(query, 500);
  const context = useContext(QueueContext);

  if (!context) {
    throw new Error("useQueue must be used within a QueueProvider");
  }
  const { addItem } = context;

  useEffect(() => {
    const performSearch = async () => {
      if (debouncedQuery.length < 3) {
        setResults([]);
        return;
      }
      setIsLoading(true);
      try {
        const response = await apiClient.get<{
          results: SearchResult[];
        }>(`/search?q=${debouncedQuery}&type=${searchType}`);
        setResults(response.data.results);
      } catch {
        toast.error("Search failed. Please try again.");
      } finally {
        setIsLoading(false);
      }
    };
    performSearch();
  }, [debouncedQuery, searchType]);

  const handleDownloadTrack = useCallback(
    (track: TrackType) => {
      addItem({ spotifyId: track.id, type: "track", name: track.name });
      toast.info(`Adding ${track.name} to queue...`);
    },
    [addItem],
  );

  const resultComponent = useMemo(() => {
    switch (searchType) {
      case "track":
        return (
          <div className="track-list">
            {results.map(
              (item) =>
                item.model === "track" && (
                  <div key={item.id} className="track-item">
                    <Link to="/track/$trackId" params={{ trackId: item.id }}>
                      {item.name}
                    </Link>
                    <button onClick={() => handleDownloadTrack(item as TrackType)}>Download</button>
                  </div>
                ),
            )}
          </div>
        );
      case "album":
        return (
          <div className="album-grid">
            {results.map(
              (item) =>
                item.model === "album" && (
                  <div key={item.id} className="album-card">
                    <Link to="/album/$albumId" params={{ albumId: item.id }}>
                      <img src={(item as AlbumType).images[0]?.url} alt={item.name} />
                      <p>{item.name}</p>
                    </Link>
                  </div>
                ),
            )}
          </div>
        );
      case "artist":
        return (
          <div className="artist-list">
            {results.map(
              (item) =>
                item.model === "artist" && (
                  <div key={item.id} className="artist-item">
                    <Link to="/artist/$artistId" params={{ artistId: item.id }}>
                      <p>{item.name}</p>
                    </Link>
                  </div>
                ),
            )}
          </div>
        );
      default:
        return null;
    }
  }, [results, searchType, handleDownloadTrack]);

  return (
    <div className="home-page">
      <h1>Search Spotify</h1>
      <div className="search-bar">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for a track, album, or artist"
        />
        <select value={searchType} onChange={(e) => setSearchType(e.target.value as "track" | "album" | "artist")}>
          <option value="track">Track</option>
          <option value="album">Album</option>
          <option value="artist">Artist</option>
        </select>
      </div>
      {isLoading && <p>Loading...</p>}
      <div className="search-results">{resultComponent}</div>
    </div>
  );
};
