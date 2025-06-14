import { useRef } from "react";
import { useForm, type SubmitHandler } from "react-hook-form";
import apiClient from "../../lib/api-client";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";

// --- Type Definitions ---
interface FormattingSettings {
  customDirFormat: string;
  customTrackFormat: string;
  tracknumPadding: boolean;
  saveCover: boolean;
  track: string;
  album: string;
  playlist: string;
  compilation: string;
}

interface FormattingTabProps {
  config: FormattingSettings;
  isLoading: boolean;
}

// --- API Functions ---
const saveFormattingConfig = async (data: Partial<FormattingSettings>) => {
  const { data: response } = await apiClient.post("/config", data);
  return response;
};

// --- Placeholders ---
const placeholders = {
  Common: {
    "%music%": "Track title",
    "%artist%": "Track artist",
    "%album%": "Album name",
    "%ar_album%": "Album artist",
    "%tracknum%": "Track number",
    "%year%": "Year of release",
  },
  Additional: {
    "%discnum%": "Disc number",
    "%date%": "Release date",
    "%genre%": "Music genre",
    "%isrc%": "ISRC",
    "%explicit%": "Explicit flag",
    "%duration%": "Track duration (s)",
  },
};

const PlaceholderSelector = ({ onSelect }: { onSelect: (value: string) => void }) => (
  <select
    onChange={(e) => onSelect(e.target.value)}
    className="block w-full p-2 border rounded-md bg-gray-50 dark:bg-gray-800 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm mt-1"
  >
    <option value="">-- Insert Placeholder --</option>
    {Object.entries(placeholders).map(([group, options]) => (
      <optgroup label={group} key={group}>
        {Object.entries(options).map(([value, label]) => (
          <option key={value} value={value}>{`${value} - ${label}`}</option>
        ))}
      </optgroup>
    ))}
  </select>
);

// --- Component ---
export function FormattingTab({ config, isLoading }: FormattingTabProps) {
  const queryClient = useQueryClient();
  const dirInputRef = useRef<HTMLInputElement | null>(null);
  const trackInputRef = useRef<HTMLInputElement | null>(null);

  const mutation = useMutation({
    mutationFn: saveFormattingConfig,
    onSuccess: () => {
      toast.success("Formatting settings saved!");
      queryClient.invalidateQueries({ queryKey: ["config"] });
    },
    onError: (error) => {
      toast.error(`Failed to save settings: ${error.message}`);
    },
  });

  const { register, handleSubmit, setValue } = useForm<FormattingSettings>({
    values: config,
  });

  // Correctly register the refs for react-hook-form while also holding a local ref.
  const { ref: dirFormatRef, ...dirFormatRest } = register("customDirFormat");
  const { ref: trackFormatRef, ...trackFormatRest } = register("customTrackFormat");

  const handlePlaceholderSelect =
    (field: "customDirFormat" | "customTrackFormat", inputRef: React.RefObject<HTMLInputElement | null>) =>
    (value: string) => {
      if (!value || !inputRef.current) return;
      const { selectionStart, selectionEnd } = inputRef.current;
      const currentValue = inputRef.current.value;
      const newValue =
        currentValue.substring(0, selectionStart ?? 0) + value + currentValue.substring(selectionEnd ?? 0);
      setValue(field, newValue);
    };

  const onSubmit: SubmitHandler<FormattingSettings> = (data) => {
    mutation.mutate(data);
  };

  if (isLoading) {
    return <div>Loading formatting settings...</div>;
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
      <div className="space-y-4">
        <h3 className="text-xl font-semibold">File Naming</h3>
        <div className="flex flex-col gap-2">
          <label htmlFor="customDirFormat">Custom Directory Format</label>
          <input
            id="customDirFormat"
            type="text"
            {...dirFormatRest}
            ref={(e) => {
              dirFormatRef(e);
              dirInputRef.current = e;
            }}
            className="block w-full p-2 border rounded-md bg-gray-50 dark:bg-gray-800 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <PlaceholderSelector onSelect={handlePlaceholderSelect("customDirFormat", dirInputRef)} />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="customTrackFormat">Custom Track Format</label>
          <input
            id="customTrackFormat"
            type="text"
            {...trackFormatRest}
            ref={(e) => {
              trackFormatRef(e);
              trackInputRef.current = e;
            }}
            className="block w-full p-2 border rounded-md bg-gray-50 dark:bg-gray-800 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <PlaceholderSelector onSelect={handlePlaceholderSelect("customTrackFormat", trackInputRef)} />
        </div>
        <div className="flex items-center justify-between">
          <label htmlFor="tracknumPaddingToggle">Track Number Padding</label>
          <input
            id="tracknumPaddingToggle"
            type="checkbox"
            {...register("tracknumPadding")}
            className="h-6 w-6 rounded"
          />
        </div>
        <div className="flex items-center justify-between">
          <label htmlFor="saveCoverToggle">Save Album Cover</label>
          <input id="saveCoverToggle" type="checkbox" {...register("saveCover")} className="h-6 w-6 rounded" />
        </div>
      </div>

      <button
        type="submit"
        disabled={mutation.isPending}
        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
      >
        {mutation.isPending ? "Saving..." : "Save Formatting Settings"}
      </button>
    </form>
  );
}
