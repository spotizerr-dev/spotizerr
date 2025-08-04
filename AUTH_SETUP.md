# Spotizerr Authentication System

## Overview
Spotizerr now includes a modern, JWT-based authentication system that can be enabled or disabled via environment variables. The system supports username/password authentication with **session persistence across browser refreshes** and is designed to be easily extensible for future SSO implementations.

## Features
- 🔐 **JWT-based authentication** with secure token management
- 👤 **User registration and login** with password validation
- 🛡️ **Role-based access control** (user/admin roles)
- 🎛️ **Environment-controlled** - easily enable/disable
- 📱 **Responsive UI** - beautiful login screen with dark mode support
- 🔄 **Auto token refresh** and secure logout
- 💾 **Session persistence** - remember me across browser restarts
- 🔗 **Multi-tab sync** - logout/login reflected across all tabs
- 🎨 **Seamless integration** - existing app works unchanged when auth is disabled

## Session Management

### Remember Me Functionality
The authentication system supports two types of sessions:

1. **Persistent Sessions** (Remember Me = ON)
   - Token stored in `localStorage`
   - Session survives browser restarts
   - Green indicator in user menu
   - Default option for better UX

2. **Session-Only** (Remember Me = OFF)
   - Token stored in `sessionStorage`
   - Session cleared when browser closes
   - Orange indicator in user menu
   - More secure for shared computers

### Session Restoration
- **Automatic**: Sessions are automatically restored on page refresh
- **Validation**: Stored tokens are validated against the server
- **Graceful Degradation**: Invalid/expired tokens are cleared automatically
- **Visual Feedback**: Loading screen shows "Restoring your session..."

### Multi-Tab Synchronization
- Login/logout actions are synced across all open tabs
- Uses browser `storage` events for real-time synchronization
- Prevents inconsistent authentication states

## Environment Configuration

### Enable Authentication
Set the following environment variables:

```bash
# Enable the authentication system
ENABLE_AUTH=true

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_EXPIRATION_HOURS=24

# Default Admin User (created automatically if no users exist)
DEFAULT_ADMIN_USERNAME=admin
DEFAULT_ADMIN_PASSWORD=admin123
```

### Disable Authentication
```bash
# Disable authentication (default)
ENABLE_AUTH=false
```

## Backend Dependencies
The following Python packages are required:
```
bcrypt==4.2.1
PyJWT==2.10.1
python-multipart==0.0.17
```

## Usage

### When Authentication is Enabled
1. **First Time Setup**: When enabled with no existing users, a default admin account is created
   - Username: `admin` (or `DEFAULT_ADMIN_USERNAME`)
   - Password: `admin123` (or `DEFAULT_ADMIN_PASSWORD`)
   - **⚠️ Change the default password immediately!**

2. **User Registration**: First user to register becomes an admin, subsequent users are regular users

3. **Login Screen**: Users see a beautiful login/registration form
   - Username/password login
   - **Remember Me checkbox** with session type indicator
   - Optional email field for registration
   - Form validation and error handling
   - Responsive design with dark mode support

4. **Session Indicators**: Users can see their session type
   - **Green dot**: Persistent session (survives browser restart)
   - **Orange dot**: Session-only (cleared when browser closes)
   - Tooltip and dropdown show session details

5. **User Management**: Admin users can:
   - View all users
   - Delete users (except themselves)
   - Change user roles
   - Access config and credential management

### When Authentication is Disabled
- **No Changes**: App works exactly as before
- **Full Access**: All features available without login
- **No UI Changes**: No login screens or user menus

## Session Storage Details

### Token Storage Locations
```javascript
// Persistent sessions (Remember Me = true)
localStorage.setItem("auth_token", token);
localStorage.setItem("auth_remember", "true");

// Session-only (Remember Me = false)
sessionStorage.setItem("auth_token", token);
// No localStorage entries
```

### Session Validation Flow
1. **App Start**: Check for stored token in localStorage → sessionStorage
2. **Token Found**: Validate token with `/api/auth/status`
3. **Valid Token**: Restore user session automatically
4. **Invalid Token**: Clear storage, show login screen
5. **No Token**: Show login screen (if auth enabled)

## API Endpoints

