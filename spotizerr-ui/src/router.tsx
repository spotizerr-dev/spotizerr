import { createRouter, createRootRoute, createRoute, lazyRouteComponent } from "@tanstack/react-router";
import Root from "./routes/root";
import apiClient from "./lib/api-client";
import type { SearchResult, SearchApiResponse } from "./types/spotify";
import { isValidSearchResult } from "./types/spotify";

// Lazy load route components for code splitting
const Album = lazyRouteComponent(() => import("./routes/album").then(m => ({ default: m.Album })));
const Artist = lazyRouteComponent(() => import("./routes/artist").then(m => ({ default: m.Artist })));
const Track = lazyRouteComponent(() => import("./routes/track").then(m => ({ default: m.Track })));
const Home = lazyRouteComponent(() => import("./routes/home").then(m => ({ default: m.Home })));
const Config = lazyRouteComponent(() => import("./routes/config").then(m => ({ default: m.Config })));
const Playlist = lazyRouteComponent(() => import("./routes/playlist").then(m => ({ default: m.Playlist })));
const History = lazyRouteComponent(() => import("./routes/history").then(m => ({ default: m.History })));
const Watchlist = lazyRouteComponent(() => import("./routes/watchlist").then(m => ({ default: m.Watchlist })));

const rootRoute = createRootRoute({
  component: Root,
});

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Home,
  validateSearch: (
    search: Record<string, unknown>,
  ): { q?: string; type?: "track" | "album" | "artist" | "playlist" } => {
    return {
      q: search.q as string | undefined,
      type: search.type as "track" | "album" | "artist" | "playlist" | undefined,
    };
  },
  loaderDeps: ({ search: { q, type } }) => ({ q, type: type || "track" }),
  loader: async ({ deps: { q, type } }) => {
    if (!q || q.length < 3) return { items: [] };

    const spotifyUrlRegex = /https:\/\/open\.spotify\.com\/(playlist|album|artist|track)\/([a-zA-Z0-9]+)/;
    const match = q.match(spotifyUrlRegex);

    if (match) {
      const [, urlType, id] = match;
      const response = await apiClient.get<SearchResult>(`/${urlType}/info?id=${id}`);
      return { items: [{ ...response.data, model: urlType as "track" | "album" | "artist" | "playlist" }] };
    }

    const response = await apiClient.get<SearchApiResponse>(`/search?q=${q}&search_type=${type}&limit=50`);
    
    // Filter out null values and add the model property
    const validResults = response.data.items
      .filter(isValidSearchResult)
      .map((item) => ({
        ...item,
        model: type,
      }));
    
    return { items: validResults };
  },
  gcTime: 5 * 60 * 1000, // 5 minutes
  staleTime: 5 * 60 * 1000, // 5 minutes
});

const albumRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/album/$albumId",
  component: Album,
});

const artistRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/artist/$artistId",
  component: Artist,
});

const trackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/track/$trackId",
  component: Track,
});

const configRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/config",
  component: Config,
  validateSearch: (search: Record<string, unknown>): { tab?: string } => {
    return {
      tab: typeof search.tab === "string" ? search.tab : undefined,
    };
  },
});

const playlistRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/playlist/$playlistId",
  component: Playlist,
});

const historyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/history",
  component: History,
});

const watchlistRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/watchlist",
  component: Watchlist,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  albumRoute,
  artistRoute,
  trackRoute,
  configRoute,
  playlistRoute,
  historyRoute,
  watchlistRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
