import { useEffect, useState } from "react";
import { useForm, type SubmitHandler, Controller } from "react-hook-form";
import { authApiClient } from "../../lib/api-client";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// --- Type Definitions ---
const ALBUM_GROUPS = ["album", "single", "compilation", "appears_on"] as const;

type AlbumGroup = (typeof ALBUM_GROUPS)[number];

interface WatchSettings {
  enabled: boolean;
  watchPollIntervalSeconds: number;
  watchedArtistAlbumGroup: AlbumGroup[];
  maxItemsPerRun: number;
}

interface DownloadSettings {
  realTime: boolean;
  fallback: boolean;
  maxConcurrentDownloads: number;
  convertTo: string;
  bitrate: string;
  maxRetries: number;
  retryDelaySeconds: number;
  retryDelayIncrease: number;
  deezerQuality: string;
  spotifyQuality: string;
}

interface Credential {
  name: string;
}

// --- API Functions ---
const fetchWatchConfig = async (): Promise<WatchSettings> => {
  const { data } = await authApiClient.client.get("/config/watch");
  return data;
};

const fetchDownloadConfig = async (): Promise<DownloadSettings> => {
  const { data } = await authApiClient.client.get("/config");
  return data;
};

const fetchCredentials = async (service: "spotify" | "deezer"): Promise<Credential[]> => {
  const { data } = await authApiClient.client.get<string[]>(`/credentials/${service}`);
  return data.map((name) => ({ name }));
};

const saveWatchConfig = async (data: Partial<WatchSettings>) => {
  const { data: response } = await authApiClient.client.post("/config/watch", data);
  return response;
};

