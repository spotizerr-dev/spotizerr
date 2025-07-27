import { Outlet, Link } from "@tanstack/react-router";
import { QueueProvider } from "@/contexts/QueueProvider";
import { SettingsProvider } from "@/contexts/SettingsProvider";
import { QueueContext } from "@/contexts/queue-context";
import { Queue } from "@/components/Queue";
import { useContext } from "react";

function AppLayout() {
  const { toggleVisibility } = useContext(QueueContext) || {};

  return (
    <div className="min-h-screen bg-surface dark:bg-surface-dark text-content-primary dark:text-content-primary-dark">
      <header className="sticky top-0 z-40 w-full border-b border-border dark:border-border-dark bg-surface-overlay dark:bg-surface-overlay-dark backdrop-blur-sm">
        <div className="container mx-auto h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <img src="/music.svg" alt="Logo" className="w-6 h-6 icon-primary" />
            <h1 className="text-xl font-bold">Spotizerr</h1>
          </Link>
          <div className="flex items-center gap-2">
            <Link to="/watchlist" className="p-2 rounded-full hover:bg-icon-button-hover dark:hover:bg-icon-button-hover-dark">
              <img src="/binoculars.svg" alt="Watchlist" className="w-6 h-6 icon-primary" />
            </Link>
            <Link to="/history" className="p-2 rounded-full hover:bg-icon-button-hover dark:hover:bg-icon-button-hover-dark">
              <img src="/history.svg" alt="History" className="w-6 h-6 icon-primary" />
            </Link>
            <Link to="/config" className="p-2 rounded-full hover:bg-icon-button-hover dark:hover:bg-icon-button-hover-dark">
              <img src="/settings.svg" alt="Settings" className="w-6 h-6 icon-primary" />
            </Link>
            <button onClick={toggleVisibility} className="p-2 rounded-full hover:bg-icon-button-hover dark:hover:bg-icon-button-hover-dark">
              <img src="/queue.svg" alt="Queue" className="w-6 h-6 icon-primary" />
            </button>
          </div>
        </div>
      </header>

      <main className="container mx-auto p-4">
        <Outlet />
      </main>

      <Queue />
    </div>
  );
}

export default function Root() {
  return (
    <SettingsProvider>
      <QueueProvider>
        <AppLayout />
      </QueueProvider>
    </SettingsProvider>
  );
}
