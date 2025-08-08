import type { ReactNode } from "react";
import { useAuth } from "@/contexts/auth-context";
import { LoginScreen } from "./LoginScreen";

interface ProtectedRouteProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export function ProtectedRoute({ children, fallback }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, authEnabled } = useAuth();

  // Show loading state while checking authentication
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface dark:bg-surface-dark">
        <div className="text-center">
          <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center mb-6 mx-auto">
            <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.369 4.369 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z" />
            </svg>
          </div>
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-content-primary dark:text-content-primary-dark mb-2">
            Spotizerr
          </h2>
          <p className="text-content-secondary dark:text-content-secondary-dark">
            {authEnabled ? "Restoring your session..." : "Loading application..."}
          </p>
          <p className="text-xs text-content-muted dark:text-content-muted-dark mt-2">
            {authEnabled ? "Checking stored credentials" : "Authentication disabled"}
          </p>
        </div>
      </div>
    );
  }

  // If authentication is disabled, always show children
  if (!authEnabled) {
    return <>{children}</>;
  }

  // If authenticated, show children
  if (isAuthenticated) {
    return <>{children}</>;
  }

  // If not authenticated, show fallback or login screen
  return fallback || <LoginScreen />;
} 