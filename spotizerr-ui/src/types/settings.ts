// This new type reflects the flat structure of the /api/config response
export interface AppSettings {
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
  // Properties from the old 'downloads' object
  threads: number;
  path: string;
  skipExisting: boolean;
  m3u: boolean;
  hlsThreads: number;
  // Properties from the old 'formatting' object
  track: string;
  album: string;
  playlist: string;
  compilation: string;
  watch: {
    enabled: boolean;
    // Add other watch properties from the old type if they still exist in the API response
  };
  // Add other root-level properties from the API if they exist
}
