import { useState } from "react";
import { useForm, type SubmitHandler } from "react-hook-form";
import { authApiClient } from "../../lib/api-client";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// --- Type Definitions ---
type Service = "spotify" | "deezer";

interface Credential {
  name: string;
}

// A single form shape with optional fields
interface AccountFormData {
  accountName: string;
  accountRegion?: string;
  authBlob?: string; // Spotify specific
  arl?: string; // Deezer specific
}

// --- API Functions ---
const fetchCredentials = async (service: Service): Promise<Credential[]> => {
  const { data } = await authApiClient.client.get<string[]>(`/credentials/${service}`);
  return data.map((name) => ({ name }));
};

const addCredential = async ({ service, data }: { service: Service; data: AccountFormData }) => {
  const payload =
    service === "spotify"
      ? { blob_content: data.authBlob, region: data.accountRegion }
      : { arl: data.arl, region: data.accountRegion };

  const { data: response } = await authApiClient.client.post(`/credentials/${service}/${data.accountName}`, payload);
  return response;
};

const deleteCredential = async ({ service, name }: { service: Service; name: string }) => {
  const { data: response } = await authApiClient.client.delete(`/credentials/${service}/${name}`);
  return response;
};

// --- Error helpers ---
function extractApiErrorMessage(error: unknown): string {
  const fallback = "Failed to add account.";
  try {
    // Axios-style error
    const anyErr: any = error as any;
    const resp = anyErr?.response;
    if (resp?.data) {
      const data = resp.data;
      if (typeof data === "string") return data;
      if (typeof data?.detail === "string") return data.detail;
      if (typeof data?.message === "string") return data.message;
      if (typeof data?.error === "string") return data.error;
    }
    if (typeof anyErr?.message === "string") return anyErr.message;
    return fallback;
  } catch {
    return fallback;
  }
}

