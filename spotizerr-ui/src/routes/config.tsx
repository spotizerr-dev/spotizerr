import { useState, useEffect } from "react";
import { GeneralTab } from "../components/config/GeneralTab";
import { DownloadsTab } from "../components/config/DownloadsTab";
import { FormattingTab } from "../components/config/FormattingTab";
import { AccountsTab } from "../components/config/AccountsTab";
import { WatchTab } from "../components/config/WatchTab";
import { ServerTab } from "../components/config/ServerTab";
import { UserManagementTab } from "../components/config/UserManagementTab";
import { useSettings } from "../contexts/settings-context";
import { useAuth } from "../contexts/auth-context";
import { LoginScreen } from "../components/auth/LoginScreen";

const ConfigComponent = () => {
  const [activeTab, setActiveTab] = useState("general");
  const { user, isAuthenticated, authEnabled, isLoading: authLoading } = useAuth();

  // Get settings from the context instead of fetching here
  const { settings: config, isLoading } = useSettings();

  // Reset to general tab if user is on user-management but auth is disabled
  useEffect(() => {
    if (!authEnabled && activeTab === "user-management") {
      setActiveTab("general");
    }
  }, [authEnabled, activeTab]);

  // Show loading while authentication is being checked
  if (authLoading) {
    return (
      <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8">
        <div className="text-center py-12">
          <p className="text-content-muted dark:text-content-muted-dark">Loading...</p>
        </div>
      </div>
    );
  }

  // Show login screen if authentication is enabled but user is not authenticated
  if (authEnabled && !isAuthenticated) {
    return (
      <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8">
        <div className="space-y-4 text-center mb-6">
          <h1 className="text-3xl font-bold text-content-primary dark:text-content-primary-dark">Configuration</h1>
          <p className="text-content-muted dark:text-content-muted-dark">Please log in to access configuration settings.</p>
        </div>
        <LoginScreen />
      </div>
    );
  }

  // Check for admin role if authentication is enabled
  if (authEnabled && isAuthenticated && user?.role !== "admin") {
    return (
      <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8">
        <div className="text-center py-12">
          <h1 className="text-3xl font-bold text-content-primary dark:text-content-primary-dark mb-4">Access Denied</h1>
          <p className="text-content-muted dark:text-content-muted-dark">
            You need administrator privileges to access configuration settings.
          </p>
          <p className="text-sm text-content-muted dark:text-content-muted-dark mt-2">
            Current role: <span className="font-medium">{user?.role || 'user'}</span>
          </p>
        </div>
      </div>
    );
  }

  const renderTabContent = () => {
    // User management doesn't need config data
    if (activeTab === "user-management") {
      return <UserManagementTab />;
    }
    
    if (isLoading) return <div className="text-center py-12"><p className="text-content-muted dark:text-content-muted-dark">Loading configuration...</p></div>;
    if (!config) return <div className="text-center py-12"><p className="text-error-text bg-error-muted p-4 rounded-lg">Error loading configuration.</p></div>;

    switch (activeTab) {
      case "general":
        return <GeneralTab config={config} isLoading={isLoading} />;
      case "downloads":
        return <DownloadsTab config={config} isLoading={isLoading} />;
      case "formatting":
        return <FormattingTab config={config} isLoading={isLoading} />;
      case "accounts":
        return <AccountsTab />;
      case "watch":
        return <WatchTab />;
      case "server":
        return <ServerTab />;
      default:
        return null;
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8 space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-content-primary dark:text-content-primary-dark">Configuration</h1>
        <p className="text-content-muted dark:text-content-muted-dark">Manage application settings and services.</p>
        {authEnabled && user && (
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            Logged in as: <span className="font-medium">{user.username}</span> ({user.role})
          </p>
        )}
      </div>

      <div className="flex flex-col lg:flex-row gap-6 lg:gap-10">
        <aside className="w-full lg:w-1/4">
          <nav className="flex flex-row lg:flex-col overflow-x-auto lg:overflow-x-visible space-x-2 lg:space-x-0 lg:space-y-2 pb-2 lg:pb-0">
            <button
              onClick={() => setActiveTab("general")}
              className={`px-4 py-3 rounded-lg text-left transition-all whitespace-nowrap ${activeTab === "general" ? "bg-surface-accent dark:bg-surface-accent-dark font-semibold text-content-primary dark:text-content-primary-dark shadow-sm" : "text-content-secondary dark:text-content-secondary-dark hover:bg-surface-muted dark:hover:bg-surface-muted-dark hover:text-content-primary dark:hover:text-content-primary-dark"}`}
            >
              General
            </button>
            <button
              onClick={() => setActiveTab("downloads")}
              className={`px-4 py-3 rounded-lg text-left transition-all whitespace-nowrap ${activeTab === "downloads" ? "bg-surface-accent dark:bg-surface-accent-dark font-semibold text-content-primary dark:text-content-primary-dark shadow-sm" : "text-content-secondary dark:text-content-secondary-dark hover:bg-surface-muted dark:hover:bg-surface-muted-dark hover:text-content-primary dark:hover:text-content-primary-dark"}`}
            >
              Downloads
            </button>
            <button
              onClick={() => setActiveTab("formatting")}
              className={`px-4 py-3 rounded-lg text-left transition-all whitespace-nowrap ${activeTab === "formatting" ? "bg-surface-accent dark:bg-surface-accent-dark font-semibold text-content-primary dark:text-content-primary-dark shadow-sm" : "text-content-secondary dark:text-content-secondary-dark hover:bg-surface-muted dark:hover:bg-surface-muted-dark hover:text-content-primary dark:hover:text-content-primary-dark"}`}
            >
              Formatting
            </button>
            <button
              onClick={() => setActiveTab("accounts")}
              className={`px-4 py-3 rounded-lg text-left transition-all whitespace-nowrap ${activeTab === "accounts" ? "bg-surface-accent dark:bg-surface-accent-dark font-semibold text-content-primary dark:text-content-primary-dark shadow-sm" : "text-content-secondary dark:text-content-secondary-dark hover:bg-surface-muted dark:hover:bg-surface-muted-dark hover:text-content-primary dark:hover:text-content-primary-dark"}`}
            >
              Accounts
            </button>
            <button
              onClick={() => setActiveTab("watch")}
              className={`px-4 py-3 rounded-lg text-left transition-all whitespace-nowrap ${activeTab === "watch" ? "bg-surface-accent dark:bg-surface-accent-dark font-semibold text-content-primary dark:text-content-primary-dark shadow-sm" : "text-content-secondary dark:text-content-secondary-dark hover:bg-surface-muted dark:hover:bg-surface-muted-dark hover:text-content-primary dark:hover:text-content-primary-dark"}`}
            >
              Watch
            </button>
            <button
              onClick={() => setActiveTab("server")}
              className={`px-4 py-3 rounded-lg text-left transition-all whitespace-nowrap ${activeTab === "server" ? "bg-surface-accent dark:bg-surface-accent-dark font-semibold text-content-primary dark:text-content-primary-dark shadow-sm" : "text-content-secondary dark:text-content-secondary-dark hover:bg-surface-muted dark:hover:bg-surface-muted-dark hover:text-content-primary dark:hover:text-content-primary-dark"}`}
            >
              Server
            </button>
            {authEnabled && (
              <button
                onClick={() => setActiveTab("user-management")}
                className={`px-4 py-3 rounded-lg text-left transition-all whitespace-nowrap ${activeTab === "user-management" ? "bg-surface-accent dark:bg-surface-accent-dark font-semibold text-content-primary dark:text-content-primary-dark shadow-sm" : "text-content-secondary dark:text-content-secondary-dark hover:bg-surface-muted dark:hover:bg-surface-muted-dark hover:text-content-primary dark:hover:text-content-primary-dark"}`}
              >
                User Management
              </button>
            )}
          </nav>
        </aside>

        <main className="w-full lg:w-3/4 bg-surface dark:bg-surface-dark rounded-xl border border-border dark:border-border-dark p-6 md:p-8 shadow-sm">
          {renderTabContent()}
        </main>
      </div>
    </div>
  );
};

export const Config = () => {
  return <ConfigComponent />;
};
