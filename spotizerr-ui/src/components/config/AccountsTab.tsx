import { useState } from "react";
import { useForm, type SubmitHandler } from "react-hook-form";
import apiClient from "../../lib/api-client";
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
  const { data } = await apiClient.get<string[]>(`/credentials/${service}`);
  return data.map((name) => ({ name }));
};

const addCredential = async ({ service, data }: { service: Service; data: AccountFormData }) => {
  const payload =
    service === "spotify"
      ? { blob_content: data.authBlob, region: data.accountRegion }
      : { arl: data.arl, region: data.accountRegion };

  const { data: response } = await apiClient.post(`/credentials/${service}/${data.accountName}`, payload);
  return response;
};

const deleteCredential = async ({ service, name }: { service: Service; name: string }) => {
  const { data: response } = await apiClient.delete(`/credentials/${service}/${name}`);
  return response;
};

// --- Component ---
export function AccountsTab() {
  const queryClient = useQueryClient();
  const [activeService, setActiveService] = useState<Service>("spotify");
  const [isAdding, setIsAdding] = useState(false);

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
      reset();
    },
    onError: (error) => {
      toast.error(`Failed to add account: ${error.message}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCredential,
    onSuccess: (_, variables) => {
      toast.success(`Account "${variables.name}" deleted.`);
      queryClient.invalidateQueries({ queryKey: ["credentials", activeService] });
    },
    onError: (error) => {
      toast.error(`Failed to delete account: ${error.message}`);
    },
  });

  const onSubmit: SubmitHandler<AccountFormData> = (data) => {
    addMutation.mutate({ service: activeService, data });
  };

  const renderAddForm = () => (
    <form onSubmit={handleSubmit(onSubmit)} className="p-4 border rounded-lg mt-4 space-y-4">
      <h4 className="font-semibold">Add New {activeService === "spotify" ? "Spotify" : "Deezer"} Account</h4>
      <div className="flex flex-col gap-2">
        <label htmlFor="accountName">Account Name</label>
        <input
          id="accountName"
          {...register("accountName", { required: "This field is required" })}
          className="block w-full p-2 border rounded-md bg-gray-50 dark:bg-gray-800 dark:border-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {errors.accountName && <p className="text-red-500 text-sm">{errors.accountName.message}</p>}
      </div>
      {activeService === "spotify" && (
        <div className="flex flex-col gap-2">
          <label htmlFor="authBlob">Auth Blob (JSON)</label>
          <textarea
            id="authBlob"
            {...register("authBlob", { required: activeService === "spotify" ? "Auth Blob is required" : false })}
            className="block w-full p-2 border rounded-md bg-gray-50 dark:bg-gray-800 dark:border-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={4}
          ></textarea>
          {errors.authBlob && <p className="text-red-500 text-sm">{errors.authBlob.message}</p>}
        </div>
      )}
      {activeService === "deezer" && (
        <div className="flex flex-col gap-2">
          <label htmlFor="arl">ARL Token</label>
          <input
            id="arl"
            {...register("arl", { required: activeService === "deezer" ? "ARL is required" : false })}
            className="block w-full p-2 border rounded-md bg-gray-50 dark:bg-gray-800 dark:border-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {errors.arl && <p className="text-red-500 text-sm">{errors.arl.message}</p>}
        </div>
      )}
      <div className="flex flex-col gap-2">
        <label htmlFor="accountRegion">Region (Optional)</label>
        <input
          id="accountRegion"
          {...register("accountRegion")}
          placeholder="e.g. US, GB"
          className="block w-full p-2 border rounded-md bg-gray-50 dark:bg-gray-800 dark:border-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={addMutation.isPending}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {addMutation.isPending ? "Saving..." : "Save Account"}
        </button>
        <button
          type="button"
          onClick={() => setIsAdding(false)}
          className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
        >
          Cancel
        </button>
      </div>
    </form>
  );

  return (
    <div className="space-y-6">
      <div className="flex gap-2 border-b">
        <button
          onClick={() => setActiveService("spotify")}
          className={`p-2 ${activeService === "spotify" ? "border-b-2 border-blue-500 font-semibold" : ""}`}
        >
          Spotify
        </button>
        <button
          onClick={() => setActiveService("deezer")}
          className={`p-2 ${activeService === "deezer" ? "border-b-2 border-blue-500 font-semibold" : ""}`}
        >
          Deezer
        </button>
      </div>

      {isLoading ? (
        <p>Loading accounts...</p>
      ) : (
        <div className="space-y-2">
          {credentials?.map((cred) => (
            <div
              key={cred.name}
              className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white rounded-md"
            >
              <span>{cred.name}</span>
              <button
                onClick={() => deleteMutation.mutate({ service: activeService, name: cred.name })}
                disabled={deleteMutation.isPending && deleteMutation.variables?.name === cred.name}
                className="text-red-500 hover:text-red-400"
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
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          Add Account
        </button>
      )}
      {isAdding && renderAddForm()}
    </div>
  );
}
