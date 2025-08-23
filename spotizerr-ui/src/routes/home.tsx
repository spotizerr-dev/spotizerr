import { useState, useEffect, useMemo, useContext, useCallback, useRef } from "react";
import { useNavigate, useSearch, useRouterState } from "@tanstack/react-router";
import { useDebounce } from "use-debounce";
import { toast } from "sonner";
import type { TrackType, AlbumType, SearchResult } from "@/types/spotify";
import { parseSpotifyUrl} from "@/lib/spotify-utils";
import { QueueContext } from "@/contexts/queue-context";
import { SearchResultCard } from "@/components/SearchResultCard";
import { indexRoute } from "@/router";
import { authApiClient } from "@/lib/api-client";
import { useSettings } from "@/contexts/settings-context";
import { FaEye } from "react-icons/fa";

// Utility function to safely get properties from search results
const safelyGetProperty = <T,>(obj: any, path: string[], fallback: T): T => {
  try {
    let current = obj;
    for (const key of path) {
      if (current == null || typeof current !== 'object') {
        return fallback;
      }
      current = current[key];
    }
    return current ?? fallback;
  } catch {
    return fallback;
  }
};

const PAGE_SIZE = 12;

export const Home = () => {
  const navigate = useNavigate({ from: "/" });
  const { q, type } = useSearch({ from: "/" });
  const { items: allResults } = indexRoute.useLoaderData();
  const isLoading = useRouterState({ select: (s) => s.status === "pending" });
  const { settings } = useSettings();

  const [query, setQuery] = useState(q || "");
  const [searchType, setSearchType] = useState<"track" | "album" | "artist" | "playlist">(type || "track");
  const [debouncedQuery] = useDebounce(query, 500);
  const [activeTab, setActiveTab] = useState<"search" | "bulkAdd">("search");
  const [linksInput, setLinksInput] = useState("");
  const [isBulkAdding, setIsBulkAdding] = useState(false);
  const [isBulkWatching, setIsBulkWatching] = useState(false);

  const [displayedResults, setDisplayedResults] = useState<SearchResult[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const context = useContext(QueueContext);
  const loaderRef = useRef<HTMLDivElement | null>(null);

  // Removed scroll locking on mobile empty state to avoid blocking scroll globally

  useEffect(() => {
    navigate({ search: (prev) => ({ ...prev, q: debouncedQuery, type: searchType }) });
  }, [debouncedQuery, searchType, navigate]);

  useEffect(() => {
    setDisplayedResults(allResults.slice(0, PAGE_SIZE));
  }, [allResults]);

  if (!context) {
    throw new Error("useQueue must be used within a QueueProvider");
  }
  const { addItem } = context;

  const handleAddBulkLinks = useCallback(async () => {
    const allLinks = linksInput.split("\n").map((link) => link.trim()).filter(Boolean);
    if (allLinks.length === 0) {
      toast.info("No links provided to add.");
      return;
    }

    const supportedLinks: string[] = [];
    const unsupportedLinks: string[] = [];

    allLinks.forEach((link) => {
      const parsed = parseSpotifyUrl(link);
      if (parsed.type !== "unknown") {
        supportedLinks.push(link);
      } else {
        unsupportedLinks.push(link);
      }
    });

    if (unsupportedLinks.length > 0) {
      toast.warning("Some links are not supported and will be skipped.", {
        description: `Unsupported: ${unsupportedLinks.join(", ")}`,
      });
    }

    if (supportedLinks.length === 0) {
      toast.info("No supported links to add.");
      return;
    }

    setIsBulkAdding(true);
    try {
      const response = await authApiClient.client.post("/bulk/bulk-add-spotify-links", { links: supportedLinks });
      const { message, count, failed_links } = response.data;

      if (failed_links && failed_links.length > 0) {
        toast.warning("Bulk Add Completed with Warnings", {
          description: `${count} links added. Failed to add ${failed_links.length} links: ${failed_links.join(", ")}`,
        });
      } else {
        toast.success("Bulk Add Successful", {
          description: `${count} links added to queue.`,
        });
      }
      setLinksInput(""); // Clear input after successful add
    } catch (error: any) {
      const errorMessage = error.response?.data?.detail?.message || error.message;
      const failedLinks = error.response?.data?.detail?.failed_links || [];

      let description = errorMessage;
      if (failedLinks.length > 0) {
        description += ` Failed links: ${failedLinks.join(", ")}`;
      }

      toast.error("Bulk Add Failed", {
        description: description,
      });
      if (failedLinks.length > 0) {
        console.error("Failed links:", failedLinks);
      }
    } finally {
      setIsBulkAdding(false);
    }
  }, [linksInput]);

  const handleWatchBulkLinks = useCallback(async () => {
    const links = linksInput.split("\n").map((link) => link.trim()).filter(Boolean);
    if (links.length === 0) {
      toast.info("No links provided to watch.");
      return;
    }

    const supportedLinks: { type: "artist" | "playlist"; id: string }[] = [];
    const unsupportedLinks: string[] = [];

    links.forEach((link) => {
      const parsed = parseSpotifyUrl(link);
      if (parsed.type === "artist" || parsed.type === "playlist") {
        supportedLinks.push({ type: parsed.type, id: parsed.id });
      } else {
        unsupportedLinks.push(link);
      }
    });

    if (unsupportedLinks.length > 0) {
      toast.warning("Some links are not supported for watching.", {
        description: `Unsupported: ${unsupportedLinks.join(", ")}`,
      });
    }

    if (supportedLinks.length === 0) {
      toast.info("No supported links to watch.");
      return;
    }

    setIsBulkWatching(true);
    try {
      const watchPromises = supportedLinks.map((item) =>
        authApiClient.client.put(`/${item.type}/watch/${item.id}`)
      );
      await Promise.all(watchPromises);
      toast.success("Bulk Watch Successful", {
        description: `${supportedLinks.length} supported links added to watchlist.`,
      });
      setLinksInput(""); // Clear input after successful add
    } catch (error: any) {
      const errorMessage = error.response?.data?.detail?.message || error.message;
      toast.error("Bulk Watch Failed", {
        description: errorMessage,
      });
    } finally {
      setIsBulkWatching(false);
    }
  }, [linksInput]);

  const loadMore = useCallback(() => {
    setIsLoadingMore(true);
    setTimeout(() => {
      const currentLength = displayedResults.length;
      const nextBatch = allResults.slice(currentLength, currentLength + PAGE_SIZE);
      setDisplayedResults((prev) => [...prev, ...nextBatch]);
      setIsLoadingMore(false);
    }, 500); // Simulate network delay
  }, [allResults, displayedResults]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const firstEntry = entries[0];
        if (firstEntry.isIntersecting && allResults.length > displayedResults.length) {
          loadMore();
        }
      },
      { threshold: 1.0 },
    );

    const currentLoader = loaderRef.current;
    if (currentLoader) {
      observer.observe(currentLoader);
    }

    return () => {
      if (currentLoader) {
        observer.unobserve(currentLoader);
      }
    };
  }, [allResults, displayedResults, loadMore]);

  const handleDownloadTrack = useCallback(
    (track: TrackType) => {
      const artistName = track.artists?.map((a) => a.name).join(", ");
      addItem({ spotifyId: track.id, type: "track", name: track.name, artist: artistName });
      toast.info(`Adding ${track.name} to queue...`);
    },
    [addItem],
  );

  const handleDownloadAlbum = useCallback(
    (album: AlbumType) => {
      const artistName = album.artists?.map((a) => a.name).join(", ");
      addItem({ spotifyId: album.id, type: "album", name: album.name, artist: artistName });
      toast.info(`Adding ${album.name} to queue...`);
    },
    [addItem],
  );

  const resultComponent = useMemo(() => {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {displayedResults.map((item) => {
          // Add safety checks for essential properties
          if (!item || !item.id || !item.name || !item.model) {
            return null;
          }

          let imageUrl;
          let onDownload;
          let subtitle;

          if (item.model === "track") {
            imageUrl = safelyGetProperty(item, ['album', 'images', '0', 'url'], undefined);
            onDownload = () => handleDownloadTrack(item as TrackType);
            const artists = safelyGetProperty(item, ['artists'], []);
            subtitle = Array.isArray(artists) ? artists.map((a: any) => safelyGetProperty(a, ['name'], 'Unknown')).join(", ") : "Unknown Artist";
          } else if (item.model === "album") {
            imageUrl = safelyGetProperty(item, ['images', '0', 'url'], undefined);
            onDownload = () => handleDownloadAlbum(item as AlbumType);
            const artists = safelyGetProperty(item, ['artists'], []);
            subtitle = Array.isArray(artists) ? artists.map((a: any) => safelyGetProperty(a, ['name'], 'Unknown')).join(", ") : "Unknown Artist";
          } else if (item.model === "artist") {
            imageUrl = safelyGetProperty(item, ['images', '0', 'url'], undefined);
            subtitle = "Artist";
          } else if (item.model === "playlist") {
            imageUrl = safelyGetProperty(item, ['images', '0', 'url'], undefined);
            const ownerName = safelyGetProperty(item, ['owner', 'display_name'], 'Unknown');
            subtitle = `By ${ownerName}`;
          }

          return (
            <SearchResultCard
              key={item.id}
              id={item.id}
              name={item.name}
              type={item.model}
              imageUrl={imageUrl}
              subtitle={subtitle}
              onDownload={onDownload}
            />
          );
        }).filter(Boolean)} {/* Filter out null components */}
      </div>
    );
  }, [displayedResults, handleDownloadTrack, handleDownloadAlbum]);

  return (
    <div className="max-w-4xl mx-auto h-full flex flex-col md:p-4">
      <div className="text-center mb-4 md:mb-8 px-4 md:px-0">
        <h1 className="text-2xl font-bold text-content-primary dark:text-content-primary-dark">Spotizerr</h1>
      </div>

      <div className="flex justify-center mb-4 md:mb-6 px-4 md:px-0 border-b border-gray-300 dark:border-gray-700">
        <button
          className={`flex-1 py-2 text-center transition-colors duration-200 ${
            activeTab === "search"
              ? "border-b-2 border-green-500 text-green-500"
              : "border-b-2 border-transparent text-gray-800 dark:text-gray-200 hover:text-green-500"
          }`}
          onClick={() => setActiveTab("search")}
        >
          Search
        </button>
        <button
          className={`flex-1 py-2 text-center transition-colors duration-200 ${
            activeTab === "bulkAdd"
              ? "border-b-2 border-green-500 text-green-500"
              : "border-b-2 border-transparent text-gray-800 dark:text-gray-200 hover:text-green-500"
          }`}
          onClick={() => setActiveTab("bulkAdd")}
        >
          Bulk Add
        </button>
      </div>

      {activeTab === "search" && (
        <>
          <div className="flex flex-col gap-3 mb-4 md:mb-6 px-4 md:px-0 flex-shrink-0">
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search for a track, album, or artist"
                className="flex-1 p-2 border bg-input-background dark:bg-input-background-dark border-input-border dark:border-input-border-dark rounded-md focus:outline-none focus:ring-2 focus:ring-input-focus"
              />
              <select
                value={searchType}
                onChange={(e) => setSearchType(e.target.value as "track" | "album" | "artist" | "playlist")}
                className="p-2 border bg-input-background dark:bg-input-background-dark border-input-border dark:border-input-border-dark rounded-md focus:outline-none focus:ring-2 focus:ring-input-focus"
              >
                <option value="track">Track</option>
                <option value="album">Album</option>
                <option value="artist">Artist</option>
                <option value="playlist">Playlist</option>
              </select>
            </div>
          </div>
          <div className={`flex-1 px-4 md:px-0 pb-4 ${
            // Only restrict overflow on mobile when there are results, otherwise allow normal behavior
            displayedResults.length > 0 ? 'overflow-y-auto md:overflow-visible' : ''
          }`}>
            {isLoading ? (
              <p className="text-center my-4 text-content-muted dark:text-content-muted-dark">Loading results...</p>
            ) : (
              <>
                {resultComponent}
                <div ref={loaderRef} />
                {isLoadingMore && <p className="text-center my-4 text-content-muted dark:text-content-muted-dark">Loading more results...</p>}
              </>
            )}
          </div>
        </>
      )}

      {activeTab === "bulkAdd" && (
        <div className="flex flex-col gap-3 mb-4 md:mb-6 px-4 md:px-0 flex-shrink-0">
          <textarea
            className="w-full h-60 p-2 border bg-input-background dark:bg-input-background-dark border-input-border dark:border-input-border-dark rounded-md mb-4 focus:outline-none focus:ring-2 focus:ring-green-500"
            placeholder="Paste Spotify links here, one per line..."
            value={linksInput}
            onChange={(e) => setLinksInput(e.target.value)}
          ></textarea>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setLinksInput("")} // Clear input
              className="px-4 py-2 bg-gray-300 dark:bg-gray-700 text-content-primary dark:text-content-primary-dark rounded-md hover:bg-gray-400 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500"
            >
              Clear
            </button>
            <button
              onClick={handleAddBulkLinks}
              disabled={isBulkAdding}
              className="px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-400 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isBulkAdding ? "Adding..." : "Download"}
            </button>
            {settings?.watch?.enabled && (
              <button
                onClick={handleWatchBulkLinks}
                disabled={isBulkWatching}
                className="px-4 py-2 bg-error hover:bg-error-hover text-button-primary-text rounded-md flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Only Spotify Artist and Playlist links are supported for watching."
              >
                {isBulkWatching ? "Watching..." : (
                  <>
                    <FaEye className="icon-inverse" /> Watch
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