// --- Component ---
export function AccountsTab() {
  const queryClient = useQueryClient();
  const [activeService, setActiveService] = useState<Service>("spotify");
  const [isAdding, setIsAdding] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { data: credentials, isLoading } = useQuery({
    queryKey: ["credentials", activeService],
    queryFn: () => fetchCredentials(activeService),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AccountFormData>();

  const addMutation = useMutation({
    mutationFn: addCredential,
    onSuccess: () => {
      toast.success("Account added successfully!");
      queryClient.invalidateQueries({ queryKey: ["credentials", activeService] });
      setIsAdding(false);
      setSubmitError(null);
      reset();
    },
    onError: (error) => {
      const msg = extractApiErrorMessage(error);
      setSubmitError(msg);
      toast.error(msg);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCredential,
    onSuccess: (_, variables) => {
      toast.success(`Account "${variables.name}" deleted.`);
      queryClient.invalidateQueries({ queryKey: ["credentials", activeService] });
    },
    onError: (error) => {
      const msg = extractApiErrorMessage(error);
      toast.error(msg);
    },
  });

  const onSubmit: SubmitHandler<AccountFormData> = (data) => {
    setSubmitError(null);
    addMutation.mutate({ service: activeService, data });
  };

  const renderAddForm = () => (
    <form onSubmit={handleSubmit(onSubmit)} className="p-4 border border-line dark:border-border-dark rounded-lg mt-4 space-y-4">
      <h4 className="font-semibold text-content-primary dark:text-content-primary-dark">Add New {activeService === "spotify" ? "Spotify" : "Deezer"} Account</h4>

      {submitError && (
        <div className="text-error-text bg-error-muted border border-error rounded p-2 text-sm">
          {submitError}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <label htmlFor="accountName" className="text-content-primary dark:text-content-primary-dark">Account Name</label>
        <input
          id="accountName"
          {...register("accountName", { required: "This field is required" })}
          className="block w-full p-2 border bg-input-background dark:bg-input-background-dark border-input-border dark:border-input-border-dark rounded-md focus:outline-none focus:ring-2 focus:ring-input-focus"
        />
        {errors.accountName && <p className="text-error-text bg-error-muted px-2 py-1 rounded text-sm">{errors.accountName.message}</p>}
      </div>
      {activeService === "spotify" && (
        <div className="flex flex-col gap-2">
          <label htmlFor="authBlob" className="text-content-primary dark:text-content-primary-dark">Auth Blob (JSON)</label>
          <textarea
            id="authBlob"
            {...register("authBlob", { required: activeService === "spotify" ? "Auth Blob is required" : false })}
            className="block w-full p-2 border bg-input-background dark:bg-input-background-dark border-input-border dark:border-input-border-dark rounded-md focus:outline-none focus:ring-2 focus:ring-input-focus"
            rows={4}
          ></textarea>
          {errors.authBlob && <p className="text-error-text bg-error-muted px-2 py-1 rounded text-sm">{errors.authBlob.message}</p>}
        </div>
      )}
      {activeService === "deezer" && (
        <div className="flex flex-col gap-2">
          <label htmlFor="arl" className="text-content-primary dark:text-content-primary-dark">ARL Token</label>
          <input
            id="arl"
            {...register("arl", { required: activeService === "deezer" ? "ARL is required" : false })}
            className="block w-full p-2 border bg-input-background dark:bg-input-background-dark border-input-border dark:border-input-border-dark rounded-md focus:outline-none focus:ring-2 focus:ring-input-focus"
          />
          {errors.arl && <p className="text-error-text bg-error-muted px-2 py-1 rounded text-sm">{errors.arl.message}</p>}
        </div>
      )}
      <div className="flex flex-col gap-2">
        <label htmlFor="accountRegion" className="text-content-primary dark:text-content-primary-dark">Region (Optional)</label>
        <input
          id="accountRegion"
          {...register("accountRegion")}
          placeholder="e.g. US, GB"
          className="block w-full p-2 border bg-input-background dark:bg-input-background-dark border-input-border dark:border-input-border-dark rounded-md focus:outline-none focus:ring-2 focus:ring-input-focus"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={addMutation.isPending}
          className="px-4 py-2 bg-button-primary hover:bg-button-primary-hover text-button-primary-text rounded-md disabled:opacity-50"
        >
          {addMutation.isPending ? "Saving..." : "Save Account"}
        </button>
        <button
          type="button"
          onClick={() => setIsAdding(false)}
          className="px-4 py-2 bg-button-secondary hover:bg-button-secondary-hover text-button-secondary-text hover:text-button-secondary-text-hover rounded-md"
        >
          Cancel
        </button>
      </div>
    </form>
  );

  return (
    <div className="space-y-6">
      <div className="flex gap-2 border-b border-line dark:border-border-dark">
        <button
          onClick={() => setActiveService("spotify")}
          className={`p-2 text-content-primary dark:text-content-primary-dark ${activeService === "spotify" ? "border-b-2 border-primary font-semibold" : ""}`}
        >
          Spotify
        </button>
        <button
          onClick={() => setActiveService("deezer")}
          className={`p-2 text-content-primary dark:text-content-primary-dark ${activeService === "deezer" ? "border-b-2 border-primary font-semibold" : ""}`}
        >
          Deezer
        </button>
      </div>

      {isLoading ? (
        <p className="text-content-muted dark:text-content-muted-dark">Loading accounts...</p>
      ) : (
        <div className="space-y-2">
          {credentials?.map((cred) => (
            <div
              key={cred.name}
              className="flex justify-between items-center p-3 bg-surface-muted dark:bg-surface-muted-dark text-content-primary dark:text-content-primary-dark rounded-md"
            >
              <span>{cred.name}</span>
              <button
                onClick={() => deleteMutation.mutate({ service: activeService, name: cred.name })}
                disabled={deleteMutation.isPending && deleteMutation.variables?.name === cred.name}
                className="text-error hover:text-error-hover icon-error"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}

      {!isAdding && (
        <button
          onClick={() => setIsAdding(true)}
          className="px-4 py-2 bg-button-primary hover:bg-button-primary-hover text-button-primary-text rounded-md disabled:opacity-50"
        >
          Add Account
        </button>
      )}
      {isAdding && renderAddForm()}
    </div>
  );
}
