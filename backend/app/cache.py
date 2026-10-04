"""A tiny per-instance TTL cache for hot, read-mostly Firestore documents."""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from typing import Any

_store: dict[str, tuple[float, Any]] = {}
_MAX_ENTRIES = 2_000


async def cached(key: str, ttl_s: float, loader: Callable[[], Awaitable[Any]]) -> Any:
    hit = _store.get(key)
    now = time.monotonic()
    if hit and hit[0] > now:
        return hit[1]
    value = await loader()
    if len(_store) >= _MAX_ENTRIES:
        _store.clear()
    _store[key] = (now + ttl_s, value)
    return value


def invalidate(prefix: str = "") -> None:
    if not prefix:
        _store.clear()
        return
    for key in [k for k in _store if k.startswith(prefix)]:
        _store.pop(key, None)
