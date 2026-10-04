"""Firestore client and collection names."""

from __future__ import annotations

from google.cloud import firestore

from .config import get_settings

USERS = "users"
USERNAMES = "usernames"
STUDENTS = "students"
ROUTES = "routes"
BUSES = "buses"
TRIPS = "trips"
POINTS = "points"  # subcollection of trips
DECLARATIONS = "declarations"
PUSH_SUBS = "pushSubs"
REMINDERS = "reminders"
AUDIT = "audit"
SETTINGS = "settings"
SCHOOL_SETTINGS_DOC = "school"

_client: firestore.AsyncClient | None = None


def get_db() -> firestore.AsyncClient:
    global _client
    if _client is None:
        s = get_settings()
        _client = firestore.AsyncClient(project=s.project_id, database=s.database)
    return _client


def reset_db_client() -> None:
    """Used by tests to drop a client bound to a closed event loop."""
    global _client
    _client = None
