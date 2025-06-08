import { useForm, type SubmitHandler } from 'react-hook-form';
import apiClient from '../../lib/api-client';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';

// --- Type Definitions ---
interface DownloadSettings {
  maxConcurrentDownloads: number;
  realTime: boolean;
  fallback: boolean;
  convertTo: 'MP3' | 'AAC' | 'OGG' | 'OPUS' | 'FLAC' | 'WAV' | 'ALAC' | '';
  bitrate: string;
  maxRetries: number;
  retryDelaySeconds: number;
  retryDelayIncrease: number;
  threads: number;
  path: string;
  skipExisting: boolean;
  m3u: boolean;
  hlsThreads: number;
}

interface DownloadsTabProps {
  config: DownloadSettings;
  isLoading: boolean;
}

const CONVERSION_FORMATS: Record<string, string[]> = {
    MP3: ['32k', '64k', '96k', '128k', '192k', '256k', '320k'],
    AAC: ['32k', '64k', '96k', '128k', '192k', '256k'],
    OGG: ['64k', '96k', '128k', '192k', '256k', '320k'],
    OPUS: ['32k', '64k', '96k', '128k', '192k', '256k'],
    FLAC: [],
    WAV: [],
    ALAC: []
};

// --- API Functions ---
const saveDownloadConfig = async (data: Partial<DownloadSettings>) => {
  const { data: response } = await apiClient.post('/config', data);
  return response;
};

// --- Component ---
export function DownloadsTab({ config, isLoading }: DownloadsTabProps) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: saveDownloadConfig,
    onSuccess: () => {
      toast.success('Download settings saved successfully!');
      queryClient.invalidateQueries({ queryKey: ['config'] });
    },
    onError: (error) => {
      toast.error(`Failed to save settings: ${error.message}`);
    },
  });

  const { register, handleSubmit, watch } = useForm<DownloadSettings>({
    values: config,
  });

  const selectedFormat = watch('convertTo');

  const onSubmit: SubmitHandler<DownloadSettings> = (data) => {
    mutation.mutate({
        ...data,
        maxConcurrentDownloads: Number(data.maxConcurrentDownloads),
        maxRetries: Number(data.maxRetries),
        retryDelaySeconds: Number(data.retryDelaySeconds),
        retryDelayIncrease: Number(data.retryDelayIncrease),
    });
  };

  if (isLoading) {
    return <div>Loading download settings...</div>;
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
      {/* Download Settings */}
      <div className="space-y-4">
        <h3 className="text-xl font-semibold">Download Behavior</h3>
        <div className="flex flex-col gap-2">
            <label htmlFor="maxConcurrentDownloads">Max Concurrent Downloads</label>
            <input id="maxConcurrentDownloads" type="number" min="1" {...register('maxConcurrentDownloads')} className="block w-full p-2 border rounded-md bg-gray-50 dark:bg-gray-800 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="flex items-center justify-between">
            <label htmlFor="realTimeToggle">Real-time downloading</label>
            <input id="realTimeToggle" type="checkbox" {...register('realTime')} className="h-6 w-6 rounded" />
        </div>
        <div className="flex items-center justify-between">
            <label htmlFor="fallbackToggle">Download Fallback</label>
            <input id="fallbackToggle" type="checkbox" {...register('fallback')} className="h-6 w-6 rounded" />
        </div>
      </div>

      {/* Conversion Settings */}
      <div className="space-y-4">
        <h3 className="text-xl font-semibold">Conversion</h3>
        <div className="flex flex-col gap-2">
            <label htmlFor="convertToSelect">Convert To Format</label>
            <select id="convertToSelect" {...register('convertTo')} className="block w-full p-2 border rounded-md bg-gray-50 dark:bg-gray-800 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">No Conversion</option>
                {Object.keys(CONVERSION_FORMATS).map(format => (
                    <option key={format} value={format}>{format}</option>
                ))}
            </select>
        </div>
        <div className="flex flex-col gap-2">
            <label htmlFor="bitrateSelect">Bitrate</label>
            <select id="bitrateSelect" {...register('bitrate')} className="block w-full p-2 border rounded-md bg-gray-50 dark:bg-gray-800 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" disabled={!selectedFormat || CONVERSION_FORMATS[selectedFormat]?.length === 0}>
                <option value="">Auto</option>
                {(CONVERSION_FORMATS[selectedFormat] || []).map(rate => (
                    <option key={rate} value={rate}>{rate}</option>
                ))}
            </select>
        </div>
      </div>

      {/* Retry Options */}
      <div className="space-y-4">
        <h3 className="text-xl font-semibold">Retries</h3>
        <div className="flex flex-col gap-2">
            <label htmlFor="maxRetries">Max Retry Attempts</label>
            <input id="maxRetries" type="number" min="0" {...register('maxRetries')} className="block w-full p-2 border rounded-md bg-gray-50 dark:bg-gray-800 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="flex flex-col gap-2">
            <label htmlFor="retryDelaySeconds">Initial Retry Delay (s)</label>
            <input id="retryDelaySeconds" type="number" min="1" {...register('retryDelaySeconds')} className="block w-full p-2 border rounded-md bg-gray-50 dark:bg-gray-800 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="flex flex-col gap-2">
            <label htmlFor="retryDelayIncrease">Retry Delay Increase (s)</label>
            <input id="retryDelayIncrease" type="number" min="0" {...register('retryDelayIncrease')} className="block w-full p-2 border rounded-md bg-gray-50 dark:bg-gray-800 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      <button type="submit" disabled={mutation.isPending} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50">
        {mutation.isPending ? 'Saving...' : 'Save Download Settings'}
      </button>
    </form>
  );
}
