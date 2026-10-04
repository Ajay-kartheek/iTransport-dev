"""A single error shape for the API: {"error": {"code": ..., "message": ...}}."""

from __future__ import annotations


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def not_found(what: str = "That item") -> ApiError:
    return ApiError(404, "not_found", f"{what} was not found.")


def bad_request(message: str, code: str = "bad_request") -> ApiError:
    return ApiError(400, code, message)


def conflict(message: str, code: str = "conflict") -> ApiError:
    return ApiError(409, code, message)


def forbidden(message: str = "You don't have access to this.") -> ApiError:
    return ApiError(403, "forbidden", message)
