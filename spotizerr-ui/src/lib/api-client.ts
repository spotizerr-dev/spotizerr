import axios from "axios";
import type { AxiosInstance } from "axios";
import { toast } from "sonner";
import type { 
  LoginRequest, 
  RegisterRequest, 
  LoginResponse, 
  AuthStatusResponse, 
  User,
  CreateUserRequest,
  SSOStatusResponse
} from "@/types/auth";

class AuthApiClient {
  private apiClient: AxiosInstance;
  private token: string | null = null;
  private isCheckingToken: boolean = false;

  constructor() {
    this.apiClient = axios.create({
      baseURL: "/api",
      headers: {
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });

    // Load token from storage on initialization
    this.loadTokenFromStorage();

    // Request interceptor to add auth token
    this.apiClient.interceptors.request.use(
      (config) => {
        if (this.token) {
          config.headers.Authorization = `Bearer ${this.token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor for error handling
    this.apiClient.interceptors.response.use(
      (response) => {
        const contentType = response.headers["content-type"];
        if (contentType && contentType.includes("application/json")) {
          return response;
        }
        const error = new Error("Invalid response type. Expected JSON.");
        toast.error("API Error", {
          description: "Received an invalid response from the server.",
        });
        return Promise.reject(error);
      },
      (error) => {
        // Handle authentication errors
        if (error.response?.status === 401) {
          // Only clear token for auth-related endpoints
          const requestUrl = error.config?.url || "";
          const isAuthEndpoint = requestUrl.includes("/auth/") || requestUrl.endsWith("/auth");
          
          if (isAuthEndpoint) {
            // Clear invalid token only for auth endpoints
            this.clearToken();
            
            // Only show auth error if auth is enabled and not during initial token check
            if (error.response?.data?.auth_enabled && !this.isCheckingToken) {
              toast.error("Session Expired", {
                description: "Please log in again to continue.",
              });
            }
          } else {
            // For non-auth endpoints, just log the 401 but don't clear token
            // The token might still be valid for auth endpoints
            console.log(`401 error on non-auth endpoint: ${requestUrl}`);
          }
        } else if (error.response?.status === 403) {
          toast.error("Access Denied", {
            description: "You don't have permission to perform this action.",
          });
        } else if (error.code === "ECONNABORTED") {
          toast.error("Request Timed Out", {
            description: "The server did not respond in time. Please try again later.",
          });
        } else {
          const errorMessage = error.response?.data?.detail || 
                              error.response?.data?.error || 
                              error.message || 
                              "An unknown error occurred.";
          
          // Don't show toast errors during token validation
          if (!this.isCheckingToken) {
            toast.error("API Error", {
              description: errorMessage,
            });
          }
        }
        return Promise.reject(error);
      }
    );
  }

  // Enhanced token management with storage options
  setToken(token: string | null, rememberMe: boolean = true) {
    this.token = token;
    
    if (token) {
      if (rememberMe) {
        // Store in localStorage for persistence across browser sessions
        localStorage.setItem("auth_token", token);
        localStorage.setItem("auth_remember", "true");
        sessionStorage.removeItem("auth_token"); // Clear from session storage
      } else {
        // Store in sessionStorage for current session only
        sessionStorage.setItem("auth_token", token);
        localStorage.removeItem("auth_token"); // Clear from persistent storage
        localStorage.removeItem("auth_remember");
      }
    } else {
      // Clear all storage
      localStorage.removeItem("auth_token");
      localStorage.removeItem("auth_remember");
      sessionStorage.removeItem("auth_token");
    }
  }

  getToken(): string | null {
    return this.token;
  }

  isRemembered(): boolean {
    return localStorage.getItem("auth_remember") === "true";
  }

  private loadTokenFromStorage() {
    // Try localStorage first (persistent)
    let token = localStorage.getItem("auth_token");
    let isRemembered = localStorage.getItem("auth_remember") === "true";
    
    // If not found in localStorage, try sessionStorage
    if (!token) {
      token = sessionStorage.getItem("auth_token");
      isRemembered = false;
    }
    
    if (token) {
      this.token = token;
      console.log(`Loaded ${isRemembered ? 'persistent' : 'session'} token from storage`);
    }
  }

  clearToken() {
    // Preserve the remember me preference when clearing invalid tokens
    const wasRemembered = this.isRemembered();
    this.token = null;
    
    if (wasRemembered) {
      // Keep the remember preference but remove the invalid token
      localStorage.removeItem("auth_token");
      // Keep auth_remember flag for next login
    } else {
      // Session-only token, clear everything
      sessionStorage.removeItem("auth_token");
      localStorage.removeItem("auth_token");
      localStorage.removeItem("auth_remember");
    }
  }

  clearAllAuthData() {
    // Use this method for complete logout - clears everything
    this.token = null;
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_remember");
    sessionStorage.removeItem("auth_token");
  }

  // Enhanced token validation that returns detailed information
  async validateStoredToken(): Promise<{ isValid: boolean; userData?: AuthStatusResponse }> {
    if (!this.token) {
      return { isValid: false };
    }

    try {
      this.isCheckingToken = true;
      const response = await this.apiClient.get<AuthStatusResponse>("/auth/status");
      
      // If the token is valid and user is authenticated
      if (response.data.auth_enabled && response.data.authenticated && response.data.user) {
        console.log("Stored token is valid, user authenticated");
        return { isValid: true, userData: response.data };
      } else {
        console.log("Stored token is invalid or user not authenticated");
        this.clearToken();
        return { isValid: false };
      }
    } catch (error) {
      console.log("Token validation failed:", error);
      this.clearToken();
      return { isValid: false };
    } finally {
      this.isCheckingToken = false;
    }
  }

  // Auth API methods
  async checkAuthStatus(): Promise<AuthStatusResponse> {
    const response = await this.apiClient.get<AuthStatusResponse>("/auth/status");
    return response.data;
  }

  async login(credentials: LoginRequest, rememberMe: boolean = true): Promise<LoginResponse> {
    const response = await this.apiClient.post<LoginResponse>("/auth/login", credentials);
    const loginData = response.data;
    
    // Store the token with remember preference
    this.setToken(loginData.access_token, rememberMe);
    
    toast.success("Login Successful", {
      description: `Welcome back, ${loginData.user.username}!`,
    });
    
    return loginData;
  }

  async register(userData: RegisterRequest): Promise<{ message: string }> {
    const response = await this.apiClient.post("/auth/register", userData);
    
    toast.success("Registration Successful", {
      description: "Account created successfully! You can now log in.",
    });
    
    return response.data;
  }

  async logout(): Promise<void> {
    try {
      await this.apiClient.post("/auth/logout");
    } catch (error) {
      // Ignore logout errors - clear token anyway
      console.warn("Logout request failed:", error);
    }
    
    this.clearAllAuthData(); // Changed from this.clearToken()
    
    toast.success("Logged Out", {
      description: "You have been logged out successfully.",
    });
  }

  async getCurrentUser(): Promise<User> {
    const response = await this.apiClient.get<User>("/auth/profile");
    return response.data;
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<{ message: string }> {
    const response = await this.apiClient.put("/auth/profile/password", {
      current_password: currentPassword,
      new_password: newPassword,
    });
    
    toast.success("Password Changed", {
      description: "Your password has been updated successfully.",
    });
    
    return response.data;
  }

  // Admin methods
  async listUsers(): Promise<User[]> {
    const response = await this.apiClient.get<User[]>("/auth/users");
    return response.data;
  }

  async deleteUser(username: string): Promise<{ message: string }> {
    const response = await this.apiClient.delete(`/auth/users/${username}`);
    
    toast.success("User Deleted", {
      description: `User ${username} has been deleted.`,
    });
    
    return response.data;
  }

  async updateUserRole(username: string, role: "user" | "admin"): Promise<{ message: string }> {
    const response = await this.apiClient.put(`/auth/users/${username}/role`, { role });
    
    toast.success("Role Updated", {
      description: `User ${username} role updated to ${role}.`,
    });
    
    return response.data;
  }

  async createUser(userData: CreateUserRequest): Promise<{ message: string }> {
    const response = await this.apiClient.post("/auth/users/create", userData);
    
    toast.success("User Created", {
      description: `User ${userData.username} created successfully.`,
    });
    
    return response.data;
  }

  // SSO methods
  async getSSOStatus(): Promise<SSOStatusResponse> {
    const response = await this.apiClient.get<SSOStatusResponse>("/auth/sso/status");
    return response.data;
  }

  // Handle SSO callback token (when user returns from OAuth provider)
  async handleSSOToken(token: string, rememberMe: boolean = true): Promise<User> {
    // Set the token and get user info
    this.setToken(token, rememberMe);
    
    // Validate the token and get user data
    const tokenValidation = await this.validateStoredToken();
    if (tokenValidation.isValid && tokenValidation.userData?.user) {
      toast.success("SSO Login Successful", {
        description: `Welcome, ${tokenValidation.userData.user.username}!`,
      });
      return tokenValidation.userData.user;
    } else {
      this.clearToken();
      throw new Error("Invalid SSO token");
    }
  }

  // Get SSO login URLs (these redirect to OAuth provider)
  getSSOLoginUrl(provider: string): string {
    return `/api/auth/sso/login/${provider}`;
  }

  // Expose the underlying axios instance for other API calls
  get client() {
    return this.apiClient;
  }
}

// Create and export a singleton instance
export const authApiClient = new AuthApiClient();

// Export the client as default for backward compatibility
export default authApiClient.client; 