import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "sonner";
import type { LoginRequest, RegisterRequest, AuthError } from "@/types/auth";

interface LoginScreenProps {
  onSuccess?: () => void;
}

export function LoginScreen({ onSuccess }: LoginScreenProps) {
  const { login, register, isLoading, authEnabled, registrationEnabled, isRemembered } = useAuth();
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
  };

  const toggleMode = () => {
    // Don't allow toggling to registration if it's disabled
    if (!registrationEnabled && isLoginMode) {
      return;
    }
    
    setIsLoginMode(!isLoginMode);
    setErrors({});
    setFormData({
      username: "",
      password: "",
      email: "",
      confirmPassword: "",
      rememberMe: formData.rememberMe, // Preserve remember me preference
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-surface to-surface-secondary dark:from-surface-dark dark:to-surface-secondary-dark p-4">
      <div className="w-full max-w-md">
        {/* Logo/Brand */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center">
              <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.369 4.369 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z" />
              </svg>
            </div>
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
            Secure music download platform
          </p>
        </div>
      </div>
    </div>
  );
} 