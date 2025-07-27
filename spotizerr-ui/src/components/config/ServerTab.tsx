import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import apiClient from "../../lib/api-client";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// --- Type Definitions ---
interface SpotifyApiSettings {
  client_id: string;
  client_secret: string;
}

interface WebhookSettings {
  url: string;
  events: string[];
  available_events: string[]; // Provided by API, not saved
}

// --- API Functions ---
const fetchSpotifyApiConfig = async (): Promise<SpotifyApiSettings> => {
  const { data } = await apiClient.get("/credentials/spotify_api_config");
  return data;
};
const saveSpotifyApiConfig = (data: SpotifyApiSettings) => apiClient.put("/credentials/spotify_api_config", data);

const fetchWebhookConfig = async (): Promise<WebhookSettings> => {
  // Mock a response since backend endpoint doesn't exist
  // This will prevent the UI from crashing.
  return Promise.resolve({
    url: "",
    events: [],
    available_events: ["download_start", "download_complete", "download_failed", "watch_added"],
  });
};
const saveWebhookConfig = (data: Partial<WebhookSettings>) => {
  toast.info("Webhook configuration is not available.");
  return Promise.resolve(data);
};
const testWebhook = (url: string) => {
  toast.info("Webhook testing is not available.");
  return Promise.resolve(url);
};

// --- Components ---
function SpotifyApiForm() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["spotifyApiConfig"], queryFn: fetchSpotifyApiConfig });
  const { register, handleSubmit, reset } = useForm<SpotifyApiSettings>();

  const mutation = useMutation({
    mutationFn: saveSpotifyApiConfig,
    onSuccess: () => {
      toast.success("Spotify API settings saved!");
      queryClient.invalidateQueries({ queryKey: ["spotifyApiConfig"] });
    },
    onError: (e) => toast.error(`Failed to save: ${e.message}`),
  });

  useEffect(() => {
    if (data) reset(data);
  }, [data, reset]);

  const onSubmit = (formData: SpotifyApiSettings) => mutation.mutate(formData);

  if (isLoading) return <p className="text-content-muted dark:text-content-muted-dark">Loading Spotify API settings...</p>;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="flex flex-col gap-2">
        <label htmlFor="client_id" className="text-content-primary dark:text-content-primary-dark">Client ID</label>
        <input
          id="client_id"
          type="password"
          {...register("client_id")}
          className="block w-full p-2 border bg-input-background dark:bg-input-background-dark border-input-border dark:border-input-border-dark rounded-md focus:outline-none focus:ring-2 focus:ring-input-focus"
          placeholder="Optional"
        />
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="client_secret" className="text-content-primary dark:text-content-primary-dark">Client Secret</label>
        <input
          id="client_secret"
          type="password"
          {...register("client_secret")}
          className="block w-full p-2 border bg-input-background dark:bg-input-background-dark border-input-border dark:border-input-border-dark rounded-md focus:outline-none focus:ring-2 focus:ring-input-focus"
          placeholder="Optional"
        />
      </div>
      <button
        type="submit"
        disabled={mutation.isPending}
        className="px-4 py-2 bg-button-primary hover:bg-button-primary-hover text-button-primary-text rounded-md disabled:opacity-50"
      >
        {mutation.isPending ? "Saving..." : "Save Spotify API"}
      </button>
    </form>
  );
}

function WebhookForm() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["webhookConfig"], queryFn: fetchWebhookConfig });
  const { register, handleSubmit, control, reset, watch } = useForm<WebhookSettings>();
  const currentUrl = watch("url");

  const mutation = useMutation({
    mutationFn: saveWebhookConfig,
    onSuccess: () => {
      // No toast needed since the function shows one
      queryClient.invalidateQueries({ queryKey: ["webhookConfig"] });
    },
    onError: (e) => toast.error(`Failed to save: ${e.message}`),
  });

  const testMutation = useMutation({
    mutationFn: testWebhook,
    onSuccess: () => {
      // No toast needed
    },
    onError: (e) => toast.error(`Webhook test failed: ${e.message}`),
  });

  useEffect(() => {
    if (data) reset(data);
  }, [data, reset]);

  const onSubmit = (formData: WebhookSettings) => mutation.mutate(formData);

  if (isLoading) return <p className="text-content-muted dark:text-content-muted-dark">Loading Webhook settings...</p>;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div className="flex flex-col gap-2">
        <label htmlFor="webhookUrl" className="text-content-primary dark:text-content-primary-dark">Webhook URL</label>
        <input
          id="webhookUrl"
          type="url"
          {...register("url")}
          className="block w-full p-2 border bg-input-background dark:bg-input-background-dark border-input-border dark:border-input-border-dark rounded-md focus:outline-none focus:ring-2 focus:ring-input-focus"
          placeholder="https://example.com/webhook"
        />
      </div>
      <div className="flex flex-col gap-2">
        <label className="text-content-primary dark:text-content-primary-dark">Webhook Events</label>
        <div className="grid grid-cols-2 gap-4 pt-2">
          {data?.available_events.map((event) => (
            <Controller
              key={event}
              name="events"
              control={control}
              render={({ field }) => (
                <label className="flex items-center gap-2 text-content-primary dark:text-content-primary-dark">
                  <input
                    type="checkbox"
                    className="h-5 w-5 rounded"
                    checked={field.value?.includes(event) ?? false}
                    onChange={(e) => {
                      const value = field.value || [];
                      const newValues = e.target.checked ? [...value, event] : value.filter((v) => v !== event);
                      field.onChange(newValues);
                    }}
                  />
                  <span className="capitalize">{event.replace(/_/g, " ")}</span>
                </label>
              )}
            />
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={mutation.isPending}
          className="px-4 py-2 bg-button-primary hover:bg-button-primary-hover text-button-primary-text rounded-md disabled:opacity-50"
        >
          {mutation.isPending ? "Saving..." : "Save Webhook"}
        </button>
        <button
          type="button"
          onClick={() => testMutation.mutate(currentUrl)}
          disabled={!currentUrl || testMutation.isPending}
          className="px-4 py-2 bg-button-secondary hover:bg-button-secondary-hover text-button-secondary-text hover:text-button-secondary-text-hover rounded-md disabled:opacity-50"
        >
          Test
        </button>
      </div>
    </form>
  );
}

export function ServerTab() {
  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-xl font-semibold text-content-primary dark:text-content-primary-dark">Spotify API</h3>
        <p className="text-sm text-content-muted dark:text-content-muted-dark mt-1">Provide your own API credentials to avoid rate-limiting issues.</p>
        <SpotifyApiForm />
      </div>
      <hr className="border-border dark:border-border-dark" />
      <div>
        <h3 className="text-xl font-semibold text-content-primary dark:text-content-primary-dark">Webhooks</h3>
        <p className="text-sm text-content-muted dark:text-content-muted-dark mt-1">
          Get notifications for events like download completion. (Currently disabled)
        </p>
        <WebhookForm />
      </div>
    </div>
  );
}
