import { createRouter, createRootRoute, createRoute } from "@tanstack/react-router";
import Root from "./routes/root";
import { Album } from "./routes/album";
import { Artist } from "./routes/artist";
import { Track } from "./routes/track";
import { Home } from "./routes/home";
import { Config } from "./routes/config";
import { Playlist } from "./routes/playlist";
import { History } from "./routes/history";
import { Watchlist } from "./routes/watchlist";
import apiClient from "./lib/api-client";
import type { SearchResult } from "./types/spotify";

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

    const response = await apiClient.get<{ items: SearchResult[] }>(`/search?q=${q}&search_type=${type}&limit=50`);
    const augmentedResults = response.data.items.map((item) => ({
      ...item,
      model: type,
    }));
    return { items: augmentedResults };
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
