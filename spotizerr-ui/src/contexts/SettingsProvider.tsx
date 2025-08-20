import { type ReactNode } from "react";
import { authApiClient } from "../lib/api-client";
import { SettingsContext, type AppSettings } from "./settings-context";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./auth-context";

// --- Case Conversion Utility ---
// This is added here to simplify the fix and avoid module resolution issues.
function snakeToCamel(str: string): string {
  return str.replace(/(_\w)/g, (m) => m[1].toUpperCase());
}

function convertKeysToCamelCase(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map((v) => convertKeysToCamelCase(v));
  }
  if (typeof obj === "object" && obj !== null) {
    return Object.keys(obj).reduce((acc: Record<string, unknown>, key: string) => {
      const camelKey = snakeToCamel(key);
      acc[camelKey] = convertKeysToCamelCase((obj as Record<string, unknown>)[key]);
      return acc;
    }, {});
  }
  return obj;
}

// Redefine AppSettings to match the flat structure of the API response
export type FlatAppSettings = {
  service: "spotify" | "deezer";
  spotify: string;
  spotifyQuality: "NORMAL" | "HIGH" | "VERY_HIGH";
  deezer: string;
  deezerQuality: "MP3_128" | "MP3_320" | "FLAC";
  maxConcurrentDownloads: number;
  realTime: boolean;
  fallback: boolean;
  convertTo: "MP3" | "AAC" | "OGG" | "OPUS" | "FLAC" | "WAV" | "ALAC" | "";
  bitrate: string;
  maxRetries: number;
  retryDelaySeconds: number;
  retryDelayIncrease: number;
  customDirFormat: string;
  customTrackFormat: string;
  tracknumPadding: boolean;
  saveCover: boolean;
  explicitFilter: boolean;
  // Add other fields from the old AppSettings as needed by other parts of the app
  watch: AppSettings["watch"];
  // Add defaults for the new download properties
  threads: number;
  path: string;
  skipExisting: boolean;
  m3u: boolean;
  hlsThreads: number;
  // Frontend-only flag used in DownloadsTab
  recursiveQuality: boolean;
  separateTracksByUser: boolean;
  // Add defaults for the new formatting properties
  track: string;
  album: string;
  playlist: string;
  compilation: string;
  artistSeparator: string;
  spotifyMetadata: boolean;
  realTimeMultiplier: number;
};

const defaultSettings: FlatAppSettings = {
  service: "spotify",
  spotify: "",
  spotifyQuality: "NORMAL",
  deezer: "",
  deezerQuality: "MP3_128",
  maxConcurrentDownloads: 3,
  realTime: false,
  fallback: false,
  convertTo: "",
  bitrate: "",
  maxRetries: 3,
  retryDelaySeconds: 5,
  retryDelayIncrease: 5,
  customDirFormat: "%ar_album%/%album%",
  customTrackFormat: "%tracknum%. %music%",
  tracknumPadding: true,
  saveCover: true,
  explicitFilter: false,
  // Add defaults for the new download properties
  threads: 4,
  path: "/downloads",
  skipExisting: true,
  m3u: false,
  hlsThreads: 8,
  // Frontend-only default
  recursiveQuality: false,
  separateTracksByUser: false,
  // Add defaults for the new formatting properties
  track: "{artist_name}/{album_name}/{track_number} - {track_name}",
  album: "{artist_name}/{album_name}",
  playlist: "Playlists/{playlist_name}",
  compilation: "Compilations/{album_name}",
  artistSeparator: "; ",
  spotifyMetadata: true,
  watch: {
    enabled: false,
  },
  realTimeMultiplier: 0,
};

interface FetchedCamelCaseSettings {
  watchEnabled?: boolean;
  watch?: { enabled: boolean };
  [key: string]: unknown;
}

const fetchSettings = async (): Promise<FlatAppSettings> => {
  try {
    const [{ data: generalConfig }, { data: watchConfig }] = await Promise.all([
      authApiClient.client.get("/config"),
      authApiClient.client.get("/config/watch"),
    ]);

    const combinedConfig = {
      ...generalConfig,
      watch: watchConfig,
    };

    // Transform the keys before returning the data
    const camelData = convertKeysToCamelCase(combinedConfig) as FetchedCamelCaseSettings;

    const withDefaults: FlatAppSettings = {
      ...(camelData as unknown as FlatAppSettings),
      // Ensure required frontend-only fields exist
      recursiveQuality: Boolean((camelData as any).recursiveQuality ?? false),
      realTimeMultiplier: Number((camelData as any).realTimeMultiplier ?? 0),
    };

    return withDefaults;
  } catch (error: any) {
    // If we get authentication errors, return default settings
    if (error.response?.status === 401 || error.response?.status === 403) {
      console.log("Authentication required for config access, using default settings");
      return defaultSettings;
    }
    // Re-throw other errors for React Query to handle
    throw error;
  }
};

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { isLoading, authEnabled, isAuthenticated, user } = useAuth();
  
  // Only fetch settings when auth is ready and user is admin (or auth is disabled)
  const shouldFetchSettings = !isLoading && (!authEnabled || (isAuthenticated && user?.role === "admin"));
  
  const {
    data: settings,
    isLoading: isSettingsLoading,
    isError,
  } = useQuery({
    queryKey: ["config"],
    queryFn: fetchSettings,
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchOnWindowFocus: false,
    enabled: shouldFetchSettings, // Only run query when auth is ready and user is admin
  });

  // Use default settings on error to prevent app crash
  const value = { settings: isError ? defaultSettings : settings || null, isLoading: isSettingsLoading };

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}
