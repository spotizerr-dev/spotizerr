import { useState, useEffect, useRef, Suspense, lazy } from "react";
import { useSearch } from "@tanstack/react-router";
import { useSettings } from "../contexts/settings-context";
import { useAuth } from "../contexts/auth-context";
import { LoginScreen } from "../components/auth/LoginScreen";

// Lazy load config tab components for better code splitting
const GeneralTab = lazy(() => import("../components/config/GeneralTab").then(m => ({ default: m.GeneralTab })));
const DownloadsTab = lazy(() => import("../components/config/DownloadsTab").then(m => ({ default: m.DownloadsTab })));
const FormattingTab = lazy(() => import("../components/config/FormattingTab").then(m => ({ default: m.FormattingTab })));
const AccountsTab = lazy(() => import("../components/config/AccountsTab").then(m => ({ default: m.AccountsTab })));
const WatchTab = lazy(() => import("../components/config/WatchTab").then(m => ({ default: m.WatchTab })));
const ServerTab = lazy(() => import("../components/config/ServerTab").then(m => ({ default: m.ServerTab })));
const UserManagementTab = lazy(() => import("../components/config/UserManagementTab").then(m => ({ default: m.UserManagementTab })));
const ProfileTab = lazy(() => import("../components/config/ProfileTab").then(m => ({ default: m.ProfileTab })));

// Loading component for tab transitions
const TabLoading = () => (
  <div className="flex items-center justify-center h-64">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
  </div>
);

