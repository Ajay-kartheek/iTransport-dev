"""Generate a VAPID key pair for web push (prints JSON with both keys).

uv run python -m scripts.gen_vapid
"""

from __future__ import annotations

import base64
import json

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def main() -> None:
    key = ec.generate_private_key(ec.SECP256R1())
    private_raw = key.private_numbers().private_value.to_bytes(32, "big")
    public_raw = key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    print(json.dumps({"publicKey": b64url(public_raw), "privateKey": b64url(private_raw)}))


if __name__ == "__main__":
    main()
