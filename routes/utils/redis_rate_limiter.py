import time
import redis
import logging
import random
import re
from functools import wraps
import threading
from typing import Callable, Any
from routes.utils.celery_config import REDIS_URL

logger = logging.getLogger(__name__)

class RedisRateLimiter:
    """
    Redis-backed rate limiter supporting both per-second and sliding window limits.
    """

    def __init__(
        self,
        redis_client: redis.Redis,
        key_prefix: str = "api_rate_limit",
        max_requests_per_window: int = 90,
        window_size_seconds: int = 30,
        max_requests_per_second: int = 10,
        per_second_window: int = 1,
        usage_logger: bool = False,
        retry_attempts: int = 3,
        base_delay: float = 1.0,
    ):
        self.redis_client = redis_client
        self.key_timestamps = f"{key_prefix}:timestamps"
        self.key_retry_after_until = f"{key_prefix}:retry_after_until"
        self.max_requests_per_window = max_requests_per_window
        self.window_size_seconds = window_size_seconds
        self.max_requests_per_second = max_requests_per_second
        self.per_second_window = per_second_window
        self.retry_attempts = retry_attempts
        self.base_delay = base_delay

        # Cleanup Redis keys on startup
        self._cleanup_keys_on_startup()

        if usage_logger:
            self._start_usage_logger()

    def _zcard(self, key: str) -> int:
        """Return the cardinality of the sorted set as int."""
        # Pylance may think this is Awaitable, but for sync redis-py this is int.
        return int(self.redis_client.zcard(key))  # type: ignore

    def _cleanup_old_timestamps(self, current_time: float) -> None:
        """Remove old timestamps outside the sliding window using a pipeline for efficiency."""
        pipe = self.redis_client.pipeline()
        pipe.zremrangebyscore(self.key_timestamps, 0, current_time - self.window_size_seconds)
        pipe.execute()

    def _cleanup_keys_on_startup(self) -> None:
        """Cleanup all Redis keys with the same prefix on startup to prevent stale data accumulation."""
        try:
            # Delete both keys if they exist
            self.redis_client.delete(self.key_timestamps, self.key_retry_after_until)
            logger.info(f"Cleaned up Redis keys: {self.key_timestamps}, {self.key_retry_after_until}")
        except Exception as e:
            logger.warning(f"Failed to cleanup Redis keys on startup: {e}")

    def get_current_usage(self) -> dict:
        """
        Returns the current rate limit consumption.
        """
        current_time = time.time()
        self._cleanup_old_timestamps(current_time)
        current_requests_per_second = int(self.redis_client.zcount(self.key_timestamps, current_time - self.per_second_window, current_time))  # type: ignore
        current_requests_per_window = self._zcard(self.key_timestamps)
        return {
            "current_requests_per_second": current_requests_per_second,
            "max_requests_per_second": self.max_requests_per_second,
            "current_requests_per_window": current_requests_per_window,
            "max_requests_per_window": self.max_requests_per_window,
            "window_size_seconds": self.window_size_seconds,
        }

    def _start_usage_logger(self) -> None:
        """
        Starts a background thread that logs the current rate limit usage every second.
        For debugging purposes only.
        """
        def log_usage():
            while True:
                try:
                    usage = self.get_current_usage()
                    logger.debug(
                        f"Rate limit usage: "
                        f"{usage['current_requests_per_second']}/{usage['max_requests_per_second']} req/s, "
                        f"{usage['current_requests_per_window']}/{usage['max_requests_per_window']} req/{usage['window_size_seconds']}s"
                    )
                except Exception as e:
                    logger.error(f"Error logging rate limit usage: {e}")
                time.sleep(1)
        t = threading.Thread(target=log_usage, daemon=True)
        t.start()

    def _get_retry_after_until(self) -> float:
        val = self.redis_client.get(self.key_retry_after_until)
        # Pylance may think this is Awaitable, but for sync redis-py this is bytes.
        return float(val.decode('utf-8')) if val else 0.0  # type: ignore

    def _set_retry_after_until(self, timestamp: float) -> None:
        self.redis_client.set(self.key_retry_after_until, str(timestamp))
        # Set expiration for the retry_after_until key to prevent stale data accumulation
        # Expire after window_size_seconds + 60 seconds buffer
        self.redis_client.expire(self.key_retry_after_until, self.window_size_seconds + 60)

    def _check_and_handle_retry_after(self) -> bool:
        """
        Check if there's a retry-after in effect and handle it if needed.
        Returns True if we need to retry, False otherwise.
        """
        retry_after_until = self._get_retry_after_until()
        now = time.time()
        if now < retry_after_until:
            sleep_duration = retry_after_until - now
            logger.warning(f"Rate limiter active: Respecting Retry-After. Delaying task for {sleep_duration:.2f} seconds.")
            time.sleep(sleep_duration)
            return True  # Need to retry
        return False  # No retry-after in effect
    
    def _check_limit_and_wait(
        self,
        current_requests: int,
        max_requests: int,
        window_size: int,
        limit_type: str
    ) -> bool:
        """
        Check if a limit is exceeded and wait if needed.
        Returns True if we need to retry, False otherwise.
        """
        if current_requests >= max_requests:
            oldest = self.redis_client.zrange(self.key_timestamps, 0, 0, withscores=True)
            if oldest:
                # Pylance may think this is Awaitable, but for sync redis-py this is a list of tuples.
                now = time.time()
                time_to_wait = oldest[0][1] + window_size - now  # type: ignore
                if time_to_wait > 0:
                    logger.warning(f"Rate limiter active: {limit_type} limit ({max_requests}) reached. Delaying for {time_to_wait:.2f} seconds.")
                    time.sleep(time_to_wait)
                    return True  # Need to retry
        return False  # No need to retry
    
    def _wait_for_rate_limit(self, current_time: float) -> None:
        """
        Handles the waiting logic for rate limiting, including respecting Retry-After
        and proactive sliding window limits. Ensures atomicity using Redis transactions.
        """
        for attempt in range(self.retry_attempts):
            # Check and handle retry-after first
            if self._check_and_handle_retry_after():
                continue  # Re-check after handling retry-after

            # Use pipeline for atomicity and efficiency
            now = time.time()
            pipe = self.redis_client.pipeline()
            # Remove old timestamps outside sliding window
            pipe.zremrangebyscore(self.key_timestamps, 0, now - self.window_size_seconds)
            # Get per-second count
            pipe.zcount(self.key_timestamps, now - self.per_second_window, now)
            # Get sliding window count
            pipe.zcard(self.key_timestamps)
            results = pipe.execute()
            current_requests_per_second = int(results[1])
            current_requests_per_window = int(results[2])

            # Check per-second burst limit
            if self._check_limit_and_wait(
                current_requests_per_second,
                self.max_requests_per_second,
                self.per_second_window,
                "Per-second"
            ):
                continue  # Re-check after waiting

            # Check sliding window limit
            if self._check_limit_and_wait(
                current_requests_per_window,
                self.max_requests_per_window,
                self.window_size_seconds,
                "Window"
            ):
                continue  # Re-check after waiting

            # If within limits, record the request timestamp (with unique member)
            member = f"{now}-{random.random()}"
            self.redis_client.zadd(self.key_timestamps, {member: now})
            return  # Allowed

        raise Exception("Rate limit exceeded after multiple retries.")

    def rate_limit_decorator(self, func: Callable[..., Any]) -> Callable[..., Any]:
        """
        Decorator to apply rate limiting to a function.
        """
        @wraps(func)
        def wrapper(*args, **kwargs):
            for attempt in range(self.retry_attempts):
                try:
                    self._wait_for_rate_limit(time.time())
                    return func(*args, **kwargs)
                except Exception as e:
                    msg = str(e).lower()
                    if "429" in msg or "rate limit" in msg:
                        retry_after_match = re.search(r"retry-after: (\d+)", str(e), re.IGNORECASE)
                        if retry_after_match:
                            retry_after_seconds = int(retry_after_match.group(1))
                            logger.warning(f"API Rate limited, respecting Retry-After: {retry_after_seconds} seconds.")
                            self._set_retry_after_until(time.time() + retry_after_seconds)
                        else:
                            jitter = random.uniform(0, 1)
                            delay = self.base_delay * (2 ** attempt) + jitter
                            logger.warning(f"API Rate limited, retrying in {delay:.2f} seconds (with jitter)...")
                            self._set_retry_after_until(time.time() + delay)
                        if attempt < self.retry_attempts - 1:
                            continue
                    logger.error(f"Unexpected error during API call: {e}")
                    raise
            raise Exception("Rate limit exceeded after maximum retries.")
        return wrapper

# Initialize Redis client and global rate limiter instance
redis_client = redis.Redis.from_url(REDIS_URL)
global_rate_limiter = RedisRateLimiter(redis_client, usage_logger=True)