// --- Component ---
export function WatchTab() {
  const queryClient = useQueryClient();
  const [validationError, setValidationError] = useState<string>("");

  const { data: config, isLoading } = useQuery({
    queryKey: ["watchConfig"],
    queryFn: fetchWatchConfig,
  });

  // Fetch download config to validate requirements
  const { data: downloadConfig } = useQuery({
    queryKey: ["config"],
    queryFn: fetchDownloadConfig,
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
    mutationFn: saveWatchConfig,
    onSuccess: () => {
      toast.success("Watch settings saved successfully!");
      queryClient.invalidateQueries({ queryKey: ["watchConfig"] });
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || error?.message || "Unknown error";
      toast.error(`Failed to save settings: ${message}`);
      console.error("Failed to save watch settings:", message);
    },
  });

  const { register, handleSubmit, control, reset, watch } = useForm<WatchSettings>();

  useEffect(() => {
    if (config) {
      reset(config);
    }
  }, [config, reset]);

  const watchEnabled = watch("enabled");
  const maxItemsPerRunValue = watch("maxItemsPerRun");

  // Validation effect for watch + download method requirement
  useEffect(() => {
    let error = "";

    // Check if watch can be enabled (need download methods)
    if (watchEnabled && downloadConfig && !downloadConfig.realTime && !downloadConfig.fallback) {
      error = "To enable watch, either Real-time downloading or Download Fallback must be enabled in Download Settings.";
    }

    // Check fallback account requirements if watch is enabled and fallback is being used
    if (watchEnabled && downloadConfig?.fallback && (!spotifyCredentials?.length || !deezerCredentials?.length)) {
      const missingServices: string[] = [];
      if (!spotifyCredentials?.length) missingServices.push("Spotify");
      if (!deezerCredentials?.length) missingServices.push("Deezer");
      error = `Watch with Fallback requires accounts for both services. Missing: ${missingServices.join(", ")}. Configure accounts in the Accounts tab.`;
    }

    // Validate maxItemsPerRun range (1..50)
    const mir = Number(maxItemsPerRunValue);
    if (!error && (Number.isNaN(mir) || mir < 1 || mir > 50)) {
      error = "Max items per run must be between 1 and 50.";
    }

    setValidationError(error);
  }, [watchEnabled, downloadConfig?.realTime, downloadConfig?.fallback, spotifyCredentials?.length, deezerCredentials?.length, maxItemsPerRunValue]);

  const onSubmit: SubmitHandler<WatchSettings> = (data) => {
    // Check validation before submitting
    if (data.enabled && downloadConfig && !downloadConfig.realTime && !downloadConfig.fallback) {
      setValidationError("To enable watch, either Real-time downloading or Download Fallback must be enabled in Download Settings.");
      toast.error("Validation failed: Watch requires at least one download method to be enabled in Download Settings.");
      return;
    }

    // Check fallback account requirements if enabling watch with fallback
    if (data.enabled && downloadConfig?.fallback && (!spotifyCredentials?.length || !deezerCredentials?.length)) {
      const missingServices: string[] = [];
      if (!spotifyCredentials?.length) missingServices.push("Spotify");
      if (!deezerCredentials?.length) missingServices.push("Deezer");
      const error = `Watch with Fallback requires accounts for both services. Missing: ${missingServices.join(", ")}. Configure accounts in the Accounts tab.`;
      setValidationError(error);
      toast.error("Validation failed: " + error);
      return;
    }

    // Validate maxItemsPerRun in handler too, to be safe
    const mir = Number(data.maxItemsPerRun);
    if (Number.isNaN(mir) || mir < 1 || mir > 50) {
      setValidationError("Max items per run must be between 1 and 50.");
      toast.error("Validation failed: Max items per run must be between 1 and 50.");
      return;
    }

    mutation.mutate({
      ...data,
      watchPollIntervalSeconds: Number(data.watchPollIntervalSeconds),
      maxItemsPerRun: Number(data.maxItemsPerRun),
    });
  };

  if (isLoading) {
    return <div className="text-content-muted dark:text-content-muted-dark">Loading watch settings...</div>;
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
      <div className="flex items-center justify-end mb-4">
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={mutation.isPending || !!validationError}
            className="px-4 py-2 bg-button-primary hover:bg-button-primary-hover text-button-primary-text rounded-md disabled:opacity-50"
          >
            {mutation.isPending ? "Saving..." : "Save Watch Settings"}
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-xl font-semibold text-content-primary dark:text-content-primary-dark">Watchlist Behavior</h3>
        <div className="flex items-center justify-between">
          <label htmlFor="watchEnabledToggle" className="text-content-primary dark:text-content-primary-dark">Enable Watchlist</label>
          <input id="watchEnabledToggle" type="checkbox" {...register("enabled")} className="h-6 w-6 rounded" />
        </div>

        {/* Download requirements info */}
        {downloadConfig && (!downloadConfig.realTime && !downloadConfig.fallback) && (
          <div className="p-3 bg-warning/10 border border-warning/20 rounded-lg">
            <p className="text-sm text-warning font-medium mb-1">Download methods required</p>
            <p className="text-xs text-content-muted dark:text-content-muted-dark">
              To use watch functionality, enable either Real-time downloading or Download Fallback in the Downloads tab.
            </p>
          </div>
        )}

        {/* Fallback account requirements info */}
        {downloadConfig?.fallback && (!spotifyCredentials?.length || !deezerCredentials?.length) && (
          <div className="p-3 bg-warning/10 border border-warning/20 rounded-lg">
            <p className="text-sm text-warning font-medium mb-1">Fallback accounts required</p>
            <p className="text-xs text-content-muted dark:text-content-muted-dark">
              Download Fallback is enabled but requires accounts for both Spotify and Deezer. Configure accounts in the Accounts tab.
            </p>
          </div>
        )}

        {/* Validation error display */}
        {validationError && (
          <div className="p-3 bg-error/10 border border-error/20 rounded-lg">
            <p className="text-sm text-error font-medium">{validationError}</p>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <label htmlFor="watchPollIntervalSeconds" className="text-content-primary dark:text-content-primary-dark">
            Watch Poll Interval (seconds)
          </label>
          <input
            id="watchPollIntervalSeconds"
            type="number"
            min="60"
            {...register("watchPollIntervalSeconds")}
            className="block w-full p-2 border bg-input-background dark:bg-input-background-dark border-input-border dark:border-input-border-dark rounded-md focus:outline-none focus:ring-2 focus:ring-input-focus"
          />
          <p className="text-sm text-content-muted dark:text-content-muted-dark mt-1">
            How often to check for new items in watchlist.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="maxItemsPerRun" className="text-content-primary dark:text-content-primary-dark">
            Max Items Per Run
          </label>
          <input
            id="maxItemsPerRun"
            type="number"
            min="1"
            max="50"
            {...register("maxItemsPerRun")}
            className="block w-full p-2 border bg-input-background dark:bg-input-background-dark border-input-border dark:border-input-border-dark rounded-md focus:outline-none focus:ring-2 focus:ring-input-focus"
          />
          <p className="text-sm text-content-muted dark:text-content-muted-dark mt-1">
            Batch size per watch cycle (1–50).
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-xl font-semibold text-content-primary dark:text-content-primary-dark">
          Artist Album Groups
        </h3>
        <p className="text-sm text-content-muted dark:text-content-muted-dark">
          Select which album groups to monitor for watched artists.
        </p>
        <div className="grid grid-cols-2 gap-4 pt-2">
          {ALBUM_GROUPS.map((group) => (
            <Controller
              key={group}
              name="watchedArtistAlbumGroup"
              control={control}
              render={({ field }) => (
                <label className="flex items-center gap-2 text-content-primary dark:text-content-primary-dark">
                  <input
                    type="checkbox"
                    className="h-5 w-5 rounded"
                    checked={field.value?.includes(group) ?? false}
                    onChange={(e) => {
                      const value = field.value || [];
                      const newValues = e.target.checked ? [...value, group] : value.filter((v) => v !== group);
                      field.onChange(newValues);
                    }}
                  />
                  <span className="capitalize">{group.replace("_", " ")}</span>
                </label>
              )}
            />
          ))}
        </div>
      </div>
    </form>
  );
}
