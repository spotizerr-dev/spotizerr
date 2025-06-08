import { Outlet } from '@tanstack/react-router';
import { QueueProvider } from '../contexts/QueueProvider';
import { useQueue } from '../contexts/queue-context';
import { Queue } from '../components/Queue';
import { Link } from '@tanstack/react-router';
import { SettingsProvider } from '../contexts/SettingsProvider';
import { Toaster } from 'sonner';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Create a client
const queryClient = new QueryClient();

function AppLayout() {
  const { toggleVisibility } = useQueue();

  return (
    <>
      <div className="min-h-screen bg-background text-foreground">
        <header className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur-sm">
           <div className="container mx-auto h-14 flex items-center justify-between">
              <Link to="/" className="flex items-center gap-2">
                <img src="/music.svg" alt="Logo" className="w-6 h-6" />
                <h1 className="text-xl font-bold">Spotizerr</h1>
              </Link>
              <div className="flex items-center gap-2">
                <Link to="/watchlist" className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700">
                    <img src="/binoculars.svg" alt="Watchlist" className="w-6 h-6" />
                </Link>
                <Link to="/history" className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700">
                    <img src="/history.svg" alt="History" className="w-6 h-6" />
                </Link>
                <Link to="/config" className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700">
                    <img src="/settings.svg" alt="Settings" className="w-6 h-6" />
                </Link>
                <button onClick={toggleVisibility} className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700">
                  <img src="/queue.svg" alt="Queue" className="w-6 h-6" />
                </button>
              </div>
           </div>
        </header>
        <main className="container mx-auto px-4 py-8">
          <Outlet />
        </main>
      </div>
      <Queue />
      <Toaster richColors />
    </>
  );
}

export function Root() {
  return (
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <QueueProvider>
          <AppLayout />
        </QueueProvider>
      </SettingsProvider>
    </QueryClientProvider>
  );
}
