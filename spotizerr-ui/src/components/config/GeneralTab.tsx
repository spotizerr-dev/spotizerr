import { useForm, type SubmitHandler } from "react-hook-form";
import apiClient from "../../lib/api-client";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSettings } from "../../contexts/settings-context";
import { useEffect } from "react";

// --- Type Definitions ---
interface Credential {
  name: string;
}

interface GeneralSettings {
  service: "spotify" | "deezer";
  spotify: string;
  deezer: string;
}

interface GeneralTabProps {
  config: GeneralSettings;
  isLoading: boolean;
}

// --- API Functions ---
const fetchCredentials = async (service: "spotify" | "deezer"): Promise<Credential[]> => {
  const { data } = await apiClient.get<string[]>(`/credentials/${service}`);
  return data.map((name) => ({ name }));
};

const saveGeneralConfig = async (data: Partial<GeneralSettings>) => {
  const { data: response } = await apiClient.post("/config", data);
  return response;
};

// --- Component ---
export function GeneralTab({ config, isLoading: isConfigLoading }: GeneralTabProps) {
  const queryClient = useQueryClient();
  const { settings: globalSettings, isLoading: settingsLoading } = useSettings();

  const { data: spotifyAccounts, isLoading: spotifyLoading } = useQuery({
    queryKey: ["credentials", "spotify"],
    queryFn: () => fetchCredentials("spotify"),
  });
  const { data: deezerAccounts, isLoading: deezerLoading } = useQuery({
    queryKey: ["credentials", "deezer"],
    queryFn: () => fetchCredentials("deezer"),
  });

  const { register, handleSubmit, reset } = useForm<GeneralSettings>({
    defaultValues: config,
  });

  useEffect(() => {
    if (config) {
      reset(config);
    }
  }, [config, reset]);

  const mutation = useMutation({
    mutationFn: saveGeneralConfig,
    onSuccess: () => {
      toast.success("General settings saved!");
      queryClient.invalidateQueries({ queryKey: ["config"] });
    },
    onError: (e: Error) => toast.error(`Failed to save: ${e.message}`),
  });

  const onSubmit: SubmitHandler<GeneralSettings> = (data) => {
    mutation.mutate(data);
  };

  const isLoading = isConfigLoading || spotifyLoading || deezerLoading || settingsLoading;
  if (isLoading) return <p className="text-content-muted dark:text-content-muted-dark">Loading general settings...</p>;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
      <div className="space-y-4">
        <h3 className="text-xl font-semibold text-content-primary dark:text-content-primary-dark">Service Defaults</h3>
        <div className="flex flex-col gap-2">
          <label htmlFor="service" className="text-content-primary dark:text-content-primary-dark">Default Service</label>
          <select
            id="service"
            {...register("service")}
            className="block w-full p-2 border bg-input-background dark:bg-input-background-dark border-input-border dark:border-input-border-dark rounded-md focus:outline-none focus:ring-2 focus:ring-input-focus"
          >
            <option value="spotify">Spotify</option>
            <option value="deezer">Deezer</option>
          </select>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-xl font-semibold text-content-primary dark:text-content-primary-dark">Spotify Settings</h3>
        <div className="flex flex-col gap-2">
          <label htmlFor="spotifyAccount" className="text-content-primary dark:text-content-primary-dark">Active Spotify Account</label>
          <select
            id="spotifyAccount"
            {...register("spotify")}
            className="block w-full p-2 border bg-input-background dark:bg-input-background-dark border-input-border dark:border-input-border-dark rounded-md focus:outline-none focus:ring-2 focus:ring-input-focus"
          >
            {spotifyAccounts?.map((acc) => (
              <option key={acc.name} value={acc.name}>
                {acc.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-xl font-semibold text-content-primary dark:text-content-primary-dark">Deezer Settings</h3>
        <div className="flex flex-col gap-2">
          <label htmlFor="deezerAccount" className="text-content-primary dark:text-content-primary-dark">Active Deezer Account</label>
          <select
            id="deezerAccount"
            {...register("deezer")}
            className="block w-full p-2 border bg-input-background dark:bg-input-background-dark border-input-border dark:border-input-border-dark rounded-md focus:outline-none focus:ring-2 focus:ring-input-focus"
          >
            {deezerAccounts?.map((acc) => (
              <option key={acc.name} value={acc.name}>
                {acc.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-xl font-semibold text-content-primary dark:text-content-primary-dark">Content Filters</h3>
        <div className="form-item--row">
          <label className="text-content-primary dark:text-content-primary-dark">Filter Explicit Content</label>
          <div className="flex items-center gap-2">
            <span className={`font-semibold ${globalSettings?.explicitFilter ? "text-success" : "text-error"}`}>
              {globalSettings?.explicitFilter ? "Enabled" : "Disabled"}
            </span>
            <span className="text-xs bg-surface-accent dark:bg-surface-accent-dark text-content-inverse dark:text-content-inverse-dark px-2 py-1 rounded-full">ENV</span>
          </div>
        </div>
        <p className="text-sm text-content-muted dark:text-content-muted-dark mt-1">
          The explicit content filter is controlled by an environment variable and cannot be changed here.
        </p>
      </div>

      <button
        type="submit"
        disabled={mutation.isPending}
        className="px-4 py-2 bg-button-primary hover:bg-button-primary-hover text-button-primary-text rounded-md disabled:opacity-50"
      >
        {mutation.isPending ? "Saving..." : "Save General Settings"}
      </button>
    </form>
  );
}
