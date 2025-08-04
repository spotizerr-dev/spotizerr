import { Outlet, Link } from "@tanstack/react-router";
import { QueueProvider } from "@/contexts/QueueProvider";
import { SettingsProvider } from "@/contexts/SettingsProvider";
import { QueueContext } from "@/contexts/queue-context";
import { Queue } from "@/components/Queue";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { UserMenu } from "@/components/auth/UserMenu";
import { useContext, useState, useEffect } from "react";
import { getTheme, toggleTheme } from "@/main";

function ThemeToggle() {
  const [currentTheme, setCurrentTheme] = useState<'light' | 'dark' | 'system'>('system');

  useEffect(() => {
    // Set initial theme
    setCurrentTheme(getTheme());
    
    // Listen for theme changes (in case they happen elsewhere)
    const handleStorageChange = () => {
      setCurrentTheme(getTheme());
    };
    
    // Listen for system theme changes that might affect our display
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemChange = () => {
      // Force a re-render when system preference changes
      // This ensures our toggle shows the correct state
      setCurrentTheme(getTheme());
    };
    
    window.addEventListener('storage', handleStorageChange);
    mediaQuery.addEventListener('change', handleSystemChange);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      mediaQuery.removeEventListener('change', handleSystemChange);
    };
  }, []);

  const handleToggle = () => {
    const newTheme = toggleTheme();
    setCurrentTheme(newTheme);
  };

  const getThemeIcon = () => {
    switch (currentTheme) {
      case 'light':
        return <img src="/light.svg" alt="Light theme" className="w-5 h-5 logo" />;
      case 'dark':
        return <img src="/dark.svg" alt="Dark theme" className="w-5 h-5 logo" />;
      default:
        return <img src="/system.svg" alt="System theme" className="w-5 h-5 logo" />;
    }
  };

  const getThemeLabel = () => {
    switch (currentTheme) {
      case 'light':
        return 'Light';
      case 'dark':
        return 'Dark';
      default:
        return 'System';
    }
  };

  return (
    <button 
      onClick={handleToggle}
      className="p-2 rounded-full hover:bg-icon-button-hover dark:hover:bg-icon-button-hover-dark flex items-center gap-1"
      title={`Current theme: ${getThemeLabel()}. Click to cycle through themes.`}
    >
      {getThemeIcon()}
      <span className="hidden sm:inline text-sm font-medium text-content-secondary dark:text-content-secondary-dark">
        {getThemeLabel()}
      </span>
    </button>
  );
}

function AppLayout() {
  const { toggleVisibility, totalTasks } = useContext(QueueContext) || {};

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface-secondary via-surface-muted to-surface-accent dark:from-surface-dark dark:via-surface-muted-dark dark:to-surface-secondary-dark text-content-primary dark:text-content-primary-dark flex flex-col">
      {/* Desktop Header */}
      <header className="hidden md:block sticky top-0 z-40 w-full border-b border-border dark:border-border-dark bg-surface-overlay dark:bg-surface-overlay-dark backdrop-blur-sm">
        <div className="container mx-auto h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center">
            <img src="/spotizerr.svg" alt="Spotizerr" className="h-8 w-auto logo" />
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <UserMenu />
            <Link to="/watchlist" className="p-2 rounded-full hover:bg-icon-button-hover dark:hover:bg-icon-button-hover-dark">
              <img src="/binoculars.svg" alt="Watchlist" className="w-6 h-6 logo" />
            </Link>
            <Link to="/history" className="p-2 rounded-full hover:bg-icon-button-hover dark:hover:bg-icon-button-hover-dark">
              <img src="/history.svg" alt="History" className="w-6 h-6 logo" />
            </Link>
            <Link to="/config" className="p-2 rounded-full hover:bg-icon-button-hover dark:hover:bg-icon-button-hover-dark">
              <img src="/settings.svg" alt="Settings" className="w-6 h-6 logo" />
            </Link>
            <button onClick={toggleVisibility} className="p-2 rounded-full hover:bg-icon-button-hover dark:hover:bg-icon-button-hover-dark relative">
              <img src="/queue.svg" alt="Queue" className="w-6 h-6 logo" />
              {(totalTasks ?? 0) > 0 && (
                <span className="absolute -top-1 -right-1 bg-primary text-white text-xs font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1.5 shadow-lg animate-pulse">
                  {(totalTasks ?? 0) > 99 ? '99+' : totalTasks}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Desktop Main Content */}
      <main className="hidden md:block container mx-auto p-4 flex-1">
        <Outlet />
      </main>

      {/* Mobile Layout Container */}
      <div className="md:hidden flex flex-col h-screen">
        {/* Mobile Header - Fixed */}
        <header className="fixed top-0 left-0 right-0 z-40 border-b border-border dark:border-border-dark bg-surface-overlay dark:bg-surface-overlay-dark backdrop-blur-sm pwa-header">
          <div className="container mx-auto h-14 flex items-center justify-between px-4">
            <Link to="/" className="flex items-center">
              <img src="/spotizerr.svg" alt="Spotizerr" className="h-8 w-auto logo" />
            </Link>
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>

        {/* Mobile Main Content - Scrollable container */}
        <main className="flex-1 overflow-y-auto mt-14 mb-16 pwa-main">
          <div className="container mx-auto p-4">
            <Outlet />
          </div>
        </main>

        {/* Mobile Bottom Navigation - Fixed */}
        <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-border dark:border-border-dark bg-surface-overlay dark:bg-surface-overlay-dark backdrop-blur-md pwa-footer">
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
            <button onClick={toggleVisibility} className="p-3 rounded-full hover:bg-icon-button-hover dark:hover:bg-icon-button-hover-dark relative">
              <img src="/queue.svg" alt="Queue" className="w-6 h-6 logo" />
              {(totalTasks ?? 0) > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-primary text-white text-xs font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1.5 shadow-lg animate-pulse">
                  {(totalTasks ?? 0) > 99 ? '99+' : totalTasks}
                </span>
              )}
            </button>
          </div>
        </nav>
      </div>

      <Queue />
    </div>
  );
}

export default function Root() {
  return (
    <SettingsProvider>
      <QueueProvider>
        <ProtectedRoute>
          <AppLayout />
        </ProtectedRoute>
      </QueueProvider>
    </SettingsProvider>
  );
}
