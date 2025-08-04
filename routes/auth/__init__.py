import os
import json
import bcrypt
import jwt
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, Dict, Any
import logging

logger = logging.getLogger(__name__)

# Configuration
AUTH_ENABLED = os.getenv("ENABLE_AUTH", "false").lower() in ("true", "1", "yes", "on")
DISABLE_REGISTRATION = os.getenv("DISABLE_REGISTRATION", "false").lower() in ("true", "1", "yes", "on")
JWT_SECRET = os.getenv("JWT_SECRET", "your-super-secret-jwt-key-change-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = int(os.getenv("JWT_EXPIRATION_HOURS", "24"))

# Paths
USERS_DIR = Path("./data/users")
USERS_FILE = USERS_DIR / "users.json"


class User:
    def __init__(self, username: str, email: str = None, role: str = "user", created_at: str = None, last_login: str = None, sso_provider: str = None, sso_id: str = None):
        self.username = username
        self.email = email
        self.role = role
        self.created_at = created_at or datetime.utcnow().isoformat()
        self.last_login = last_login
        self.sso_provider = sso_provider
        self.sso_id = sso_id

    def to_dict(self) -> Dict[str, Any]:
        return {
            "username": self.username,
            "email": self.email,
            "role": self.role,
            "created_at": self.created_at,
            "last_login": self.last_login,
            "sso_provider": self.sso_provider,
            "sso_id": self.sso_id
        }

    def to_public_dict(self) -> Dict[str, Any]:
        """Return user data without sensitive information"""
        return {
            "username": self.username,
            "email": self.email,
            "role": self.role,
            "created_at": self.created_at,
            "last_login": self.last_login,
            "sso_provider": self.sso_provider,
            "is_sso_user": self.sso_provider is not None
        }


class UserManager:
    def __init__(self):
        self.ensure_users_file()

    def ensure_users_file(self):
        """Ensure users directory and file exist"""
        USERS_DIR.mkdir(parents=True, exist_ok=True)
        if not USERS_FILE.exists():
            with open(USERS_FILE, 'w') as f:
                json.dump({}, f, indent=2)
            logger.info(f"Created users file at {USERS_FILE}")

    def load_users(self) -> Dict[str, Dict]:
        """Load users from file"""
        try:
            with open(USERS_FILE, 'r') as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Error loading users: {e}")
            return {}

    def save_users(self, users: Dict[str, Dict]):
        """Save users to file"""
        try:
            with open(USERS_FILE, 'w') as f:
                json.dump(users, f, indent=2)
        except Exception as e:
            logger.error(f"Error saving users: {e}")
            raise

    def hash_password(self, password: str) -> str:
        """Hash password using bcrypt"""
        return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

    def verify_password(self, password: str, hashed: str) -> bool:
        """Verify password against hash"""
        return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))

    def create_user(self, username: str, password: str = None, email: str = None, role: str = "user", sso_provider: str = None, sso_id: str = None) -> tuple[bool, str]:
        """Create a new user (traditional or SSO)"""
        users = self.load_users()
        
        if username in users:
            return False, "Username already exists"
        
        # For SSO users, password is None
        hashed_password = self.hash_password(password) if password else None
        user = User(username=username, email=email, role=role, sso_provider=sso_provider, sso_id=sso_id)
        
        users[username] = {
            **user.to_dict(),
            "password_hash": hashed_password
        }
        
        self.save_users(users)
        logger.info(f"Created user: {username} (SSO: {sso_provider or 'No'})")
        return True, "User created successfully"

    def authenticate_user(self, username: str, password: str) -> Optional[User]:
        """Authenticate user and return User object if successful"""
        users = self.load_users()
        
        if username not in users:
            return None
        
        user_data = users[username]
        if not self.verify_password(password, user_data["password_hash"]):
            return None
        
        # Update last login
        user_data["last_login"] = datetime.utcnow().isoformat()
        users[username] = user_data
        self.save_users(users)
        
        return User(**{k: v for k, v in user_data.items() if k != "password_hash"})

    def get_user(self, username: str) -> Optional[User]:
        """Get user by username"""
        users = self.load_users()
        
        if username not in users:
            return None
        
        user_data = users[username]
        return User(**{k: v for k, v in user_data.items() if k != "password_hash"})

    def list_users(self) -> list[User]:
        """List all users"""
        users = self.load_users()
        return [User(**{k: v for k, v in user_data.items() if k != "password_hash"}) 
                for user_data in users.values()]

    def delete_user(self, username: str) -> tuple[bool, str]:
        """Delete a user"""
        users = self.load_users()
        
        if username not in users:
            return False, "User not found"
        
        del users[username]
        self.save_users(users)
        logger.info(f"Deleted user: {username}")
        return True, "User deleted successfully"

    def update_user_role(self, username: str, role: str) -> tuple[bool, str]:
        """Update user role"""
        users = self.load_users()
        
        if username not in users:
            return False, "User not found"
        
        users[username]["role"] = role
        self.save_users(users)
        logger.info(f"Updated role for user {username} to {role}")
        return True, "User role updated successfully"


class TokenManager:
    @staticmethod
    def create_token(user: User) -> str:
        """Create JWT token for user"""
        payload = {
            "username": user.username,
            "role": user.role,
            "exp": datetime.utcnow() + timedelta(hours=JWT_EXPIRATION_HOURS),
            "iat": datetime.utcnow()
        }
        return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

    @staticmethod
    def verify_token(token: str) -> Optional[Dict[str, Any]]:
        """Verify JWT token and return payload"""
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
            return payload
        except jwt.ExpiredSignatureError:
            return None
        except jwt.InvalidTokenError:
            return None


# Global instances
user_manager = UserManager()
token_manager = TokenManager()


def create_default_admin():
    """Create default admin user if no users exist"""
    if not AUTH_ENABLED:
        return
    
    users = user_manager.load_users()
    if not users:
        default_username = os.getenv("DEFAULT_ADMIN_USERNAME", "admin")
        default_password = os.getenv("DEFAULT_ADMIN_PASSWORD", "admin123")
        
        success, message = user_manager.create_user(
            username=default_username,
            password=default_password,
            role="admin"
        )
        
        if success:
            logger.info(f"Created default admin user: {default_username}")
            logger.warning(f"Default admin password is: {default_password}")
            logger.warning("Please change the default admin password immediately!")
        else:
            logger.error(f"Failed to create default admin: {message}")


# Initialize default admin on import
create_default_admin()

# SSO functionality will be imported separately to avoid circular imports
SSO_AVAILABLE = True
