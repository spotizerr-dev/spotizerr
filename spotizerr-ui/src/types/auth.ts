// User and authentication types
export interface User {
  username: string;
  email?: string;
  role: "user" | "admin";
  created_at: string;
  last_login?: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  password: string;
  email?: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface AuthStatusResponse {
  auth_enabled: boolean;
  authenticated: boolean;
  user?: User;
}

export interface AuthContextType {
  // State
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  authEnabled: boolean;
  
  // Actions
  login: (credentials: LoginRequest, rememberMe?: boolean) => Promise<void>;
  register: (userData: RegisterRequest) => Promise<void>;
  logout: () => void;
  checkAuthStatus: () => Promise<void>;
  
  // Token management
  getToken: () => string | null;
  setToken: (token: string | null, rememberMe?: boolean) => void;
  
  // Session management
  isRemembered: () => boolean;
}

export interface AuthError {
  message: string;
  status?: number;
} 