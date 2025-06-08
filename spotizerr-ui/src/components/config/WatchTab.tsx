import { useEffect } from 'react';
import { useForm, type SubmitHandler, Controller } from 'react-hook-form';
import apiClient from '../../lib/api-client';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// --- Type Definitions ---
const ALBUM_GROUPS = ["album", "single", "compilation", "appears_on"] as const;

type AlbumGroup = typeof ALBUM_GROUPS[number];

interface WatchSettings {
  enabled: boolean;
  watchPollIntervalSeconds: number;
  watchedArtistAlbumGroup: AlbumGroup[];
}

// --- API Functions ---
const fetchWatchConfig = async (): Promise<WatchSettings> => {
  const { data } = await apiClient.get('/config/watch');
  return data;
};

const saveWatchConfig = async (data: Partial<WatchSettings>) => {
  const { data: response } = await apiClient.post('/config/watch', data);
  return response;
};

// --- Component ---
export function WatchTab() {
  const queryClient = useQueryClient();

  const { data: config, isLoading } = useQuery({
    queryKey: ['watchConfig'],
    queryFn: fetchWatchConfig,
  });

  const mutation = useMutation({
    mutationFn: saveWatchConfig,
    onSuccess: () => {
      toast.success('Watch settings saved successfully!');
      queryClient.invalidateQueries({ queryKey: ['watchConfig'] });
    },
    onError: (error) => {
      toast.error(`Failed to save settings: ${error.message}`);
    },
  });

  const { register, handleSubmit, control, reset } = useForm<WatchSettings>();

  useEffect(() => {
    if (config) {
      reset(config);
    }
  }, [config, reset]);

  const onSubmit: SubmitHandler<WatchSettings> = (data) => {
    mutation.mutate({
        ...data,
        watchPollIntervalSeconds: Number(data.watchPollIntervalSeconds),
    });
  };

  if (isLoading) {
    return <div>Loading watch settings...</div>;
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
        <div className="space-y-4">
            <h3 className="text-xl font-semibold">Watchlist Behavior</h3>
            <div className="flex items-center justify-between">
                <label htmlFor="watchEnabledToggle">Enable Watchlist</label>
                <input id="watchEnabledToggle" type="checkbox" {...register('enabled')} className="h-6 w-6 rounded" />
            </div>
            <div className="flex flex-col gap-2">
                <label htmlFor="watchPollIntervalSeconds">Watch Poll Interval (seconds)</label>
                <input id="watchPollIntervalSeconds" type="number" min="60" {...register('watchPollIntervalSeconds')} className="block w-full p-2 border rounded-md bg-gray-50 dark:bg-gray-800 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <p className="text-sm text-gray-500 mt-1">
                    How often to check watched items for updates.
                </p>
            </div>
        </div>

        <div className="space-y-4">
            <h3 className="text-xl font-semibold">Artist Album Groups</h3>
            <p className="text-sm text-gray-500">Select which album groups to monitor for watched artists.</p>
            <div className="grid grid-cols-2 gap-4 pt-2">
                {ALBUM_GROUPS.map((group) => (
                    <Controller
                        key={group}
                        name="watchedArtistAlbumGroup"
                        control={control}
                        render={({ field }) => (
                           <label className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    className="h-5 w-5 rounded"
                                    checked={field.value?.includes(group) ?? false}
                                    onChange={(e) => {
                                        const value = field.value || [];
                                        const newValues = e.target.checked
                                        ? [...value, group]
                                        : value.filter((v) => v !== group);
                                        field.onChange(newValues);
                                    }}
                                />
                                <span className="capitalize">{group.replace('_', ' ')}</span>
                           </label>
                        )}
                    />
                ))}
            </div>
        </div>

      <button type="submit" disabled={mutation.isPending} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50">
        {mutation.isPending ? 'Saving...' : 'Save Watch Settings'}
      </button>
    </form>
  );
}
