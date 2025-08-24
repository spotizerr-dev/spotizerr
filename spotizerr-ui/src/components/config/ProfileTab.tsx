import { useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { authApiClient } from "@/lib/api-client";

export function ProfileTab() {
  const { user } = useAuth();
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validatePasswordForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!passwordForm.currentPassword) {
      newErrors.currentPassword = "Current password is required";
    }

    if (!passwordForm.newPassword) {
      newErrors.newPassword = "New password is required";
    } else if (passwordForm.newPassword.length < 6) {
      newErrors.newPassword = "New password must be at least 6 characters";
    }

    if (!passwordForm.confirmPassword) {
      newErrors.confirmPassword = "Please confirm your new password";
    } else if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      newErrors.confirmPassword = "Passwords do not match";
    }

    if (passwordForm.currentPassword === passwordForm.newPassword) {
      newErrors.newPassword = "New password must be different from current password";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validatePasswordForm()) {
      return;
    }

    try {
      setIsChangingPassword(true);
      await authApiClient.changePassword(
        passwordForm.currentPassword,
        passwordForm.newPassword
      );
      
      // Reset form on success
      setPasswordForm({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      setErrors({});
      
    } catch (error: any) {
      console.error("Password change failed:", error);
      // The API client will show the toast error, but we might want to handle specific field errors
      if (error.response?.data?.detail) {
        const detail = error.response.data.detail;
        if (detail.includes("Current password is incorrect")) {
          setErrors({ currentPassword: "Current password is incorrect" });
        } else if (detail.includes("New password must be")) {
          setErrors({ newPassword: detail });
        }
      }
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleInputChange = (field: string, value: string) => {
    setPasswordForm(prev => ({
      ...prev,
      [field]: value
    }));
    
    // Clear error for this field when user starts typing
    if (errors[field]) {
      setErrors(prev => ({
        ...prev,
        [field]: ""
      }));
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold text-content-primary dark:text-content-primary-dark mb-4">
          Profile Settings
        </h2>
        <p className="text-content-muted dark:text-content-muted-dark">
          Manage your profile information and security settings.
        </p>
      </div>

      {/* User Information */}
      <div className="bg-surface-muted dark:bg-surface-muted-dark rounded-lg p-6">
        <h3 className="text-lg font-medium text-content-primary dark:text-content-primary-dark mb-4">
          Account Information
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-content-secondary dark:text-content-secondary-dark mb-1">
              Username
            </label>
            <p className="text-content-primary dark:text-content-primary-dark">
              {user?.username}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-content-secondary dark:text-content-secondary-dark mb-1">
              Email
            </label>
            <p className="text-content-primary dark:text-content-primary-dark">
              {user?.email || "Not provided"}
            </p>
          </div>
          <div>
            <label className="block text_sm font-medium text-content-secondary dark:text-content-secondary-dark mb-1">
              Role
            </label>
            <p className="text-content-primary dark:text-content-primary-dark">
              {user?.role === "admin" ? "Administrator" : "User"}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-content-secondary dark:text-content-secondary-dark mb-1">
              Account Type
            </label>
            <p className="text-content-primary dark:text-content-primary-dark">
              {user?.is_sso_user ? `SSO (${user.sso_provider})` : "Local Account"}
            </p>
          </div>
        </div>
      </div>

      {/* Password Change Section - Only show for non-SSO users */}
      {user && !user.is_sso_user && (
        <div className="bg-surface-muted dark:bg-surface-muted-dark rounded-lg p-6">
          <h3 className="text-lg font-medium text-content-primary dark:text-content-primary-dark mb-4">
            Change Password
          </h3>
          <p className="text-content-muted dark:text-content-muted-dark mb-6">
            Update your password to keep your account secure.
          </p>

          <form onSubmit={handlePasswordChange} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-content-secondary dark:text-content-secondary-dark mb-2">
                Current Password
              </label>
              <input
                type="password"
                value={passwordForm.currentPassword}
                onChange={(e) => handleInputChange("currentPassword", e.target.value)}
                className={`w-full px-3 py-2 rounded-lg border transition-colors ${
                  errors.currentPassword
                    ? "border-error text-error-text bg-error-muted"
                    : "border-border dark:border-border-dark bg-surface dark:bg-surface-dark text-content-primary dark:text-content-primary-dark focus:border-primary focus:ring-1 focus:ring-primary"
                }`}
                placeholder="Enter your current password"
                disabled={isChangingPassword}
              />
              {errors.currentPassword && (
                <p className="text-error-text text-sm mt-1">{errors.currentPassword}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font_medium text-content-secondary dark:text-content-secondary-dark mb-2">
                New Password
              </label>
              <input
                type="password"
                value={passwordForm.newPassword}
                onChange={(e) => handleInputChange("newPassword", e.target.value)}
                className={`w-full px-3 py-2 rounded-lg border transition-colors ${
                  errors.newPassword
                    ? "border-error text-error-text bg-error-muted"
                    : "border-border dark:border-border-dark bg-surface dark:bg-surface-dark text-content-primary dark:text-content-primary-dark focus:border-primary focus:ring-1 focus:ring-primary"
                }`}
                placeholder="Enter your new password"
                disabled={isChangingPassword}
              />
              {errors.newPassword && (
                <p className="text-error-text text-sm mt-1">{errors.newPassword}</p>
              )}
              <p className="text-xs text-content-muted dark:text-content-muted-dark mt-1">
                Must be at least 6 characters long
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-content-secondary dark:text-content-secondary-dark mb-2">
                Confirm New Password
              </label>
              <input
                type="password"
                value={passwordForm.confirmPassword}
                onChange={(e) => handleInputChange("confirmPassword", e.target.value)}
                className={`w-full px-3 py-2 rounded-lg border transition-colors ${
                  errors.confirmPassword
                    ? "border-error text-error-text bg-error-muted"
                    : "border-border dark:border-border-dark bg-surface dark:bg-surface-dark text-content-primary dark:text-content-primary-dark focus:border-primary focus:ring-1 focus:ring-primary"
                }`}
                placeholder="Confirm your new password"
                disabled={isChangingPassword}
              />
              {errors.confirmPassword && (
                <p className="text-error-text text-sm mt-1">{errors.confirmPassword}</p>
              )}
            </div>

            <div className="flex gap-3 pt-4">
              <button
                type="submit"
                disabled={isChangingPassword}
                className="px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Save Password"
              >
                {isChangingPassword ? (
                  <img src="/spinner.svg" alt="Saving" className="w-5 h-5 animate-spin inline-block logo" />
                ) : (
                  <img src="/save.svg" alt="Save" className="w-5 h-5 inline-block logo" />
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPasswordForm({
                    currentPassword: "",
                    newPassword: "",
                    confirmPassword: "",
                  });
                  setErrors({});
                }}
                disabled={isChangingPassword}
                className="px-4 py-2 bg-surface-accent dark:bg-surface-accent-dark hover:bg-surface-muted dark:hover:bg-surface-muted-dark text-content-primary dark:text-content-primary-dark rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* SSO User Notice */}
      {user?.is_sso_user && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-100 mb-2">
            SSO Account
          </h3>
          <p className="text-blue-800 dark:text-blue-200">
            Your account is managed by {user.sso_provider}. To change your password, 
            please use your {user.sso_provider} account settings.
          </p>
        </div>
      )}
    </div>
  );
} 