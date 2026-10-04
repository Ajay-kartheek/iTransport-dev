"""A small in-memory sliding-window limiter (per Cloud Run instance).

The per-account lockout stored in Firestore is the real brute-force defence;
this only slows down a single client hammering one instance.
"""

from __future__ import annotations

import time
from collections import deque

from fastapi import Request

_MAX_KEYS = 10_000


class SlidingWindowLimiter:
    def __init__(self, limit: int, window_s: float) -> None:
        self.limit = limit
        self.window_s = window_s
        self._hits: dict[str, deque[float]] = {}

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        hits = self._hits.get(key)
        if hits is None:
            if len(self._hits) >= _MAX_KEYS:
                self._prune(now)
            hits = self._hits[key] = deque()
        while hits and now - hits[0] > self.window_s:
            hits.popleft()
        if len(hits) >= self.limit:
            return False
        hits.append(now)
        return True

    def _prune(self, now: float) -> None:
        """Forget idle clients first; if still full, the ones idle the longest."""
        idle = [k for k, h in self._hits.items() if not h or now - h[-1] > self.window_s]
        for key in idle:
            del self._hits[key]
        if len(self._hits) >= _MAX_KEYS:
            by_last_hit = sorted(self._hits, key=lambda k: self._hits[k][-1])
            for key in by_last_hit[: len(by_last_hit) // 2]:
                del self._hits[key]


def client_ip(request: Request) -> str:
    """The caller's address as Google's front end saw it.

    Clients can send their own X-Forwarded-For; Cloud Run appends the real address
    at the end, so only the right-most entry can be trusted.
    """
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"
