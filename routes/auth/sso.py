"""
SSO (Single Sign-On) implementation for Google and GitHub authentication
"""
import os
import logging
from typing import Optional, Dict, Any
from datetime import datetime, timedelta

from fastapi import APIRouter, Request, HTTPException, Depends
from fastapi.responses import RedirectResponse
from fastapi_sso.sso.google import GoogleSSO
from fastapi_sso.sso.github import GithubSSO
from fastapi_sso.sso.base import OpenID
from pydantic import BaseModel

from . import user_manager, token_manager, User, AUTH_ENABLED, DISABLE_REGISTRATION

logger = logging.getLogger(__name__)

router = APIRouter()

# SSO Configuration
SSO_ENABLED = os.getenv("SSO_ENABLED", "true").lower() in ("true", "1", "yes", "on")
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")
GITHUB_CLIENT_ID = os.getenv("GITHUB_CLIENT_ID")
GITHUB_CLIENT_SECRET = os.getenv("GITHUB_CLIENT_SECRET")
SSO_BASE_REDIRECT_URI = os.getenv("SSO_BASE_REDIRECT_URI", "http://localhost:7171/api/auth/sso/callback")

# Initialize SSO providers
google_sso = None
github_sso = None

if GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET:
    google_sso = GoogleSSO(
        client_id=GOOGLE_CLIENT_ID,
        client_secret=GOOGLE_CLIENT_SECRET,
        redirect_uri=f"{SSO_BASE_REDIRECT_URI}/google",
        allow_insecure_http=True,  # Set to False in production with HTTPS
    )

if GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET:
    github_sso = GithubSSO(
        client_id=GITHUB_CLIENT_ID,
        client_secret=GITHUB_CLIENT_SECRET,
        redirect_uri=f"{SSO_BASE_REDIRECT_URI}/github",
        allow_insecure_http=True,  # Set to False in production with HTTPS
    )


class MessageResponse(BaseModel):
    message: str


class SSOProvider(BaseModel):
    name: str
    display_name: str
    enabled: bool
    login_url: Optional[str] = None


class SSOStatusResponse(BaseModel):
    sso_enabled: bool
    providers: list[SSOProvider]
    registration_enabled: bool = True


def create_or_update_sso_user(openid: OpenID, provider: str) -> User:
    """Create or update user from SSO provider data"""
    # Generate username from email or use provider ID
    email = openid.email
    if not email:
        raise HTTPException(status_code=400, detail="Email is required for SSO authentication")
    
    # Use email prefix as username, fallback to provider + id
    username = email.split("@")[0]
    if not username:
        username = f"{provider}_{openid.id}"
    
    # Check if user already exists by email
    existing_user = None
    users = user_manager.load_users()
    for user_data in users.values():
        if user_data.get("email") == email:
            existing_user = User(**{k: v for k, v in user_data.items() if k != "password_hash"})
            break
    
    if existing_user:
        # Update last login for existing user (always allowed)
        users[existing_user.username]["last_login"] = datetime.utcnow().isoformat()
        users[existing_user.username]["sso_provider"] = provider
        users[existing_user.username]["sso_id"] = openid.id
        user_manager.save_users(users)
        return existing_user
    else:
        # Check if registration is disabled before creating new user
        if DISABLE_REGISTRATION:
            raise HTTPException(
                status_code=403, 
                detail="Registration is disabled. Contact an administrator to create an account."
            )
        
        # Create new user
        # Ensure username is unique
        counter = 1
        original_username = username
        while username in users:
            username = f"{original_username}{counter}"
            counter += 1
        
        user = User(
            username=username,
            email=email,
            role="user"  # Default role for SSO users
        )
        
        users[username] = {
            **user.to_dict(),
            "sso_provider": provider,
            "sso_id": openid.id,
            "password_hash": None  # SSO users don't have passwords
        }
        
        user_manager.save_users(users)
        logger.info(f"Created SSO user: {username} via {provider}")
        return user


@router.get("/sso/status", response_model=SSOStatusResponse)
async def sso_status():
    """Get SSO status and available providers"""
    providers = []
    
    if google_sso:
        providers.append(SSOProvider(
            name="google",
            display_name="Google",
            enabled=True,
            login_url="/api/auth/sso/login/google"
        ))
    
    if github_sso:
        providers.append(SSOProvider(
            name="github",
            display_name="GitHub",
            enabled=True,
            login_url="/api/auth/sso/login/github"
        ))
    
    return SSOStatusResponse(
        sso_enabled=SSO_ENABLED and AUTH_ENABLED,
        providers=providers,
        registration_enabled=not DISABLE_REGISTRATION
    )


@router.get("/sso/login/google")
async def google_login():
    """Initiate Google SSO login"""
    if not SSO_ENABLED or not AUTH_ENABLED:
        raise HTTPException(status_code=400, detail="SSO is disabled")
    
    if not google_sso:
        raise HTTPException(status_code=400, detail="Google SSO is not configured")
    
    async with google_sso:
        return await google_sso.get_login_redirect(params={"prompt": "consent", "access_type": "offline"})


