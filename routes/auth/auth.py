from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from typing import Optional, List
import logging

from . import AUTH_ENABLED, DISABLE_REGISTRATION, user_manager, token_manager, User

logger = logging.getLogger(__name__)

router = APIRouter()
security = HTTPBearer(auto_error=False)


# Pydantic models for request/response
class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str
    password: str
    email: Optional[str] = None


class CreateUserRequest(BaseModel):
    """Admin-only request to create users when registration is disabled"""
    username: str
    password: str
    email: Optional[str] = None
    role: str = "user"


class RoleUpdateRequest(BaseModel):
    """Request to update user role"""
    role: str


class UserResponse(BaseModel):
    username: str
    email: Optional[str]
    role: str
    created_at: str
    last_login: Optional[str]


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class MessageResponse(BaseModel):
    message: str


class AuthStatusResponse(BaseModel):
    auth_enabled: bool
    authenticated: bool = False
    user: Optional[UserResponse] = None
    registration_enabled: bool = True


# Dependency to get current user
async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security)
) -> Optional[User]:
    """Get current user from JWT token"""
    if not AUTH_ENABLED:
        # When auth is disabled, return a mock admin user
        return User(username="system", role="admin")
    
    if not credentials:
        return None
    
    payload = token_manager.verify_token(credentials.credentials)
    if not payload:
        return None
    
    user = user_manager.get_user(payload["username"])
    return user


async def require_auth(current_user: User = Depends(get_current_user)) -> User:
    """Require authentication - raises HTTPException if not authenticated"""
    if not AUTH_ENABLED:
        return User(username="system", role="admin")
    
    if not current_user:
        raise HTTPException(
            status_code=401,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    return current_user


async def require_admin(current_user: User = Depends(require_auth)) -> User:
    """Require admin role - raises HTTPException if not admin"""
    if current_user.role != "admin":
        raise HTTPException(
            status_code=403,
            detail="Admin access required"
        )
    
    return current_user


# Authentication endpoints
@router.get("/status", response_model=AuthStatusResponse)
async def auth_status(current_user: Optional[User] = Depends(get_current_user)):
    """Get authentication status"""
    return AuthStatusResponse(
        auth_enabled=AUTH_ENABLED,
        authenticated=current_user is not None,
        user=UserResponse(**current_user.to_public_dict()) if current_user else None,
        registration_enabled=AUTH_ENABLED and not DISABLE_REGISTRATION
    )


@router.post("/login", response_model=LoginResponse)
async def login(request: LoginRequest):
    """Authenticate user and return access token"""
    if not AUTH_ENABLED:
        raise HTTPException(
            status_code=400,
            detail="Authentication is disabled"
        )
    
    user = user_manager.authenticate_user(request.username, request.password)
    if not user:
        raise HTTPException(
            status_code=401,
            detail="Invalid username or password"
        )
    
    access_token = token_manager.create_token(user)
    
    return LoginResponse(
        access_token=access_token,
        user=UserResponse(**user.to_public_dict())
    )


@router.post("/register", response_model=MessageResponse)
async def register(request: RegisterRequest):
    """Register a new user"""
    if not AUTH_ENABLED:
        raise HTTPException(
            status_code=400,
            detail="Authentication is disabled"
        )
    
    if DISABLE_REGISTRATION:
        raise HTTPException(
            status_code=403,
            detail="Public registration is disabled. Contact an administrator to create an account."
        )
    
    # Check if this is the first user (should be admin)
    existing_users = user_manager.list_users()
    role = "admin" if len(existing_users) == 0 else "user"
    
    success, message = user_manager.create_user(
        username=request.username,
        password=request.password,
        email=request.email,
        role=role
    )
    
    if not success:
        raise HTTPException(status_code=400, detail=message)
    
    return MessageResponse(message=message)


@router.post("/logout", response_model=MessageResponse)
async def logout():
    """Logout user (client should delete token)"""
    return MessageResponse(message="Logged out successfully")


# User management endpoints (admin only)
@router.get("/users", response_model=List[UserResponse])
async def list_users(current_user: User = Depends(require_admin)):
    """List all users (admin only)"""
    users = user_manager.list_users()
    return [UserResponse(**user.to_public_dict()) for user in users]


@router.delete("/users/{username}", response_model=MessageResponse)
async def delete_user(username: str, current_user: User = Depends(require_admin)):
    """Delete a user (admin only)"""
    if username == current_user.username:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete your own account"
        )
    
    success, message = user_manager.delete_user(username)
    if not success:
        raise HTTPException(status_code=404, detail=message)
    
    return MessageResponse(message=message)


@router.put("/users/{username}/role", response_model=MessageResponse)
async def update_user_role(
    username: str, 
    request: RoleUpdateRequest, 
    current_user: User = Depends(require_admin)
):
    """Update user role (admin only)"""
    if request.role not in ["user", "admin"]:
        raise HTTPException(
            status_code=400,
            detail="Role must be 'user' or 'admin'"
        )
    
    if username == current_user.username:
        raise HTTPException(
            status_code=400,
            detail="Cannot change your own role"
        )
    
    success, message = user_manager.update_user_role(username, request.role)
    if not success:
        raise HTTPException(status_code=404, detail=message)
    
    return MessageResponse(message=message)


@router.post("/users/create", response_model=MessageResponse)
async def create_user_admin(request: CreateUserRequest, current_user: User = Depends(require_admin)):
    """Create a new user (admin only) - for use when registration is disabled"""
    if not AUTH_ENABLED:
        raise HTTPException(
            status_code=400,
            detail="Authentication is disabled"
        )
    
    # Validate role
    if request.role not in ["user", "admin"]:
        raise HTTPException(
            status_code=400,
            detail="Role must be 'user' or 'admin'"
        )
    
    success, message = user_manager.create_user(
        username=request.username,
        password=request.password,
        email=request.email,
        role=request.role
    )
    
    if not success:
        raise HTTPException(status_code=400, detail=message)
    
    return MessageResponse(message=message)


# Profile endpoints
@router.get("/profile", response_model=UserResponse)
async def get_profile(current_user: User = Depends(require_auth)):
    """Get current user profile"""
    return UserResponse(**current_user.to_public_dict())


@router.put("/profile/password", response_model=MessageResponse)
async def change_password(
    current_password: str,
    new_password: str,
    current_user: User = Depends(require_auth)
):
    """Change current user's password"""
    if not AUTH_ENABLED:
        raise HTTPException(
            status_code=400,
            detail="Authentication is disabled"
        )
    
    # Verify current password
    authenticated_user = user_manager.authenticate_user(
        current_user.username, 
        current_password
    )
    if not authenticated_user:
        raise HTTPException(
            status_code=401,
            detail="Current password is incorrect"
        )
    
    # Update password (we need to load users, update, and save)
    users = user_manager.load_users()
    if current_user.username not in users:
        raise HTTPException(status_code=404, detail="User not found")
    
    users[current_user.username]["password_hash"] = user_manager.hash_password(new_password)
    user_manager.save_users(users)
    
    logger.info(f"Password changed for user: {current_user.username}")
    return MessageResponse(message="Password changed successfully") 