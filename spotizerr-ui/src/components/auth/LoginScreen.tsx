import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "sonner";
import type { LoginRequest, RegisterRequest, AuthError } from "@/types/auth";

interface LoginScreenProps {
  onSuccess?: () => void;
}

export function LoginScreen({ onSuccess }: LoginScreenProps) {
  const { login, register, isLoading, authEnabled, registrationEnabled, isRemembered, ssoEnabled, ssoProviders } = useAuth();
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [formData, setFormData] = useState({
    username: "",
    password: "",
    email: "",
    confirmPassword: "",
    rememberMe: true, // Default to true for better UX
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [ssoRegistrationError, setSSORegistrationError] = useState(false);

  // Initialize remember me checkbox with stored preference
  useEffect(() => {
    setFormData(prev => ({
      ...prev,
      rememberMe: isRemembered(),
    }));
  }, [isRemembered]);

  // Force login mode if registration is disabled
  useEffect(() => {
    if (!registrationEnabled && !isLoginMode) {
      setIsLoginMode(true);
      setErrors({});
    }
  }, [registrationEnabled, isLoginMode]);

  // Handle URL parameters (e.g., SSO errors)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const errorParam = urlParams.get('error');

    if (errorParam) {
      const decodedError = decodeURIComponent(errorParam);
      
      // Check if this is specifically a registration disabled error from SSO
      if (decodedError.includes("Registration is disabled")) {
        setSSORegistrationError(true);
      }
      
      // Show the error message
      toast.error("Authentication Error", {
        description: decodedError,
        duration: 5000, // Show for 5 seconds
      });
      
      // Clean up the URL parameter
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete('error');
      window.history.replaceState({}, '', newUrl.toString());
    }
  }, []); // Run only once on component mount

  // If auth is not enabled, don't show the login screen
  if (!authEnabled) {
    return null;
  }

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    // Username validation
    if (!formData.username.trim()) {
      newErrors.username = "Username is required";
    } else if (formData.username.length < 3) {
      newErrors.username = "Username must be at least 3 characters";
    }

    // Password validation
    if (!formData.password) {
      newErrors.password = "Password is required";
    } else if (formData.password.length < 6) {
      newErrors.password = "Password must be at least 6 characters";
    }

    // Registration-specific validation
    if (!isLoginMode) {
      if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
        newErrors.email = "Please enter a valid email address";
      }

      if (formData.password !== formData.confirmPassword) {
        newErrors.confirmPassword = "Passwords do not match";
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);
    setSSORegistrationError(false); // Clear SSO registration error when submitting
    
    try {
      if (isLoginMode) {
        const loginData: LoginRequest = {
          username: formData.username.trim(),
          password: formData.password,
        };
        await login(loginData, formData.rememberMe);
        onSuccess?.();
      } else {
        const registerData: RegisterRequest = {
          username: formData.username.trim(),
          password: formData.password,
          email: formData.email.trim() || undefined,
        };
        await register(registerData);
        
        // After successful registration, switch to login mode
        setIsLoginMode(true);
        setFormData({ ...formData, password: "", confirmPassword: "" });
        toast.success("Registration successful! Please log in.");
      }
    } catch (error) {
      const authError = error as AuthError;
      toast.error(isLoginMode ? "Login Failed" : "Registration Failed", {
        description: authError.message,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInputChange = (field: string, value: string | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (typeof value === 'string' && errors[field]) {
      setErrors(prev => ({ ...prev, [field]: "" }));
    }
    // Clear SSO registration error when user starts interacting with the form
    if (typeof value === 'string' && ssoRegistrationError) {
      setSSORegistrationError(false);
    }
  };

  const toggleMode = () => {
    // Don't allow toggling to registration if it's disabled
    if (!registrationEnabled && isLoginMode) {
      return;
    }
    
    setIsLoginMode(!isLoginMode);
    setErrors({});
    setSSORegistrationError(false); // Clear SSO registration error when switching modes
    setFormData({
      username: "",
      password: "",
      email: "",
      confirmPassword: "",
      rememberMe: formData.rememberMe, // Preserve remember me preference
    });
  };

  const handleSSOLogin = (provider: string) => {
    // Redirect to SSO login endpoint
    window.location.href = `/api/auth/sso/login/${provider}`;
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-surface to-surface-secondary dark:from-surface-dark dark:to-surface-secondary-dark p-4">
      <div className="w-full max-w-md">
        {/* Logo/Brand */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-6">
            <img src="/spotizerr.svg" alt="Spotizerr" className="h-16 w-auto logo" />
          </div>
          <h1 className="text-3xl font-bold text-content-primary dark:text-content-primary-dark">
            Spotizerr
          </h1>
          <p className="text-content-secondary dark:text-content-secondary-dark mt-2">
            {isLoginMode ? "Welcome back" : "Create your account"}
          </p>
        </div>

        {/* Form */}
        <div className="bg-surface dark:bg-surface-dark rounded-2xl shadow-xl border border-border dark:border-border-dark p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Username */}
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-content-primary dark:text-content-primary-dark mb-2">
                Username
              </label>
              <input
                id="username"
                type="text"
                value={formData.username}
                onChange={(e) => handleInputChange("username", e.target.value)}
                className={`w-full px-4 py-3 rounded-lg border transition-colors ${
                  errors.username
                    ? "border-error focus:border-error"
                    : "border-input-border dark:border-input-border-dark focus:border-primary"
                } bg-input-background dark:bg-input-background-dark text-content-primary dark:text-content-primary-dark focus:outline-none focus:ring-2 focus:ring-primary/20`}
                placeholder="Enter your username"
                disabled={isSubmitting || isLoading}
              />
              {errors.username && (
                <p className="mt-1 text-sm text-error">{errors.username}</p>
              )}
            </div>

            {/* Email (Registration only) */}
            {!isLoginMode && (
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-content-primary dark:text-content-primary-dark mb-2">
                  Email (optional)
                </label>
                <input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => handleInputChange("email", e.target.value)}
                  className={`w-full px-4 py-3 rounded-lg border transition-colors ${
                    errors.email
                      ? "border-error focus:border-error"
                      : "border-input-border dark:border-input-border-dark focus:border-primary"
                  } bg-input-background dark:bg-input-background-dark text-content-primary dark:text-content-primary-dark focus:outline-none focus:ring-2 focus:ring-primary/20`}
                  placeholder="Enter your email"
                  disabled={isSubmitting || isLoading}
                />
                {errors.email && (
                  <p className="mt-1 text-sm text-error">{errors.email}</p>
                )}
              </div>
            )}

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-content-primary dark:text-content-primary-dark mb-2">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={formData.password}
                onChange={(e) => handleInputChange("password", e.target.value)}
                className={`w-full px-4 py-3 rounded-lg border transition-colors ${
                  errors.password
                    ? "border-error focus:border-error"
                    : "border-input-border dark:border-input-border-dark focus:border-primary"
                } bg-input-background dark:bg-input-background-dark text-content-primary dark:text-content-primary-dark focus:outline-none focus:ring-2 focus:ring-primary/20`}
                placeholder="Enter your password"
                disabled={isSubmitting || isLoading}
              />
              {errors.password && (
                <p className="mt-1 text-sm text-error">{errors.password}</p>
              )}
            </div>

            {/* Confirm Password (Registration only) */}
            {!isLoginMode && (
              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-content-primary dark:text-content-primary-dark mb-2">
                  Confirm Password
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  value={formData.confirmPassword}
                  onChange={(e) => handleInputChange("confirmPassword", e.target.value)}
                  className={`w-full px-4 py-3 rounded-lg border transition-colors ${
                    errors.confirmPassword
                      ? "border-error focus:border-error"
                      : "border-input-border dark:border-input-border-dark focus:border-primary"
                  } bg-input-background dark:bg-input-background-dark text-content-primary dark:text-content-primary-dark focus:outline-none focus:ring-2 focus:ring-primary/20`}
                  placeholder="Confirm your password"
                  disabled={isSubmitting || isLoading}
                />
                {errors.confirmPassword && (
                  <p className="mt-1 text-sm text-error">{errors.confirmPassword}</p>
                )}
              </div>
            )}

            {/* Remember Me Checkbox (Login only) */}
            {isLoginMode && (
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="rememberMe"
                    checked={formData.rememberMe}
                    onChange={(e) => handleInputChange("rememberMe", e.target.checked)}
                    className="h-4 w-4 text-primary focus:ring-primary/20 border-input-border dark:border-input-border-dark rounded"
                    disabled={isSubmitting || isLoading}
                  />
                  <label htmlFor="rememberMe" className="ml-2 text-sm text-content-primary dark:text-content-primary-dark">
                    Remember me
                  </label>
                </div>
                <div className="text-xs text-content-muted dark:text-content-muted-dark">
                  {formData.rememberMe ? "Stay signed in" : "Session only"}
                </div>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting || isLoading}
              className="w-full py-3 px-4 bg-primary hover:bg-primary-hover text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSubmitting || isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  {isLoginMode ? "Signing in..." : "Creating account..."}
                </>
              ) : (
                <>{isLoginMode ? "Sign In" : "Create Account"}</>
              )}
            </button>
          </form>

          {/* SSO Buttons */}
          {ssoEnabled && ssoProviders.length > 0 && (
            <div className="mt-6">
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border dark:border-border-dark" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="bg-surface dark:bg-surface-dark px-2 text-content-secondary dark:text-content-secondary-dark">
                    Or
                  </span>
                </div>
              </div>
              
              {/* Registration disabled notice for SSO */}
              {ssoRegistrationError && (
                <div className="mt-4 p-3 bg-surface-secondary dark:bg-surface-secondary-dark rounded-lg border border-border dark:border-border-dark">
                  <p className="text-sm text-content-secondary dark:text-content-secondary-dark text-center">
                    Only existing users can sign in with SSO
                  </p>
                </div>
              )}
              
              <div className="mt-6 grid grid-cols-1 gap-3">
                {ssoProviders.map((provider) => (
                  <button
                    key={provider.name}
                    type="button"
                    onClick={() => handleSSOLogin(provider.name)}
                    disabled={isSubmitting || isLoading}
                    className="w-full inline-flex justify-center py-3 px-4 border border-input-border dark:border-input-border-dark rounded-lg bg-input-background dark:bg-input-background-dark text-content-primary dark:text-content-primary-dark shadow-sm hover:bg-input-background/80 dark:hover:bg-input-background-dark/80 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="flex items-center gap-3">
                      {provider.name === 'google' && (
                        <svg className="w-5 h-5" viewBox="0 0 24 24">
                          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                        </svg>
                      )}
                      {provider.name === 'github' && (
                        <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                        </svg>
                      )}
                      <span className="font-medium">
                        Continue with {provider.display_name}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Toggle Mode */}
          <div className="mt-6 text-center">
            <p className="text-content-secondary dark:text-content-secondary-dark">
              {isLoginMode ? "Don't have an account? " : "Already have an account? "}
              {registrationEnabled ? (
                <button
                  type="button"
                  onClick={toggleMode}
                  disabled={isSubmitting || isLoading}
                  className="text-primary hover:text-primary-hover font-medium transition-colors disabled:opacity-50"
                >
                  {isLoginMode ? "Create one" : "Sign in"}
                </button>
              ) : (
                <span className="text-content-muted dark:text-content-muted-dark">
                  Registration is currently disabled. Please contact the administrator.
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center">
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            The music downloader
          </p>
        </div>
      </div>
    </div>
  );
} 