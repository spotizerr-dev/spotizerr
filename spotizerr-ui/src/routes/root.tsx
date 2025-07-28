import { Outlet, Link } from "@tanstack/react-router";
import { QueueProvider } from "@/contexts/QueueProvider";
import { SettingsProvider } from "@/contexts/SettingsProvider";
import { QueueContext } from "@/contexts/queue-context";
import { Queue } from "@/components/Queue";
import { useContext } from "react";

function AppLayout() {
  const { toggleVisibility } = useContext(QueueContext) || {};

  return (
    <div className="min-h-screen bg-surface dark:bg-surface-dark text-content-primary dark:text-content-primary-dark flex flex-col">
      {/* Desktop Header */}
      <header className="hidden md:block sticky top-0 z-40 w-full border-b border-border dark:border-border-dark bg-surface-overlay dark:bg-surface-overlay-dark backdrop-blur-sm">
        <div className="container mx-auto h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center">
            <img src="/spotizerr.svg" alt="Spotizerr" className="h-8 w-auto logo" />
          </Link>
          <div className="flex items-center gap-2">
            <Link to="/watchlist" className="p-2 rounded-full hover:bg-icon-button-hover dark:hover:bg-icon-button-hover-dark">
              <img src="/binoculars.svg" alt="Watchlist" className="w-6 h-6 logo" />
            </Link>
            <Link to="/history" className="p-2 rounded-full hover:bg-icon-button-hover dark:hover:bg-icon-button-hover-dark">
              <img src="/history.svg" alt="History" className="w-6 h-6 logo" />
            </Link>
            <Link to="/config" className="p-2 rounded-full hover:bg-icon-button-hover dark:hover:bg-icon-button-hover-dark">
              <img src="/settings.svg" alt="Settings" className="w-6 h-6 logo" />
            </Link>
            <button onClick={toggleVisibility} className="p-2 rounded-full hover:bg-icon-button-hover dark:hover:bg-icon-button-hover-dark">
              <img src="/queue.svg" alt="Queue" className="w-6 h-6 logo" />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Header - Just logo/title */}
      <header className="md:hidden sticky top-0 z-40 w-full border-b border-border dark:border-border-dark bg-surface-overlay dark:bg-surface-overlay-dark backdrop-blur-sm">
        <div className="container mx-auto h-14 flex items-center justify-center">
          <Link to="/" className="flex items-center">
            <img src="/spotizerr.svg" alt="Spotizerr" className="h-8 w-auto logo" />
          </Link>
        </div>
      </header>

      {/* Main content - flex-1 to push navigation to bottom on mobile */}
      <main className="container mx-auto p-4 flex-1 pb-20 md:pb-4">
        <Outlet />
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-border dark:border-border-dark bg-surface-overlay dark:bg-surface-overlay-dark backdrop-blur-sm">
        <div className="container mx-auto h-16 flex items-center justify-around">
          <Link to="/" className="p-3 rounded-full hover:bg-icon-button-hover dark:hover:bg-icon-button-hover-dark">
            <img src="/home.svg" alt="Home" className="w-6 h-6 logo" />
          </Link>
          <Link to="/watchlist" className="p-3 rounded-full hover:bg-icon-button-hover dark:hover:bg-icon-button-hover-dark">
            <img src="/binoculars.svg" alt="Watchlist" className="w-6 h-6 logo" />
          </Link>
          <Link to="/history" className="p-3 rounded-full hover:bg-icon-button-hover dark:hover:bg-icon-button-hover-dark">
            <img src="/history.svg" alt="History" className="w-6 h-6 logo" />
          </Link>
          <Link to="/config" className="p-3 rounded-full hover:bg-icon-button-hover dark:hover:bg-icon-button-hover-dark">
            <img src="/settings.svg" alt="Settings" className="w-6 h-6 logo" />
          </Link>
          <button onClick={toggleVisibility} className="p-3 rounded-full hover:bg-icon-button-hover dark:hover:bg-icon-button-hover-dark">
            <img src="/queue.svg" alt="Queue" className="w-6 h-6 logo" />
          </button>
        </div>
      </nav>

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