const ConfigComponent = () => {
  const { tab } = useSearch({ from: "/config" });
  const { user, isAuthenticated, authEnabled, isLoading: authLoading } = useAuth();
  
  // Get settings from the context instead of fetching here
  const { settings: config, isLoading } = useSettings();
  
  // Determine initial tab based on URL parameter, user role, and auth state
  const getInitialTab = () => {
    if (tab) {
      return tab; // Use URL parameter if provided
    }
    if (authEnabled && isAuthenticated && user?.role !== "admin") {
      return "profile"; // Non-admin users default to profile
    }
    return "general"; // Admin users and non-auth mode default to general
  };
  
  const [activeTab, setActiveTab] = useState(getInitialTab());
  const userHasManuallyChangedTab = useRef(false);

  // Update active tab when URL parameter changes
  useEffect(() => {
    if (tab) {
      setActiveTab(tab);
      userHasManuallyChangedTab.current = false; // Reset manual flag when URL changes
    }
  }, [tab]);

  // Handle tab clicks - track that user manually changed tab
  const handleTabChange = (newTab: string) => {
    setActiveTab(newTab);
    userHasManuallyChangedTab.current = true;
  };

  // Reset to appropriate tab based on auth state and user role (only when tab becomes invalid)
  useEffect(() => {
    // Check if current tab is invalid for current user
    const isInvalidTab = () => {
      if (!authEnabled && (activeTab === "user-management" || activeTab === "profile")) {
        return true;
      }
      if (authEnabled && user?.role !== "admin" && ["user-management", "general", "downloads", "formatting", "accounts", "watch", "server"].includes(activeTab)) {
        return true;
      }
      return false;
    };

    // Only auto-redirect if tab is invalid OR if user hasn't manually changed tabs and no URL param
    if (isInvalidTab() || (!userHasManuallyChangedTab.current && !tab)) {
      if (!authEnabled || user?.role === "admin") {
        setActiveTab("general");
      } else {
        setActiveTab("profile");
      }
      userHasManuallyChangedTab.current = false; // Reset after programmatic change
    }
  }, [authEnabled, user?.role, activeTab, tab]);

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

  // Regular users can access profile tab, but not other config tabs
  const isAdmin = user?.role === "admin";
  const canAccessAdminTabs = !authEnabled || isAdmin;

  const renderTabContent = () => {
    // User management and profile don't need config data
    if (activeTab === "user-management") {
      return (
        <Suspense fallback={<TabLoading />}>
          <UserManagementTab />
        </Suspense>
      );
    }
    
    if (activeTab === "profile") {
      return (
        <Suspense fallback={<TabLoading />}>
          <ProfileTab />
        </Suspense>
      );
    }
    
    if (isLoading) return <div className="text-center py-12"><p className="text-content-muted dark:text-content-muted-dark">Loading configuration...</p></div>;
    if (!config) return <div className="text-center py-12"><p className="text-error-text bg-error-muted p-4 rounded-lg">Error loading configuration.</p></div>;

    switch (activeTab) {
      case "general":
        return (
          <Suspense fallback={<TabLoading />}>
            <GeneralTab config={config} isLoading={isLoading} />
          </Suspense>
        );
      case "downloads":
        return (
          <Suspense fallback={<TabLoading />}>
            <DownloadsTab config={config} isLoading={isLoading} />
          </Suspense>
        );
      case "formatting":
        return (
          <Suspense fallback={<TabLoading />}>
            <FormattingTab config={config} isLoading={isLoading} />
          </Suspense>
        );
      case "accounts":
        return (
          <Suspense fallback={<TabLoading />}>
            <AccountsTab />
          </Suspense>
        );
      case "watch":
        return (
          <Suspense fallback={<TabLoading />}>
            <WatchTab />
          </Suspense>
        );
      case "server":
        return (
          <Suspense fallback={<TabLoading />}>
            <ServerTab />
          </Suspense>
        );
      default:
        return null;
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8 space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-content-primary dark:text-content-primary-dark">
          {authEnabled && !isAdmin ? "Profile Settings" : "Configuration"}
        </h1>
        <p className="text-content-muted dark:text-content-muted-dark">
          {authEnabled && !isAdmin 
            ? "Manage your profile and account settings." 
            : "Manage application settings and services."}
        </p>
        {authEnabled && user && (
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            Logged in as: <span className="font-medium">{user.username}</span> ({user.role})
          </p>
        )}
      </div>

      <div className="flex flex-col lg:flex-row gap-6 lg:gap-10">
        <aside className="w-full lg:w-1/4">
          <nav className="flex flex-row lg:flex-col overflow-x-auto lg:overflow-x-visible space-x-2 lg:space-x-0 lg:space-y-2 pb-2 lg:pb-0">
            {/* Profile tab - available to all authenticated users */}
            {authEnabled && isAuthenticated && (
              <button
                onClick={() => handleTabChange("profile")}
                className={`px-4 py-3 rounded-lg text-left transition-all whitespace-nowrap ${activeTab === "profile" ? "bg-surface-accent dark:bg-surface-accent-dark font-semibold text-content-primary dark:text-content-primary-dark shadow-sm" : "text-content-secondary dark:text-content-secondary-dark hover:bg-surface-muted dark:hover:bg-surface-muted-dark hover:text-content-primary dark:hover:text-content-primary-dark"}`}
              >
                Profile
              </button>
            )}
            
            {/* Admin-only tabs */}
            {canAccessAdminTabs && (
              <>
                <button
                  onClick={() => handleTabChange("general")}
                  className={`px-4 py-3 rounded-lg text-left transition-all whitespace-nowrap ${activeTab === "general" ? "bg-surface-accent dark:bg-surface-accent-dark font-semibold text-content-primary dark:text-content-primary-dark shadow-sm" : "text-content-secondary dark:text-content-secondary-dark hover:bg-surface-muted dark:hover:bg-surface-muted-dark hover:text-content-primary dark:hover:text-content-primary-dark"}`}
                >
                  General
                </button>
                <button
                  onClick={() => handleTabChange("downloads")}
                  className={`px-4 py-3 rounded-lg text-left transition-all whitespace-nowrap ${activeTab === "downloads" ? "bg-surface-accent dark:bg-surface-accent-dark font-semibold text-content-primary dark:text-content-primary-dark shadow-sm" : "text-content-secondary dark:text-content-secondary-dark hover:bg-surface-muted dark:hover:bg-surface-muted-dark hover:text-content-primary dark:hover:text-content-primary-dark"}`}
                >
                  Downloads
                </button>
                <button
                  onClick={() => handleTabChange("formatting")}
                  className={`px-4 py-3 rounded-lg text-left transition-all whitespace-nowrap ${activeTab === "formatting" ? "bg-surface-accent dark:bg-surface-accent-dark font-semibold text-content-primary dark:text-content-primary-dark shadow-sm" : "text-content-secondary dark:text-content-secondary-dark hover:bg-surface-muted dark:hover:bg-surface-muted-dark hover:text-content-primary dark:hover:text-content-primary-dark"}`}
                >
                  Formatting
                </button>
                <button
                  onClick={() => handleTabChange("accounts")}
                  className={`px-4 py-3 rounded-lg text-left transition-all whitespace-nowrap ${activeTab === "accounts" ? "bg-surface-accent dark:bg-surface-accent-dark font-semibold text-content-primary dark:text-content-primary-dark shadow-sm" : "text-content-secondary dark:text-content-secondary-dark hover:bg-surface-muted dark:hover:bg-surface-muted-dark hover:text-content-primary dark:hover:text-content-primary-dark"}`}
                >
                  Accounts
                </button>
                <button
                  onClick={() => handleTabChange("watch")}
                  className={`px-4 py-3 rounded-lg text-left transition-all whitespace-nowrap ${activeTab === "watch" ? "bg-surface-accent dark:bg-surface-accent-dark font-semibold text-content-primary dark:text-content-primary-dark shadow-sm" : "text-content-secondary dark:text-content-secondary-dark hover:bg-surface-muted dark:hover:bg-surface-muted-dark hover:text-content-primary dark:hover:text-content-primary-dark"}`}
                >
                  Watch
                </button>
                <button
                  onClick={() => handleTabChange("server")}
                  className={`px-4 py-3 rounded-lg text-left transition-all whitespace-nowrap ${activeTab === "server" ? "bg-surface-accent dark:bg-surface-accent-dark font-semibold text-content-primary dark:text-content-primary-dark shadow-sm" : "text-content-secondary dark:text-content-secondary-dark hover:bg-surface-muted dark:hover:bg-surface-muted-dark hover:text-content-primary dark:hover:text-content-primary-dark"}`}
                >
                  Server
                </button>
              </>
            )}
            
            {/* User Management tab - admin only */}
            {authEnabled && isAdmin && (
              <button
                onClick={() => handleTabChange("user-management")}
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
