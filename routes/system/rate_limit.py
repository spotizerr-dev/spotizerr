from fastapi import APIRouter, Depends, HTTPException
from routes.utils.redis_rate_limiter import global_rate_limiter
import logging

logger = logging.getLogger(__name__)
router = APIRouter()

@router.get("/current", response_model=dict, summary="Get current rate limit usage")
async def get_current_rate_limit_usage():
    """
    Returns the current rate limit consumption
    """
    try:
        usage = global_rate_limiter.get_current_usage()
        return usage
    except Exception as e:
        logger.error(f"Error getting current rate limit usage: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")