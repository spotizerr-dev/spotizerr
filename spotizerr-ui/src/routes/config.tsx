import { useState } from "react";
import { GeneralTab } from "../components/config/GeneralTab";
import { DownloadsTab } from "../components/config/DownloadsTab";
import { FormattingTab } from "../components/config/FormattingTab";
import { AccountsTab } from "../components/config/AccountsTab";
import { WatchTab } from "../components/config/WatchTab";
import { ServerTab } from "../components/config/ServerTab";
import { useSettings } from "../contexts/settings-context";

const ConfigComponent = () => {
  const [activeTab, setActiveTab] = useState("general");

  // Get settings from the context instead of fetching here
  const { settings: config, isLoading } = useSettings();

  const renderTabContent = () => {
    if (isLoading) return <p className="text-center text-content-muted dark:text-content-muted-dark">Loading configuration...</p>;
    if (!config) return <p className="text-center text-error-text bg-error-muted p-2 rounded">Error loading configuration.</p>;

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
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-content-primary dark:text-content-primary-dark">Configuration</h1>
        <p className="text-content-muted dark:text-content-muted-dark">Manage application settings and services.</p>
      </div>

      <div className="flex gap-8">
        <aside className="w-1/4">
          <nav className="flex flex-col space-y-1">
            <button
              onClick={() => setActiveTab("general")}
              className={`p-2 rounded-md text-left transition-colors ${activeTab === "general" ? "bg-surface-accent dark:bg-surface-accent-dark font-semibold text-content-primary dark:text-content-primary-dark" : "text-content-secondary dark:text-content-secondary-dark hover:bg-surface-muted dark:hover:bg-surface-muted-dark"}`}
            >
              General
            </button>
            <button
              onClick={() => setActiveTab("downloads")}
              className={`p-2 rounded-md text-left transition-colors ${activeTab === "downloads" ? "bg-surface-accent dark:bg-surface-accent-dark font-semibold text-content-primary dark:text-content-primary-dark" : "text-content-secondary dark:text-content-secondary-dark hover:bg-surface-muted dark:hover:bg-surface-muted-dark"}`}
            >
              Downloads
            </button>
            <button
              onClick={() => setActiveTab("formatting")}
              className={`p-2 rounded-md text-left transition-colors ${activeTab === "formatting" ? "bg-surface-accent dark:bg-surface-accent-dark font-semibold text-content-primary dark:text-content-primary-dark" : "text-content-secondary dark:text-content-secondary-dark hover:bg-surface-muted dark:hover:bg-surface-muted-dark"}`}
            >
              Formatting
            </button>
            <button
              onClick={() => setActiveTab("accounts")}
              className={`p-2 rounded-md text-left transition-colors ${activeTab === "accounts" ? "bg-surface-accent dark:bg-surface-accent-dark font-semibold text-content-primary dark:text-content-primary-dark" : "text-content-secondary dark:text-content-secondary-dark hover:bg-surface-muted dark:hover:bg-surface-muted-dark"}`}
            >
              Accounts
            </button>
            <button
              onClick={() => setActiveTab("watch")}
              className={`p-2 rounded-md text-left transition-colors ${activeTab === "watch" ? "bg-surface-accent dark:bg-surface-accent-dark font-semibold text-content-primary dark:text-content-primary-dark" : "text-content-secondary dark:text-content-secondary-dark hover:bg-surface-muted dark:hover:bg-surface-muted-dark"}`}
            >
              Watch
            </button>
            <button
              onClick={() => setActiveTab("server")}
              className={`p-2 rounded-md text-left transition-colors ${activeTab === "server" ? "bg-surface-accent dark:bg-surface-accent-dark font-semibold text-content-primary dark:text-content-primary-dark" : "text-content-secondary dark:text-content-secondary-dark hover:bg-surface-muted dark:hover:bg-surface-muted-dark"}`}
            >
              Server
            </button>
          </nav>
        </aside>

        <main className="w-3/4">{renderTabContent()}</main>
      </div>
    </div>
  );
};

export const Config = () => {
  return <ConfigComponent />;
};
