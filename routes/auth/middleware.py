from fastapi import HTTPException, Request, Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from typing import Callable, List, Optional
import logging

from . import AUTH_ENABLED, token_manager, user_manager, User

logger = logging.getLogger(__name__)


class AuthMiddleware(BaseHTTPMiddleware):
    """
    Authentication middleware that enforces strict access control.
    
    Philosophy:
    - Nothing should be accessible to non-users (except auth endpoints)
    - Everything but config/credentials should be accessible to users  
    - Everything should be accessible to admins
    """
    
    def __init__(
        self, 
        app,
        protected_paths: Optional[List[str]] = None,
        public_paths: Optional[List[str]] = None
    ):
        super().__init__(app)
        
        # Minimal public paths - only auth-related endpoints and static assets
        self.public_paths = public_paths or [
            "/api/auth/status",
            "/api/auth/login", 
            "/api/auth/register",
            "/api/auth/logout",
            "/api/auth/sso",  # All SSO endpoints
            "/static",
            "/favicon.ico"
        ]
        
        # Admin-only paths (sensitive operations)
        self.admin_only_paths = [
            "/api/credentials",  # All credential management
            "/api/config",       # All configuration management
        ]
        
        # All other /api paths require at least user authentication
        # This will be enforced in the dispatch method

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """Process request with strict authentication"""
        
        # If auth is disabled, allow all requests
        if not AUTH_ENABLED:
            return await call_next(request)
        
        path = request.url.path
        
        # Check if path is public (always allow)
        if self._is_public_path(path):
            return await call_next(request)
        
        # For all other /api paths, require authentication
        if path.startswith("/api"):
            auth_result = await self._authenticate_request(request)
            if not auth_result:
                return JSONResponse(
                    status_code=401,
                    content={
                        "detail": "Authentication required",
                        "auth_enabled": True
                    },
                    headers={"WWW-Authenticate": "Bearer"}
                )
            
            # Check if admin access is required
            if self._requires_admin_access(path):
                if auth_result.role != "admin":
                    return JSONResponse(
                        status_code=403,
                        content={
                            "detail": "Admin access required"
                        }
                    )
            
            # Add user to request state for use in route handlers
            request.state.current_user = auth_result
        
        return await call_next(request)

    def _is_public_path(self, path: str) -> bool:
        """Check if path is in public paths list"""
        # Special case for exact root path
        if path == "/":
            return True
        
        for public_path in self.public_paths:
            if path.startswith(public_path):
                return True
        return False

    def _requires_admin_access(self, path: str) -> bool:
        """Check if path requires admin role"""
        for admin_path in self.admin_only_paths:
            if path.startswith(admin_path):
                return True
        return False

    async def _authenticate_request(self, request: Request) -> Optional[User]:
        """Authenticate request and return user if valid"""
        try:
            token = None
            
            # First try to get token from authorization header
            authorization = request.headers.get("authorization")
            if authorization and authorization.startswith("Bearer "):
                token = authorization.split(" ", 1)[1]
            
            # If no header token and this is an SSE endpoint, check query parameters
            if not token and request.url.path.endswith("/stream"):
                token = request.query_params.get("token")
            
            if not token:
                return None
            
            # Verify token
            payload = token_manager.verify_token(token)
            if not payload:
                return None
            
            # Get user from payload
            user = user_manager.get_user(payload["username"])
            return user
            
        except Exception as e:
            logger.error(f"Authentication error: {e}")
            return None


# Dependency function to get current user from request state
async def get_current_user_from_state(request: Request) -> Optional[User]:
    """Get current user from request state (set by middleware)"""
    if not AUTH_ENABLED:
        return User(username="system", role="admin")
    
    return getattr(request.state, 'current_user', None)


# Dependency function to require authentication
async def require_auth_from_state(request: Request) -> User:
    """Require authentication using request state"""
    if not AUTH_ENABLED:
        return User(username="system", role="admin")
    
    user = getattr(request.state, 'current_user', None)
    if not user:
        raise HTTPException(
            status_code=401,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"}
        )
    
    return user


# Dependency function to require admin role
async def require_admin_from_state(request: Request) -> User:
    """Require admin role using request state"""
    if not AUTH_ENABLED:
        return User(username="system", role="admin")
        
    user = await require_auth_from_state(request)
    
    if user.role != "admin":
        raise HTTPException(
            status_code=403,
            detail="Admin access required"
        )
    
    return user 