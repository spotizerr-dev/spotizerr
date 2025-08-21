import { useForm, type SubmitHandler } from "react-hook-form";
import { authApiClient } from "../../lib/api-client";
import { toast } from "sonner";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

// --- Type Definitions ---
interface DownloadSettings {
  maxConcurrentDownloads: number;
  realTime: boolean;
  fallback: boolean;
  convertTo: "MP3" | "AAC" | "OGG" | "OPUS" | "FLAC" | "WAV" | "ALAC" | "";
  bitrate: string;
  maxRetries: number;
  retryDelaySeconds: number;
  retryDelayIncrease: number;
  threads: number;
  path: string;
  skipExisting: boolean;
  m3u: boolean;
  hlsThreads: number;
  deezerQuality: "MP3_128" | "MP3_320" | "FLAC";
  spotifyQuality: "NORMAL" | "HIGH" | "VERY_HIGH";
  recursiveQuality: boolean; // frontend field (sent as camelCase to backend)
  separateTracksByUser: boolean;
  realTimeMultiplier: number;
}

interface WatchConfig {
  enabled: boolean;
  interval: number;
  playlists: string[];
}

interface Credential {
  name: string;
}

interface DownloadsTabProps {
  config: DownloadSettings;
  isLoading: boolean;
}

const CONVERSION_FORMATS: Record<string, string[]> = {
  MP3: ["32k", "64k", "96k", "128k", "192k", "256k", "320k"],
  AAC: ["32k", "64k", "96k", "128k", "192k", "256k"],
  OGG: ["64k", "96k", "128k", "192k", "256k", "320k"],
  OPUS: ["32k", "64k", "96k", "128k", "192k", "256k"],
  FLAC: [],
  WAV: [],
  ALAC: [],
};

// --- API Functions ---
const saveDownloadConfig = async (data: Partial<DownloadSettings>) => {
  const payload: any = { ...data };
  const { data: response } = await authApiClient.client.post("/config", payload);
  return response;
};

const fetchWatchConfig = async (): Promise<WatchConfig> => {
  const { data } = await authApiClient.client.get("/config/watch");
  return data;
};

const fetchCredentials = async (service: "spotify" | "deezer"): Promise<Credential[]> => {
  const { data } = await authApiClient.client.get<string[]>(`/credentials/${service}`);
  return data.map((name) => ({ name }));
};

