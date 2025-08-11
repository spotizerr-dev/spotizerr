import { useRef } from "react";
import { useForm, type SubmitHandler } from "react-hook-form";
import { authApiClient } from "../../lib/api-client";
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
  artistSeparator: string;
}

interface FormattingTabProps {
  config: FormattingSettings;
  isLoading: boolean;
}

// --- API Functions ---
const saveFormattingConfig = async (data: Partial<FormattingSettings>) => {
  const payload: any = { ...data };
  if (typeof data.artistSeparator !== "undefined") {
    payload.artist_separator = data.artistSeparator;
    delete payload.artistSeparator;
  }
  const { data: response } = await authApiClient.client.post("/config", payload);
  return response;
};

// --- Placeholders ---
const placeholders = {
  Common: {
    "%music%": "Track title",
    "%artist%": "Track artist (use %arist_1%, %artist_2%, etc. for selecting specific artists)",
    "%album%": "Album name",
    "%ar_album%": "Album artist (use %ar_album_1%, %ar_album_2%, etc. for selecting specific album artists)",
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
  Indexed: {
    "%ar_album_1%": "Album artist #1 (use _2, _3, ...)",
    "%artist_1%": "Track artist #1 (use _2, _3, ...)",
    "%ar_album_2%": "Album artist #2",
    "%artist_2%": "Track artist #2",
  },
};

const PlaceholderSelector = ({ onSelect }: { onSelect: (value: string) => void }) => (
  <select
    onChange={(e) => onSelect(e.target.value)}
    className="block w-full p-2 border bg-input-background dark:bg-input-background-dark border-input-border dark:border-input-border-dark rounded-md focus:outline-none focus:ring-2 focus:ring-input-focus text-sm mt-1"
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
    return <div className="text-content-muted dark:text-content-muted-dark">Loading formatting settings...</div>;
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
      <div className="space-y-4">
        <h3 className="text-xl font-semibold text-content-primary dark:text-content-primary-dark">File Naming</h3>
        <div className="flex flex-col gap-2">
          <label htmlFor="customDirFormat" className="text-content-primary dark:text-content-primary-dark">Custom Directory Format</label>
          <input
            id="customDirFormat"
            type="text"
            {...dirFormatRest}
            ref={(e) => {
              dirFormatRef(e);
              dirInputRef.current = e;
            }}
            className="block w-full p-2 border bg-input-background dark:bg-input-background-dark border-input-border dark:border-input-border-dark rounded-md focus:outline-none focus:ring-2 focus:ring-input-focus"
          />
          <PlaceholderSelector onSelect={handlePlaceholderSelect("customDirFormat", dirInputRef)} />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="customTrackFormat" className="text-content-primary dark:text-content-primary-dark">Custom Track Format</label>
          <input
            id="customTrackFormat"
            type="text"
            {...trackFormatRest}
            ref={(e) => {
              trackFormatRef(e);
              trackInputRef.current = e;
            }}
            className="block w-full p-2 border bg-input-background dark:bg-input-background-dark border-input-border dark:border-input-border-dark rounded-md focus:outline-none focus:ring-2 focus:ring-input-focus"
          />
          <PlaceholderSelector onSelect={handlePlaceholderSelect("customTrackFormat", trackInputRef)} />
        </div>
        <div className="text-sm text-content-muted dark:text-content-muted-dark">
          Tip: You can select specific artists using indexed placeholders like <code>%ar_album_1%</code> or
          <code> %artist_1%</code>. Append <code>_2</code>, <code>_3</code>, etc. to target later artists. If the index
          exceeds available artists (e.g. <code>%artist_3%</code> but a track only has two artists), the first artist is
          used as a fallback.
        </div>
        <div className="flex items-center justify-between">
          <label htmlFor="tracknumPaddingToggle" className="text-content-primary dark:text-content-primary-dark">Track Number Padding</label>
          <input
            id="tracknumPaddingToggle"
            type="checkbox"
            {...register("tracknumPadding")}
            className="h-6 w-6 rounded"
          />
        </div>
        <div className="flex items-center justify-between">
          <label htmlFor="artistSeparator" className="text-content-primary dark:text-content-primary-dark">Artist Separator</label>
          <input
            id="artistSeparator"
            type="text"
            maxLength={8}
            placeholder="; "
            {...register("artistSeparator")}
            className="block w-full p-2 border bg-input-background dark:bg-input-background-dark border-input-border dark:border-input-border-dark rounded-md focus:outline-none focus:ring-2 focus:ring-input-focus"
          />
        </div>
        <div className="flex items-center justify-between">
          <label htmlFor="saveCoverToggle" className="text-content-primary dark:text-content-primary-dark">Save Album Cover</label>
          <input id="saveCoverToggle" type="checkbox" {...register("saveCover")} className="h-6 w-6 rounded" />
        </div>
      </div>

      <button
        type="submit"
        disabled={mutation.isPending}
        className="px-4 py-2 bg-button-primary hover:bg-button-primary-hover text-button-primary-text rounded-md disabled:opacity-50"
      >
        {mutation.isPending ? "Saving..." : "Save Formatting Settings"}
      </button>
    </form>
  );
}
