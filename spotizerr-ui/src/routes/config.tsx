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
    if (isLoading) return <p className="text-center">Loading configuration...</p>;
    if (!config) return <p className="text-center text-red-500">Error loading configuration.</p>;

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
        <h1 className="text-3xl font-bold">Configuration</h1>
        <p className="text-gray-500">Manage application settings and services.</p>
      </div>

      <div className="flex gap-8">
        <aside className="w-1/4">
          <nav className="flex flex-col space-y-1">
            <button
              onClick={() => setActiveTab("general")}
              className={`p-2 rounded-md text-left ${activeTab === "general" ? "bg-gray-100 dark:bg-gray-800 font-semibold" : ""}`}
            >
              General
            </button>
            <button
              onClick={() => setActiveTab("downloads")}
              className={`p-2 rounded-md text-left ${activeTab === "downloads" ? "bg-gray-100 dark:bg-gray-800 font-semibold" : ""}`}
            >
              Downloads
            </button>
            <button
              onClick={() => setActiveTab("formatting")}
              className={`p-2 rounded-md text-left ${activeTab === "formatting" ? "bg-gray-100 dark:bg-gray-800 font-semibold" : ""}`}
            >
              Formatting
            </button>
            <button
              onClick={() => setActiveTab("accounts")}
              className={`p-2 rounded-md text-left ${activeTab === "accounts" ? "bg-gray-100 dark:bg-gray-800 font-semibold" : ""}`}
            >
              Accounts
            </button>
            <button
              onClick={() => setActiveTab("watch")}
              className={`p-2 rounded-md text-left ${activeTab === "watch" ? "bg-gray-100 dark:bg-gray-800 font-semibold" : ""}`}
            >
              Watch
            </button>
            <button
              onClick={() => setActiveTab("server")}
              className={`p-2 rounded-md text-left ${activeTab === "server" ? "bg-gray-100 dark:bg-gray-800 font-semibold" : ""}`}
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
