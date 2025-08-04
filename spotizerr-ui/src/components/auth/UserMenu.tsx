import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/contexts/auth-context";

export function UserMenu() {
  const { user, logout, authEnabled, isRemembered } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Don't render if auth is disabled or user is not logged in
  if (!authEnabled || !user) {
    return null;
  }

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  const handleLogout = async () => {
    try {
      await logout();
      setIsOpen(false);
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const sessionType = isRemembered();

  return (
    <div className="relative" ref={menuRef}>
      {/* User Avatar/Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 p-2 rounded-full hover:bg-icon-button-hover dark:hover:bg-icon-button-hover-dark transition-colors"
        title={`Logged in as ${user.username}${sessionType ? " (persistent session)" : " (session only)"}`}
      >
        <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center text-white font-medium text-sm relative">
          {user.username.charAt(0).toUpperCase()}
          {/* Session type indicator */}
          <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border border-surface dark:border-surface-dark ${
            sessionType ? "bg-green-500" : "bg-orange-500"
          }`} title={sessionType ? "Persistent session" : "Session only"} />
        </div>
        <span className="hidden sm:inline text-sm font-medium text-content-secondary dark:text-content-secondary-dark max-w-20 truncate">
          {user.username}
        </span>
        <svg 
          className={`w-4 h-4 text-content-muted dark:text-content-muted-dark transition-transform ${isOpen ? 'rotate-180' : ''}`} 
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-48 bg-surface dark:bg-surface-dark border border-border dark:border-border-dark rounded-lg shadow-xl z-50">
          <div className="p-3 border-b border-border dark:border-border-dark">
            <p className="font-medium text-content-primary dark:text-content-primary-dark">
              {user.username}
            </p>
            {user.email && (
              <p className="text-sm text-content-secondary dark:text-content-secondary-dark truncate">
                {user.email}
              </p>
            )}
            <p className="text-xs text-content-muted dark:text-content-muted-dark">
              {user.role === "admin" ? "Administrator" : "User"}
            </p>
            <div className={`text-xs mt-1 flex items-center gap-1 ${
              sessionType ? "text-green-600 dark:text-green-400" : "text-orange-600 dark:text-orange-400"
            }`}>
              <div className={`w-2 h-2 rounded-full ${sessionType ? "bg-green-500" : "bg-orange-500"}`} />
              {sessionType ? "Persistent session" : "Session only"}
            </div>
          </div>
          
          <div className="p-2">
            <button
              onClick={handleLogout}
              className="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-surface-muted dark:hover:bg-surface-muted-dark text-content-primary dark:text-content-primary-dark transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
} 