// --- Component ---
export function DownloadsTab({ config, isLoading }: DownloadsTabProps) {
  const queryClient = useQueryClient();
  const [validationError, setValidationError] = useState<string>("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle");

  // Fetch watch config
  const { data: watchConfig } = useQuery({
    queryKey: ["watchConfig"],
    queryFn: fetchWatchConfig,
    staleTime: 30000, // 30 seconds
  });

  // Fetch credentials for fallback validation
  const { data: spotifyCredentials } = useQuery({
    queryKey: ["credentials", "spotify"],
    queryFn: () => fetchCredentials("spotify"),
    staleTime: 30000,
  });

  const { data: deezerCredentials } = useQuery({
    queryKey: ["credentials", "deezer"], 
    queryFn: () => fetchCredentials("deezer"),
    staleTime: 30000,
  });

  const mutation = useMutation({
    mutationFn: saveDownloadConfig,
    onSuccess: () => {
      toast.success("Download settings saved successfully!");
      setSaveStatus("success");
      setTimeout(() => setSaveStatus("idle"), 3000);
      queryClient.invalidateQueries({ queryKey: ["config"] });
    },
    onError: (error) => {
      toast.error(`Failed to save settings: ${error.message}`);
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
    },
  });

  const { register, handleSubmit, watch, reset } = useForm<DownloadSettings>({
    defaultValues: config,
  });

  useEffect(() => {
    if (config) {
      reset(config);
    }
  }, [config, reset]);

  const selectedFormat = watch("convertTo");
  const realTime = watch("realTime");
  const fallback = watch("fallback");

  // Validation effect for watch + download method requirement
  useEffect(() => {
    let error = "";
    
    // Check watch requirements
    if (watchConfig?.enabled && !realTime && !fallback) {
      error = "When watch is enabled, either Real-time downloading or Download Fallback (or both) must be enabled.";
    }
    
    // Check fallback account requirements
    if (fallback && (!spotifyCredentials?.length || !deezerCredentials?.length)) {
      const missingServices: string[] = [];
      if (!spotifyCredentials?.length) missingServices.push("Spotify");
      if (!deezerCredentials?.length) missingServices.push("Deezer");
      error = `Download Fallback requires accounts to be configured for both services. Missing: ${missingServices.join(", ")}. Configure accounts in the Accounts tab.`;
    }
    
    setValidationError(error);
  }, [watchConfig?.enabled, realTime, fallback, spotifyCredentials?.length, deezerCredentials?.length]);

  const onSubmit: SubmitHandler<DownloadSettings> = (data) => {
    // Check watch requirements
    if (watchConfig?.enabled && !data.realTime && !data.fallback) {
      setValidationError("When watch is enabled, either Real-time downloading or Download Fallback (or both) must be enabled.");
      toast.error("Validation failed: Watch requires at least one download method to be enabled.");
      return;
    }

    // Check fallback account requirements
    if (data.fallback && (!spotifyCredentials?.length || !deezerCredentials?.length)) {
      const missingServices: string[] = [];
      if (!spotifyCredentials?.length) missingServices.push("Spotify");
      if (!deezerCredentials?.length) missingServices.push("Deezer");
      const error = `Download Fallback requires accounts to be configured for both Spotify and Deezer. Missing: ${missingServices.join(", ")}. Configure accounts in the Accounts tab.`;
      setValidationError(error);
      toast.error("Validation failed: " + error);
      return;
    }

    mutation.mutate({
      ...data,
      maxConcurrentDownloads: Number(data.maxConcurrentDownloads),
      maxRetries: Number(data.maxRetries),
      retryDelaySeconds: Number(data.retryDelaySeconds),
      retryDelayIncrease: Number(data.retryDelayIncrease),
      realTimeMultiplier: Number(data.realTimeMultiplier ?? 0),
    });
  };

  if (isLoading) {
    return <div>Loading download settings...</div>;
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
      <div className="flex items-center justify-end mb-4">
        <div className="flex items-center gap-3">
          {saveStatus === "success" && (
            <span className="text-success text-sm">Saved</span>
          )}
          {saveStatus === "error" && (
            <span className="text-error text-sm">Save failed</span>
          )}
          <button
            type="submit"
            disabled={mutation.isPending || !!validationError}
            className="px-4 py-2 bg-button-primary hover:bg-button-primary-hover text-button-primary-text rounded-md disabled:opacity-50"
          >
            {mutation.isPending ? "Saving..." : "Save Download Settings"}
          </button>
        </div>
      </div>

      {/* Download Settings */}
      <div className="space-y-4">
        <h3 className="text-xl font-semibold text-content-primary dark:text-content-primary-dark">Download Behavior</h3>
        <div className="flex flex-col gap-2">
          <label htmlFor="maxConcurrentDownloads" className="text-content-primary dark:text-content-primary-dark">Max Concurrent Downloads</label>
          <input
            id="maxConcurrentDownloads"
            type="number"
            min="1"
            {...register("maxConcurrentDownloads")}
            className="block w-full p-2 border bg-input-background dark:bg-input-background-dark border-input-border dark:border-input-border-dark rounded-md focus:outline-none focus:ring-2 focus:ring-input-focus"
          />
        </div>
        <div className="flex items-center justify-between">
          <label htmlFor="realTimeToggle" className="text-content-primary dark:text-content-primary-dark">Real-time downloading</label>
          <input id="realTimeToggle" type="checkbox" {...register("realTime")} className="h-6 w-6 rounded" />
        </div>
        {/* Real-time Multiplier (Spotify only) */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label htmlFor="realTimeMultiplier" className="text-content-primary dark:text-content-primary-dark">Real-time speed multiplier (Spotify)</label>
            <span className="text-xs text-content-secondary dark:text-content-secondary-dark">0–10</span>
          </div>
          <input
            id="realTimeMultiplier"
            type="number"
            min={0}
            max={10}
            step={1}
            {...register("realTimeMultiplier")}
            disabled={!realTime}
            className="block w-full p-2 border bg-input-background dark:bg-input-background-dark border-input-border dark:border-input-border-dark rounded-md focus:outline-none focus:ring-2 focus:ring-input-focus disabled:opacity-50"
          />
          <p className="text-xs text-content-muted dark:text-content-muted-dark">
            Controls how fast Spotify real-time downloads go. Only affects Spotify downloads; ignored for Deezer.
          </p>
        </div>
        <div className="flex items-center justify-between">
          <label htmlFor="fallbackToggle" className="text-content-primary dark:text-content-primary-dark">Download Fallback</label>
          <input id="fallbackToggle" type="checkbox" {...register("fallback")} className="h-6 w-6 rounded" />
        </div>
        <div className="flex items-center justify-between">
          <label htmlFor="recursiveQualityToggle" className="text-content-primary dark:text-content-primary-dark">Recursive Quality</label>
          <input id="recursiveQualityToggle" type="checkbox" {...register("recursiveQuality")} className="h-6 w-6 rounded" />
        </div>
        <div className="flex items-center justify-between">
          <label htmlFor="separateTracksByUserToggle" className="text-content-primary dark:text-content-primary-dark">Separate tracks by user</label>
          <input id="separateTracksByUserToggle" type="checkbox" {...register("separateTracksByUser")} className="h-6 w-6 rounded" />
        </div>
        <p className="text-sm text-content-muted dark:text-content-muted-dark">
          When enabled, downloads will be organized in user-specific subdirectories (downloads/username/...)
        </p>
        
        {/* Watch validation info */}
        {watchConfig?.enabled && (
          <div className="p-3 bg-info/10 border border-info/20 rounded-lg">
            <p className="text-sm text-info font-medium mb-1">
              Watch is currently enabled
            </p>
            <p className="text-xs text-content-muted dark:text-content-muted-dark">
              At least one download method (Real-time or Fallback) must be enabled when using watch functionality.
            </p>
          </div>
        )}
        
        {/* Fallback account requirements info */}
        {fallback && (!spotifyCredentials?.length || !deezerCredentials?.length) && (
          <div className="p-3 bg-warning/10 border border-warning/20 rounded-lg">
            <p className="text-sm text-warning font-medium mb-1">
              Fallback accounts required
            </p>
            <p className="text-xs text-content-muted dark:text-content-muted-dark">
              Download Fallback requires accounts for both Spotify and Deezer. Configure missing accounts in the Accounts tab.
            </p>
          </div>
        )}
        
        {/* Validation error display */}
        {validationError && (
          <div className="p-3 bg-error/10 border border-error/20 rounded-lg">
            <p className="text-sm text-error font-medium">{validationError}</p>
          </div>
        )}
      </div>

      {/* Source Quality Settings */}
      <div className="space-y-4">
        <h3 className="text-xl font-semibold text-content-primary dark:text-content-primary-dark">Source Quality</h3>
        <div className="flex flex-col gap-2">
          <label htmlFor="spotifyQuality" className="text-content-primary dark:text-content-primary-dark">Spotify Quality</label>
          <select
            id="spotifyQuality"
            {...register("spotifyQuality")}
            className="block w-full p-2 border bg-input-background dark:bg-input-background-dark border-input-border dark:border-input-border-dark rounded-md focus:outline-none focus:ring-2 focus:ring-input-focus"
          >
            <option value="NORMAL">OGG 96kbps</option>
            <option value="HIGH">OGG 160kbps</option>
            <option value="VERY_HIGH">OGG 320kbps (Premium)</option>
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="deezerQuality" className="text-content-primary dark:text-content-primary-dark">Deezer Quality</label>
          <select
            id="deezerQuality"
            {...register("deezerQuality")}
            className="block w-full p-2 border bg-input-background dark:bg-input-background-dark border-input-border dark:border-input-border-dark rounded-md focus:outline-none focus:ring-2 focus:ring-input-focus"
          >
            <option value="MP3_128">MP3 128kbps</option>
            <option value="MP3_320">MP3 320kbps</option>
            <option value="FLAC">FLAC (HiFi)</option>
          </select>
        </div>
        <p className="text-sm text-content-muted dark:text-content-muted-dark mt-1">
          This sets the quality of the original download. Conversion settings below are applied after download.
        </p>
      </div>

      {/* Conversion Settings */}
      <div className="space-y-4">
        <h3 className="text-xl font-semibold text-content-primary dark:text-content-primary-dark">Conversion</h3>
        <div className="flex flex-col gap-2">
          <label htmlFor="convertToSelect" className="text-content-primary dark:text-content-primary-dark">Convert To Format</label>
          <select
            id="convertToSelect"
            {...register("convertTo")}
            className="block w-full p-2 border bg-input-background dark:bg-input-background-dark border-input-border dark:border-input-border-dark rounded-md focus:outline-none focus:ring-2 focus:ring-input-focus"
          >
            <option value="">No Conversion</option>
            {Object.keys(CONVERSION_FORMATS).map((format) => (
              <option key={format} value={format}>
                {format}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="bitrateSelect" className="text-content-primary dark:text-content-primary-dark">Bitrate</label>
          <select
            id="bitrateSelect"
            {...register("bitrate")}
            className="block w-full p-2 border bg-input-background dark:bg-input-background-dark border-input-border dark:border-input-border-dark rounded-md focus:outline-none focus:ring-2 focus:ring-input-focus"
            disabled={!selectedFormat || CONVERSION_FORMATS[selectedFormat]?.length === 0}
          >
            <option value="">Auto</option>
            {(CONVERSION_FORMATS[selectedFormat] || []).map((rate) => (
              <option key={rate} value={rate}>
                {rate}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Retry Options */}
      <div className="space-y-4">
        <h3 className="text-xl font-semibold text-content-primary dark:text-content-primary-dark">Retries</h3>
        <div className="flex flex-col gap-2">
          <label htmlFor="maxRetries" className="text-content-primary dark:text-content-primary-dark">Max Retry Attempts</label>
          <input
            id="maxRetries"
            type="number"
            min="0"
            {...register("maxRetries")}
            className="block w-full p-2 border bg-input-background dark:bg-input-background-dark border-input-border dark:border-input-border-dark rounded-md focus:outline-none focus:ring-2 focus:ring-input-focus"
          />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="retryDelaySeconds" className="text-content-primary dark:text-content-primary-dark">Initial Retry Delay (s)</label>
          <input
            id="retryDelaySeconds"
            type="number"
            min="1"
            {...register("retryDelaySeconds")}
            className="block w-full p-2 border bg-input-background dark:bg-input-background-dark border-input-border dark:border-input-border-dark rounded-md focus:outline-none focus:ring-2 focus:ring-input-focus"
          />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="retryDelayIncrease" className="text-content-primary dark:text-content-primary-dark">Retry Delay Increase (s)</label>
          <input
            id="retryDelayIncrease"
            type="number"
            min="0"
            {...register("retryDelayIncrease")}
            className="block w-full p-2 border bg-input-background dark:bg-input-background-dark border-input-border dark:border-input-border-dark rounded-md focus:outline-none focus:ring-2 focus:ring-input-focus"
          />
        </div>
      </div>
    </form>
  );
}