### Authentication Endpoints
```
GET  /api/auth/status          # Check auth status & validate token
POST /api/auth/login           # User login
POST /api/auth/register        # User registration
POST /api/auth/logout          # User logout
GET  /api/auth/profile         # Get current user profile
PUT  /api/auth/profile/password # Change password
```

### Admin Endpoints
```
GET    /api/auth/users           # List all users
DELETE /api/auth/users/{username} # Delete user
PUT    /api/auth/users/{username}/role # Update user role
```

## Protected Routes
When authentication is enabled, the following routes require authentication:
- `/api/config/*` - Configuration management
- `/api/credentials/*` - Credential management
- `/api/auth/users/*` - User management (admin only)
- `/api/auth/profile/*` - Profile management

## Frontend Components

### LoginScreen
- Modern, responsive login/registration form
- **Remember Me checkbox** with visual indicators
- Client-side validation
- Smooth animations and transitions
- Dark mode support

### UserMenu
- Shows current user info
- **Session type indicator** (persistent/session-only)
- Dropdown with logout option
- Role indicator (admin/user)

### ProtectedRoute
- Wraps the entire app
- **Enhanced loading screen** with session restoration feedback
- Shows login screen when needed
- Handles loading states

## Security Features
- **Password Hashing**: bcrypt with salt
- **JWT Tokens**: Secure, expiring tokens
- **Token Validation**: Server-side validation on every request
- **Secure Storage**: Appropriate storage selection (localStorage vs sessionStorage)
- **HTTPS Ready**: Designed for production use
- **Input Validation**: Client and server-side validation
- **CSRF Protection**: Token-based authentication
- **Role-based Access**: Admin vs user permissions
- **Session Isolation**: Clear separation between persistent and session-only

## Development

### Adding New Protected Routes
```python
# Backend - Add to AuthMiddleware protected_paths
protected_paths = [
    "/api/config",
    "/api/auth/users",
    "/api/your-new-route",  # Add here
]
```

### Frontend Authentication Hooks
```typescript
import { useAuth } from "@/contexts/auth-context";

function MyComponent() {
  const { user, isAuthenticated, logout, isRemembered } = useAuth();
  
  if (!isAuthenticated) {
    return <div>Please log in</div>;
  }
  
  const sessionType = isRemembered() ? "persistent" : "session-only";
  
  return (
    <div>
      Hello, {user.username}! ({sessionType} session)
    </div>
  );
}
```

### Session Management
```typescript
// Login with remember preference
await login({ username, password }, rememberMe);

// Check session type
const isPersistent = isRemembered();

// Manual session restoration
await checkAuthStatus();
```

## Future Extensibility
The authentication system is designed to easily support:
- **OAuth/SSO Integration** (Google, GitHub, etc.)
- **LDAP/Active Directory**
- **Multi-factor Authentication**
- **API Key Authentication**
- **Refresh Token Rotation**
- **Session Management Dashboard**

## Production Deployment
1. **Change Default Credentials**: Update `DEFAULT_ADMIN_PASSWORD`
2. **Secure JWT Secret**: Use a strong, unique `JWT_SECRET`
3. **HTTPS**: Enable HTTPS in production
4. **Environment Variables**: Use secure environment variable management
5. **Database**: Consider migrating to a proper database for user storage
6. **Session Security**: Consider shorter token expiration for high-security environments

## Troubleshooting

### Common Issues
1. **"Authentication Required" errors**: Check `ENABLE_AUTH` setting
2. **Token expired**: Tokens expire after `JWT_EXPIRATION_HOURS`
3. **Session not persisting**: Check if "Remember Me" was enabled during login
4. **Can't access admin features**: Ensure user has admin role
5. **Login screen not showing**: Check if auth is enabled and user is logged out
6. **Session lost on refresh**: Check browser storage and token validation

### Debug Authentication
```bash
# Check auth status
curl -X GET http://localhost:7171/api/auth/status

# Test login
curl -X POST http://localhost:7171/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'

# Check browser storage
localStorage.getItem("auth_token")
localStorage.getItem("auth_remember")
sessionStorage.getItem("auth_token")
```

### Session Debugging
- **Browser Console**: Authentication system logs session restoration details
- **Network Tab**: Check `/api/auth/status` calls during app initialization
- **Application Tab**: Inspect localStorage/sessionStorage for token presence
- **Session Indicators**: Green/orange dots show current session type 