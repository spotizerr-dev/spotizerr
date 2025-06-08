import { createRouter, createRootRoute, createRoute } from '@tanstack/react-router';
import { Root } from './routes/root';
import { Album } from './routes/album';
import { Artist } from './routes/artist';
import { Track } from './routes/track';
import { Home } from './routes/home';
import { Config } from './routes/config';
import { Playlist } from './routes/playlist';
import { History } from './routes/history';
import { Watchlist } from './routes/watchlist';

const rootRoute = createRootRoute({
  component: Root,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Home,
});

const albumRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/album/$albumId',
  component: Album,
});

const artistRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/artist/$artistId',
  component: Artist,
});

const trackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/track/$trackId',
  component: Track,
});

const configRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/config',
  component: Config,
});

const playlistRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/playlist/$playlistId',
  component: Playlist,
});

const historyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/history',
  component: History,
});

const watchlistRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/watchlist',
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

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
