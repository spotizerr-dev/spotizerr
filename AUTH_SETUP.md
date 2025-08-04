# Authentication Setup

This document outlines how to configure authentication for Spotizerr, including both traditional username/password authentication and SSO (Single Sign-On) with Google and GitHub.

## Environment Variables

### Basic Authentication
- `ENABLE_AUTH`: Enable/disable authentication system (default: false)
- `DISABLE_REGISTRATION`: Disable public registration (default: false)
- `JWT_SECRET`: Secret key for JWT token signing (required in production)
- `JWT_ALGORITHM`: JWT algorithm (default: HS256)
- `JWT_EXPIRATION_HOURS`: JWT token expiration time in hours (default: 24)
- `DEFAULT_ADMIN_USERNAME`: Default admin username (default: admin)
- `DEFAULT_ADMIN_PASSWORD`: Default admin password (default: admin123)

### SSO Configuration
- `SSO_ENABLED`: Enable/disable SSO functionality (default: true)
- `SSO_BASE_REDIRECT_URI`: Base redirect URI for SSO callbacks (default: http://localhost:8000/api/auth/sso/callback)
- `FRONTEND_URL`: Frontend URL for post-authentication redirects (default: http://localhost:3000)

#### Google SSO
- `GOOGLE_CLIENT_ID`: Google OAuth2 client ID
- `GOOGLE_CLIENT_SECRET`: Google OAuth2 client secret

#### GitHub SSO  
- `GITHUB_CLIENT_ID`: GitHub OAuth2 client ID
- `GITHUB_CLIENT_SECRET`: GitHub OAuth2 client secret

## Setup Instructions

### 1. Traditional Authentication Only

1. Set environment variables:
```bash
ENABLE_AUTH=true
JWT_SECRET=your-super-secret-jwt-key-change-in-production
DEFAULT_ADMIN_USERNAME=admin
DEFAULT_ADMIN_PASSWORD=your-secure-password
```

2. Start the application - a default admin user will be created automatically.

### 2. Google SSO Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable Google+ API
4. Go to "Credentials" → "Create Credentials" → "OAuth 2.0 Client IDs"
5. Configure OAuth consent screen with your application details
6. Set authorized redirect URIs:
   - `http://localhost:8000/api/auth/sso/callback/google` (development)
   - `https://yourdomain.com/api/auth/sso/callback/google` (production)
7. Copy Client ID and Client Secret to environment variables:

```bash
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

### 3. GitHub SSO Setup

1. Go to GitHub Settings → Developer settings → OAuth Apps
2. Click "New OAuth App"
3. Fill in application details:
   - Application name: Your app name
   - Homepage URL: Your app URL
   - Authorization callback URL: 
     - `http://localhost:8000/api/auth/sso/callback/github` (development)
     - `https://yourdomain.com/api/auth/sso/callback/github` (production)
4. Copy Client ID and Client Secret to environment variables:

```bash
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
```

### 4. Complete Environment Configuration

Create a `.env` file with all required variables:

```bash
# Basic Authentication
ENABLE_AUTH=true
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_EXPIRATION_HOURS=24
DEFAULT_ADMIN_USERNAME=admin
DEFAULT_ADMIN_PASSWORD=your-secure-password

# SSO Configuration
SSO_ENABLED=true
SSO_BASE_REDIRECT_URI=http://localhost:8000/api/auth/sso/callback
FRONTEND_URL=http://localhost:3000

# Google SSO (optional)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# GitHub SSO (optional)
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
```

## API Endpoints

### Authentication Status
- `GET /api/auth/status` - Get authentication status and available SSO providers

### Traditional Authentication
- `POST /api/auth/login` - Login with username/password
- `POST /api/auth/register` - Register new user (if enabled)
- `POST /api/auth/logout` - Logout current user

### SSO Authentication
- `GET /api/auth/sso/status` - Get SSO status and providers
- `GET /api/auth/sso/login/google` - Initiate Google SSO login
- `GET /api/auth/sso/login/github` - Initiate GitHub SSO login
- `GET /api/auth/sso/callback/google` - Google SSO callback (automatic)
- `GET /api/auth/sso/callback/github` - GitHub SSO callback (automatic)
- `POST /api/auth/sso/unlink/{provider}` - Unlink SSO provider from account

### User Management (Admin only)
- `GET /api/auth/users` - List all users
- `POST /api/auth/users/create` - Create new user
- `DELETE /api/auth/users/{username}` - Delete user
- `PUT /api/auth/users/{username}/role` - Update user role

## Security Considerations

1. **HTTPS in Production**: Always use HTTPS in production and set `allow_insecure_http=False`
2. **Secure JWT Secret**: Use a strong, randomly generated JWT secret
3. **Environment Variables**: Never commit sensitive credentials to version control
4. **CORS Configuration**: Configure CORS appropriately for your frontend domain
5. **Cookie Security**: Ensure secure cookie settings in production

## User Types

The system supports two types of users:

1. **Traditional Users**: Created via username/password registration or admin creation
2. **SSO Users**: Created automatically when users authenticate via Google or GitHub

SSO users:
- Have `sso_provider` and `sso_id` fields populated
- Cannot use password-based authentication
- Can be unlinked from SSO providers by admins
- Get `user` role by default (first user gets `admin` role)

## Troubleshooting

### Common Issues

1. **SSO Login Fails**
   - Check OAuth app configuration in Google/GitHub
   - Verify redirect URIs match exactly
   - Ensure client ID and secret are correct

2. **CORS Errors**
   - Configure CORS middleware to allow your frontend domain
   - Check if frontend and backend URLs match configuration

3. **JWT Token Issues**
   - Verify JWT_SECRET is set and consistent
   - Check token expiration time
   - Ensure clock synchronization between services

4. **SSO Module Not Available**
   - Install fastapi-sso: `pip install fastapi-sso==0.18.0`
   - Restart the application after installation 