"""Request bodies. Field names are camelCase to match the JSON the web app sends."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .timeutil import is_date_str, is_hhmm

Direction = Literal["AM", "PM"]
Role = Literal["ADMIN", "DRIVER", "PARENT"]


class Body(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class LoginBody(Body):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class ChangePasswordBody(Body):
    currentPassword: str = Field(min_length=1, max_length=256)
    newPassword: str = Field(min_length=1, max_length=256)


class DeclarationBody(Body):
    studentId: str = Field(min_length=1, max_length=64)
    date: str
    direction: Direction
    status: Literal["riding", "absent"]

    @field_validator("date")
    @classmethod
    def _date(cls, v: str) -> str:
        if not is_date_str(v):
            raise ValueError("date must be YYYY-MM-DD")
        return v


class StartTripBody(Body):
    busId: str = Field(min_length=1, max_length=64)
    direction: Direction


class FixIn(Body):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    accuracy: float = Field(gt=0, le=100_000)
    at: int = Field(gt=0)
    speed: float | None = Field(default=None, ge=0, le=200)
    heading: float | None = Field(default=None, ge=0, le=360)


class LocationsBody(Body):
    fixes: list[FixIn] = Field(min_length=1, max_length=120)


class PushKeys(Body):
    p256dh: str = Field(min_length=1, max_length=256)
    auth: str = Field(min_length=1, max_length=128)


class PushSubscriptionBody(Body):
    endpoint: str = Field(min_length=10, max_length=1024)
    keys: PushKeys
    expirationTime: int | None = None

    @field_validator("endpoint")
    @classmethod
    def _https(cls, v: str) -> str:
        if not v.startswith("https://"):
            raise ValueError("endpoint must be https")
        return v


class PushUnsubscribeBody(Body):
    endpoint: str = Field(min_length=10, max_length=1024)


class LatLng(Body):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class CampusIn(Body):
    id: str | None = Field(default=None, max_length=64)
    name: str = Field(min_length=1, max_length=80)
    address: str = Field(default="", max_length=200)
    location: LatLng


class SchoolSettingsBody(Body):
    name: str = Field(min_length=1, max_length=80)
    address: str = Field(default="", max_length=200)
    campuses: list[CampusIn] = Field(default_factory=list, max_length=4)
    amCutoff: str
    pmCutoff: str
    approachMinutes: int = Field(ge=2, le=30)
    arrivalRadiusM: int = Field(ge=50, le=300)
    serviceDays: list[int] = Field(min_length=1, max_length=7)
    holidays: list[str] = Field(default_factory=list, max_length=120)

    @field_validator("amCutoff", "pmCutoff")
    @classmethod
    def _hhmm(cls, v: str) -> str:
        if not is_hhmm(v):
            raise ValueError("use HH:MM (24-hour)")
        return v

    @field_validator("serviceDays")
    @classmethod
    def _days(cls, v: list[int]) -> list[int]:
        if any(d < 1 or d > 7 for d in v):
            raise ValueError("days are 1 (Mon) to 7 (Sun)")
        return sorted(set(v))

    @field_validator("holidays")
    @classmethod
    def _holidays(cls, v: list[str]) -> list[str]:
        if any(not is_date_str(d) for d in v):
            raise ValueError("holidays must be YYYY-MM-DD")
        return sorted(set(v))


class BusBody(Body):
    number: str = Field(min_length=1, max_length=12)
    plate: str = Field(default="", max_length=20)
    capacity: int | None = Field(default=None, ge=1, le=120)
    routeId: str | None = Field(default=None, max_length=64)
    active: bool = True


class StopIn(Body):
    id: str | None = Field(default=None, max_length=64)
    name: str = Field(min_length=1, max_length=80)
    address: str = Field(default="", max_length=200)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class RouteBody(Body):
    name: str = Field(min_length=1, max_length=60)
    stops: list[StopIn] = Field(default_factory=list, max_length=60)
    # Campuses the bus visits, in morning order (afternoon trips run in reverse).
    campusIds: list[str] = Field(default_factory=list, max_length=4)


class StudentBody(Body):
    name: str = Field(min_length=1, max_length=80)
    grade: str = Field(default="", max_length=20)
    routeId: str | None = Field(default=None, max_length=64)
    stopId: str | None = Field(default=None, max_length=64)
    campusId: str | None = Field(default=None, max_length=64)
    parentIds: list[str] = Field(default_factory=list, max_length=4)
    active: bool = True


class UserCreateBody(Body):
    name: str = Field(min_length=1, max_length=80)
    username: str = Field(min_length=3, max_length=32, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]+$")
    role: Role
    mobile: str = Field(default="", max_length=20)
    busIds: list[str] = Field(default_factory=list, max_length=20)


class UserUpdateBody(Body):
    name: str = Field(min_length=1, max_length=80)
    mobile: str = Field(default="", max_length=20)
    active: bool = True
    busIds: list[str] = Field(default_factory=list, max_length=20)
