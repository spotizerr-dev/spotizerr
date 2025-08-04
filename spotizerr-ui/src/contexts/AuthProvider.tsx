import { useEffect, useState, useCallback, useRef } from "react";
import type { ReactNode } from "react";
import { AuthContext } from "./auth-context";
import { authApiClient } from "@/lib/api-client";
import type { 
  User, 
  LoginRequest, 
  RegisterRequest, 
  AuthError 
} from "@/types/auth";

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authEnabled, setAuthEnabled] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  
  // Guard to prevent multiple simultaneous initializations
  const initializingRef = useRef(false);

  const isAuthenticated = user !== null;

  // Initialize authentication on app start
  const initializeAuth = useCallback(async () => {
    // Prevent multiple simultaneous initializations
    if (initializingRef.current) {
      console.log("Authentication initialization already in progress, skipping...");
      return;
    }

    try {
      initializingRef.current = true;
      setIsLoading(true);
      console.log("Initializing authentication...");

      // Check if we have a stored token first, before making any API calls
      const hasStoredToken = authApiClient.getToken() !== null;
      console.log("Has stored token:", hasStoredToken);

      if (hasStoredToken) {
        // If we have a stored token, validate it first
        console.log("Validating stored token...");
        const tokenValidation = await authApiClient.validateStoredToken();
        
        if (tokenValidation.isValid && tokenValidation.userData) {
          // Token is valid and we have user data
          setAuthEnabled(tokenValidation.userData.auth_enabled);
          if (tokenValidation.userData.authenticated && tokenValidation.userData.user) {
            setUser(tokenValidation.userData.user);
            console.log("Session restored for user:", tokenValidation.userData.user.username);
            setIsInitialized(true);
            return;
          } else {
            setUser(null);
            console.log("Token valid but no user data");
          }
        } else {
          setUser(null);
          console.log("Stored token is invalid, cleared");
        }
      }

      // If no stored token or token validation failed, check auth status without token
      console.log("Checking auth status...");
      const status = await authApiClient.checkAuthStatus();
      setAuthEnabled(status.auth_enabled);

      if (!status.auth_enabled) {
        console.log("Authentication is disabled");
        setUser(null);
        setIsInitialized(true);
        return;
      }

      // If auth is enabled but we're not authenticated, user needs to log in
      setUser(null);
      console.log("Authentication required");
      
    } catch (error: any) {
      console.error("Auth initialization failed:", error);
      setUser(null);
      // Only clear all auth data on critical initialization failures
      // Don't clear tokens due to network errors
      if (error.message?.includes("Network Error") || error.code === "ECONNABORTED") {
        console.log("Network error during auth initialization, keeping stored token");
      } else {
        authApiClient.clearAllAuthData();
      }
    } finally {
      initializingRef.current = false;
      setIsLoading(false);
      setIsInitialized(true);
      console.log("Authentication initialization complete");
    }
  }, []);

  // Initialize on mount
  useEffect(() => {
    initializeAuth();
  }, [initializeAuth]);

  // Check authentication status (for manual refresh)
  const checkAuthStatus = useCallback(async () => {
    if (!isInitialized) {
      return; // Don't check until initialized
    }

    try {
      setIsLoading(true);
      const status = await authApiClient.checkAuthStatus();
      
      setAuthEnabled(status.auth_enabled);
      
      if (status.auth_enabled && status.authenticated && status.user) {
        setUser(status.user);
      } else {
        setUser(null);
        // Clear any stale token
        if (authApiClient.getToken()) {
          authApiClient.clearToken();
        }
      }
    } catch (error) {
      console.error("Auth status check failed:", error);
      setUser(null);
      authApiClient.clearToken();
    } finally {
      setIsLoading(false);
    }
  }, [isInitialized]);

  // Login function with remember me option
  const login = async (credentials: LoginRequest, rememberMe: boolean = true): Promise<void> => {
    try {
      setIsLoading(true);
      const response = await authApiClient.login(credentials, rememberMe);
      setUser(response.user);
      console.log(`User logged in: ${response.user.username} (remember: ${rememberMe})`);
    } catch (error: any) {
      const authError: AuthError = {
        message: error.response?.data?.detail || "Login failed",
        status: error.response?.status,
      };
      throw authError;
    } finally {
      setIsLoading(false);
    }
  };

  // Register function
  const register = async (userData: RegisterRequest): Promise<void> => {
    try {
      setIsLoading(true);
      await authApiClient.register(userData);
      // Note: Registration doesn't auto-login, user needs to log in afterwards
    } catch (error: any) {
      const authError: AuthError = {
        message: error.response?.data?.detail || "Registration failed",
        status: error.response?.status,
      };
      throw authError;
    } finally {
      setIsLoading(false);
    }
  };

  // Logout function
  const logout = useCallback(async () => {
    try {
      await authApiClient.logout();
      console.log("User logged out");
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      setUser(null);
      // Don't need to call checkAuthStatus after logout since we're clearing everything
    }
  }, []);

  // Token management
  const getToken = useCallback(() => {
    return authApiClient.getToken();
  }, []);

  const setToken = useCallback((token: string | null, rememberMe: boolean = true) => {
    authApiClient.setToken(token, rememberMe);
    if (token) {
      // If we're setting a token, reinitialize to get user info
      initializeAuth();
    } else {
      setUser(null);
    }
  }, [initializeAuth]);

  // Get remember preference
  const isRemembered = useCallback(() => {
    return authApiClient.isRemembered();
  }, []);

  // Listen for storage changes (logout in another tab)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "auth_token" || e.key === "auth_remember") {
        console.log("Auth storage changed in another tab");
        // Re-initialize auth when storage changes
        initializeAuth();
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [initializeAuth]);

  // Enhanced context value with new methods
  const contextValue = {
    // State
    user,
    isAuthenticated,
    isLoading,
    authEnabled,
    
    // Actions
    login,
    register,
    logout,
    checkAuthStatus,
    
    // Token management
    getToken,
    setToken,
    
    // Session management
    isRemembered,
  };

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
} 