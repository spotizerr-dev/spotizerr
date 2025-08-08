// User and authentication types
export interface User {
  username: string;
  email?: string;
  role: "user" | "admin";
  created_at: string;
  last_login?: string;
  sso_provider?: string;
  is_sso_user?: boolean;
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
  registration_enabled: boolean;
  sso_enabled?: boolean;
  sso_providers?: string[];
}

export interface SSOProvider {
  name: string;
  display_name: string;
  enabled: boolean;
  login_url?: string;
}

export interface SSOStatusResponse {
  sso_enabled: boolean;
  providers: SSOProvider[];
  registration_enabled: boolean;
}

export interface CreateUserRequest {
  username: string;
  password: string;
  email?: string;
  role: "user" | "admin";
}

export interface PasswordChangeRequest {
  current_password: string;
  new_password: string;
}

export interface AdminPasswordResetRequest {
  new_password: string;
}

export interface AuthContextType {
  // State
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  authEnabled: boolean;
  registrationEnabled: boolean;
  ssoEnabled: boolean;
  ssoProviders: SSOProvider[];
  
  // Actions
  login: (credentials: LoginRequest, rememberMe?: boolean) => Promise<void>;
  register: (userData: RegisterRequest) => Promise<void>;
  logout: () => void;
  checkAuthStatus: () => Promise<void>;
  
  // SSO Actions
  getSSOStatus: () => Promise<SSOStatusResponse>;
  handleSSOCallback: (token: string) => Promise<void>;
  
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