import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/auth-context";
import { authApiClient } from "@/lib/api-client";
import { toast } from "sonner";
import type { User, CreateUserRequest } from "@/types/auth";

export function UserManagementTab() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState<CreateUserRequest>({
    username: "",
    password: "",
    email: "",
    role: "user"
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  
  // Password reset state
  const [showPasswordResetModal, setShowPasswordResetModal] = useState(false);
  const [passwordResetUser, setPasswordResetUser] = useState<string>("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      setIsLoading(true);
      const userList = await authApiClient.listUsers();
      setUsers(userList);
    } catch (error) {
      console.error("Failed to load users:", error);
      toast.error("Failed to load users");
    } finally {
      setIsLoading(false);
    }
  };

  const validateCreateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!createForm.username.trim()) {
      newErrors.username = "Username is required";
    } else if (createForm.username.length < 3) {
      newErrors.username = "Username must be at least 3 characters";
    }

    if (!createForm.password) {
      newErrors.password = "Password is required";
    } else if (createForm.password.length < 6) {
      newErrors.password = "Password must be at least 6 characters";
    }

    if (createForm.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(createForm.email)) {
      newErrors.email = "Please enter a valid email address";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateCreateForm()) {
      return;
    }

    try {
      setIsCreating(true);
      await authApiClient.createUser({
        ...createForm,
        email: createForm.email?.trim() || undefined,
      });
      
      // Reset form and reload users
      setCreateForm({ username: "", password: "", email: "", role: "user" });
      setShowCreateForm(false);
      setErrors({});
      await loadUsers();
    } catch (error) {
      console.error("Failed to create user:", error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteUser = async (username: string) => {
    if (username === currentUser?.username) {
      toast.error("Cannot delete your own account");
      return;
    }

    if (!confirm(`Are you sure you want to delete user "${username}"?`)) {
      return;
    }

    try {
      await authApiClient.deleteUser(username);
      await loadUsers();
    } catch (error) {
      console.error("Failed to delete user:", error);
    }
  };

  const handleRoleChange = async (username: string, newRole: "user" | "admin") => {
    if (username === currentUser?.username) {
      toast.error("Cannot change your own role");
      return;
    }

    try {
      await authApiClient.updateUserRole(username, newRole);
      await loadUsers();
    } catch (error) {
      console.error("Failed to update user role:", error);
    }
  };

  const handleInputChange = (field: keyof CreateUserRequest, value: string) => {
    setCreateForm(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: "" }));
    }
  };

  const openPasswordResetModal = (username: string) => {
    setPasswordResetUser(username);
    setNewPassword("");
    setConfirmPassword("");
    setPasswordErrors({});
    setShowPasswordResetModal(true);
  };

  const closePasswordResetModal = () => {
    setShowPasswordResetModal(false);
    setPasswordResetUser("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordErrors({});
  };

  const validatePasswordReset = (): boolean => {
    const errors: Record<string, string> = {};

    if (!newPassword) {
      errors.newPassword = "New password is required";
    } else if (newPassword.length < 6) {
      errors.newPassword = "Password must be at least 6 characters long";
    }

    if (!confirmPassword) {
      errors.confirmPassword = "Please confirm the password";
    } else if (newPassword !== confirmPassword) {
      errors.confirmPassword = "Passwords do not match";
    }

    setPasswordErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validatePasswordReset()) {
      return;
    }

    try {
      setIsResettingPassword(true);
      await authApiClient.adminResetPassword(passwordResetUser, newPassword);
      closePasswordResetModal();
    } catch (error) {
      console.error("Failed to reset password:", error);
    } finally {
      setIsResettingPassword(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium text-content-primary dark:text-content-primary-dark">
            User Management
          </h3>
          <p className="text-sm text-content-secondary dark:text-content-secondary-dark">
            Manage user accounts and permissions
          </p>
        </div>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg font-medium transition-colors"
        >
          {showCreateForm ? "Cancel" : "Create User"}
        </button>
      </div>

      {/* Create User Form */}
      {showCreateForm && (
        <div className="bg-surface-secondary dark:bg-surface-secondary-dark rounded-lg p-6 border border-border dark:border-border-dark">
          <h4 className="text-md font-medium text-content-primary dark:text-content-primary-dark mb-4">
            Create New User
          </h4>
          <form onSubmit={handleCreateUser} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-content-primary dark:text-content-primary-dark mb-2">
                  Username *
                </label>
                <input
                  type="text"
                  value={createForm.username}
                  onChange={(e) => handleInputChange("username", e.target.value)}
                  className={`w-full px-3 py-2 rounded-lg border transition-colors ${
                    errors.username
                      ? "border-error focus:border-error"
                      : "border-input-border dark:border-input-border-dark focus:border-primary"
                  } bg-input-background dark:bg-input-background-dark text-content-primary dark:text-content-primary-dark focus:outline-none focus:ring-2 focus:ring-primary/20`}
                  placeholder="Enter username"
                  disabled={isCreating}
                />
                {errors.username && (
                  <p className="mt-1 text-sm text-error">{errors.username}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-content-primary dark:text-content-primary-dark mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={createForm.email}
                  onChange={(e) => handleInputChange("email", e.target.value)}
                  className={`w-full px-3 py-2 rounded-lg border transition-colors ${
                    errors.email
                      ? "border-error focus:border-error"
                      : "border-input-border dark:border-input-border-dark focus:border-primary"
                  } bg-input-background dark:bg-input-background-dark text-content-primary dark:text-content-primary-dark focus:outline_none focus:ring-2 focus:ring-primary/20`}
                  placeholder="Enter email (optional)"
                  disabled={isCreating}
                />
                {errors.email && (
                  <p className="mt-1 text-sm text-error">{errors.email}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-content-primary dark:text-content-primary-dark mb-2">
                  Password *
                </label>
                <input
                  type="password"
                  value={createForm.password}
                  onChange={(e) => handleInputChange("password", e.target.value)}
                  className={`w-full px-3 py-2 rounded-lg border transition-colors ${
                    errors.password
                      ? "border-error focus:border-error"
                      : "border-input-border dark:border-input-border-dark focus:border-primary"
                  } bg-input-background dark:bg-input-background-dark text-content-primary dark:text-content-primary-dark focus:outline-none focus:ring-2 focus:ring-primary/20`}
                  placeholder="Enter password"
                  disabled={isCreating}
                />
                {errors.password && (
                  <p className="mt-1 text-sm text-error">{errors.password}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-content-primary dark:text-content-primary-dark mb-2">
                  Role *
                </label>
                <select
                  value={createForm.role}
                  onChange={(e) => handleInputChange("role", e.target.value as "user" | "admin")}
                  className="w-full px-3 py-2 rounded-lg border border-input-border dark:border-input-border-dark focus:border-primary bg-input-background dark:bg-input-background-dark text-content-primary dark:text-content-primary-dark focus:outline-none focus:ring-2 focus:ring-primary/20"
                  disabled={isCreating}
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isCreating}
                className="px-4 py-2 bg-primary hover:bg-primary-hover text_white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                title="Save User"
              >
                {isCreating ? (
                  <img src="/spinner.svg" alt="Saving" className="w-4 h-4 animate-spin logo" />
                ) : (
                  <img src="/save.svg" alt="Save" className="w-4 h-4 logo" />
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Users List */}
      <div className="bg-surface dark:bg-surface-dark rounded-lg border border-border dark:border-border-dark overflow-hidden">
        <div className="px-6 py-4 border-b border-border dark:border-border-dark">
          <h4 className="text-md font-medium text-content-primary dark:text-content-primary-dark">
            Users ({users.length})
          </h4>
        </div>
        
        {users.length === 0 ? (
          <div className="px-6 py-8 text-center text-content-secondary dark:text-content-secondary-dark">
            No users found
          </div>
        ) : (
          <div className="divide-y divide-border dark:divide-border-dark">
            {users.map((user) => (
              <div key={user.username} className="px-6 py-4 flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <div>
                      <p className="font-medium text-content-primary dark:text-content-primary-dark">
                        {user.username}
                        {user.username === currentUser?.username && (
                          <span className="ml-2 text-xs text-primary">(You)</span>
                        )}
                        {user.is_sso_user && (
                          <span className="ml-2 text-xs text-blue-600 dark:text-blue-400">
                            SSO ({user.sso_provider})
                          </span>
                        )}
                      </p>
                      {user.email && (
                        <p className="text-sm text-content-secondary dark:text-content-secondary-dark">
                          {user.email}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-3">
                  <select
                    value={user.role}
                    onChange={(e) => handleRoleChange(user.username, e.target.value as "user" | "admin")}
                    disabled={user.username === currentUser?.username}
                    className="px-3 py-1 text-sm rounded-lg border border-input-border dark:border-input-border-dark bg-input-background dark:bg-input-background-dark text-content-primary dark:text-content-primary-dark disabled:opacity-50"
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                  
                  {/* Only show reset password for non-SSO users */}
                  {!user.is_sso_user && (
                    <button
                      onClick={() => openPasswordResetModal(user.username)}
                      disabled={user.username === currentUser?.username}
                      className="px-3 py-1 text-sm text-content-primary dark:text-content-primary-dark hover:bg-surface-muted dark:hover:bg-surface-muted-dark rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Reset Password
                    </button>
                  )}
                  
                  <button
                    onClick={() => handleDeleteUser(user.username)}
                    disabled={user.username === currentUser?.username}
                    className="px-3 py-1 text-sm text-error hover:bg-error-muted rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Password Reset Modal */}
      {showPasswordResetModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface dark:bg-surface-dark rounded-xl border border-border dark:border-border-dark shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-content-primary dark:text-content-primary-dark mb-4">
                Reset Password for {passwordResetUser}
              </h3>
              <p className="text-sm text-content-secondary dark:text-content-secondary-dark mb-6">
                Enter a new password for this user. The user will need to use this password to log in.
              </p>
              
              <form onSubmit={handlePasswordReset} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-content-primary dark:text-content-primary-dark mb-2">
                    New Password
                  </label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => {
                      setNewPassword(e.target.value);
                      if (passwordErrors.newPassword) {
                        setPasswordErrors(prev => ({ ...prev, newPassword: "" }));
                      }
                    }}
                    className={`w-full px-3 py-2 rounded-lg border transition-colors ${
                      passwordErrors.newPassword
                        ? "border-error focus:border-error"
                        : "border-input-border dark:border-input-border-dark focus:border-primary"
                    } bg-input-background dark:bg-input-background-dark text-content-primary dark:text-content-primary-dark focus:outline-none focus:ring-2 focus:ring-primary/20`}
                    placeholder="Enter new password"
                    disabled={isResettingPassword}
                  />
                  {passwordErrors.newPassword && (
                    <p className="mt-1 text-sm text-error">{passwordErrors.newPassword}</p>
                  )}
                  <p className="text-xs text-content-muted dark:text-content-muted-dark mt-1">
                    Must be at least 6 characters long
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-content-primary dark:text-content-primary-dark mb-2">
                    Confirm Password
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      if (passwordErrors.confirmPassword) {
                        setPasswordErrors(prev => ({ ...prev, confirmPassword: "" }));
                      }
                    }}
                    className={`w-full px-3 py-2 rounded-lg border transition-colors ${
                      passwordErrors.confirmPassword
                        ? "border-error focus:border-error"
                        : "border-input-border dark:border-input-border-dark focus:border-primary"
                    } bg-input-background dark:bg-input-background-dark text-content-primary dark:text-content-primary-dark focus:outline-none focus:ring-2 focus:ring-primary/20`}
                    placeholder="Confirm new password"
                    disabled={isResettingPassword}
                  />
                  {passwordErrors.confirmPassword && (
                    <p className="mt-1 text-sm text-error">{passwordErrors.confirmPassword}</p>
                  )}
                </div>

                <div className="flex justify-end gap-3 pt-4">
                  <button
                    type="button"
                    onClick={closePasswordResetModal}
                    disabled={isResettingPassword}
                    className="px-4 py-2 text-content-secondary dark:text-content-secondary-dark hover:text-content-primary dark:hover:text-content-primary-dark transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isResettingPassword}
                    className="px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    title="Save Password"
                  >
                    {isResettingPassword ? (
                      <img src="/spinner.svg" alt="Saving" className="w-4 h-4 animate-spin logo" />
                    ) : (
                      <img src="/save.svg" alt="Save" className="w-4 h-4 logo" />
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 