@router.get("/sso/login/github")
async def github_login():
    """Initiate GitHub SSO login"""
    if not SSO_ENABLED or not AUTH_ENABLED:
        raise HTTPException(status_code=400, detail="SSO is disabled")
    
    if not github_sso:
        raise HTTPException(status_code=400, detail="GitHub SSO is not configured")
    
    async with github_sso:
        return await github_sso.get_login_redirect()


@router.get("/sso/callback/google")
async def google_callback(request: Request):
    """Handle Google SSO callback"""
    if not SSO_ENABLED or not AUTH_ENABLED:
        raise HTTPException(status_code=400, detail="SSO is disabled")
    
    if not google_sso:
        raise HTTPException(status_code=400, detail="Google SSO is not configured")
    
    try:
        async with google_sso:
            openid = await google_sso.verify_and_process(request)
        
        # Create or update user
        user = create_or_update_sso_user(openid, "google")
        
        # Create JWT token
        access_token = token_manager.create_token(user)
        
        # Redirect to frontend with token (you might want to customize this)
        frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
        response = RedirectResponse(url=f"{frontend_url}?token={access_token}")
        
        # Also set as HTTP-only cookie
        response.set_cookie(
            key="access_token",
            value=access_token,
            httponly=True,
            secure=False,  # Set to True in production with HTTPS
            samesite="lax",
            max_age=timedelta(hours=24).total_seconds()
        )
        
        return response
        
    except HTTPException as e:
        # Handle specific HTTP exceptions (like registration disabled)
        frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
        error_msg = e.detail if hasattr(e, 'detail') else "Authentication failed"
        logger.warning(f"Google SSO callback error: {error_msg}")
        return RedirectResponse(url=f"{frontend_url}?error={error_msg}")
        
    except Exception as e:
        logger.error(f"Google SSO callback error: {e}")
        frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
        return RedirectResponse(url=f"{frontend_url}?error=Authentication failed")


@router.get("/sso/callback/github")
async def github_callback(request: Request):
    """Handle GitHub SSO callback"""
    if not SSO_ENABLED or not AUTH_ENABLED:
        raise HTTPException(status_code=400, detail="SSO is disabled")
    
    if not github_sso:
        raise HTTPException(status_code=400, detail="GitHub SSO is not configured")
    
    try:
        async with github_sso:
            openid = await github_sso.verify_and_process(request)
        
        # Create or update user
        user = create_or_update_sso_user(openid, "github")
        
        # Create JWT token
        access_token = token_manager.create_token(user)
        
        # Redirect to frontend with token (you might want to customize this)
        frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
        response = RedirectResponse(url=f"{frontend_url}?token={access_token}")
        
        # Also set as HTTP-only cookie
        response.set_cookie(
            key="access_token",
            value=access_token,
            httponly=True,
            secure=False,  # Set to True in production with HTTPS
            samesite="lax",
            max_age=timedelta(hours=24).total_seconds()
        )
        
        return response
        
    except HTTPException as e:
        # Handle specific HTTP exceptions (like registration disabled)
        frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
        error_msg = e.detail if hasattr(e, 'detail') else "Authentication failed"
        logger.warning(f"GitHub SSO callback error: {error_msg}")
        return RedirectResponse(url=f"{frontend_url}?error={error_msg}")
        
    except Exception as e:
        logger.error(f"GitHub SSO callback error: {e}")
        frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
        return RedirectResponse(url=f"{frontend_url}?error=Authentication failed")


@router.post("/sso/unlink/{provider}", response_model=MessageResponse)
async def unlink_sso_provider(
    provider: str,
    request: Request,
):
    """Unlink SSO provider from user account"""
    if not SSO_ENABLED or not AUTH_ENABLED:
        raise HTTPException(status_code=400, detail="SSO is disabled")
    
    if provider not in ["google", "github"]:
        raise HTTPException(status_code=400, detail="Invalid SSO provider")
    
    # Get current user from request (avoiding circular imports)
    from .middleware import require_auth_from_state
    
    current_user = await require_auth_from_state(request)
    
    if not current_user.sso_provider:
        raise HTTPException(status_code=400, detail="User is not linked to any SSO provider")
    
    if current_user.sso_provider != provider:
        raise HTTPException(status_code=400, detail=f"User is not linked to {provider}")
    
    # Update user to remove SSO linkage
    users = user_manager.load_users()
    if current_user.username in users:
        users[current_user.username]["sso_provider"] = None
        users[current_user.username]["sso_id"] = None
        user_manager.save_users(users)
        logger.info(f"Unlinked SSO provider {provider} from user {current_user.username}")
    
    return MessageResponse(message=f"SSO provider {provider} unlinked successfully") 