"""What every route shares: the database session, the error shape, and the rate limits."""

import time
from collections import defaultdict, deque

from fastapi import Depends, Request
from fastapi.responses import JSONResponse

from db import SessionLocal


def get_session():
    with SessionLocal() as session:
        yield session


def error_response(status: int, code: str, message: str, detail: object = None) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message, "detail": detail}})


def not_found(thing: str) -> JSONResponse:
    return error_response(404, f"{thing.upper()}_NOT_FOUND", f"{thing.capitalize()} does not exist")


class RateLimiter:
    """A sliding window of request times for each client."""

    def __init__(self, limit: int, window_seconds: float = 60):
        self.limit = limit
        self.window = window_seconds
        self.hits: dict[str, deque[float]] = defaultdict(deque)

    def hit(self, client: str) -> float | None:
        """Count a request, or return the seconds until the client may try again."""
        now = time.monotonic()
        hits = self.hits[client]
        while hits and hits[0] <= now - self.window:
            hits.popleft()
        if len(hits) >= self.limit:
            return hits[0] + self.window - now
        hits.append(now)
        return None


# ponytail: counts live in this one process's memory, which fits one local server; move them to a
# shared store such as Postgres if the API ever runs as several workers, or each keeps its own count
LIMITS = {
    # Only replies spend the Ollama usage limit, so they are limited hardest
    "model": RateLimiter(limit=20),
    # Notes and tasks save often while the owner types, so everything else gets more room
    "api": RateLimiter(limit=240),
}


class RateLimited(Exception):
    def __init__(self, limit: int, retry_after: float):
        self.limit = limit
        self.retry_after = retry_after


def rate_limit(bucket: str):
    # async, so the check runs on the event loop one request at a time and needs no lock
    async def check(request: Request) -> None:
        limiter = LIMITS[bucket]
        retry_after = limiter.hit(request.client.host if request.client else "unknown")
        if retry_after is not None:
            raise RateLimited(limiter.limit, retry_after)

    return Depends(check)
