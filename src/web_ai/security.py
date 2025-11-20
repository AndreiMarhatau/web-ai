from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable, Sequence

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey


def _load_private_key(path: Path) -> Ed25519PrivateKey:
    data = path.read_bytes()
    return serialization.load_pem_private_key(data, password=None)


def _load_public_key(data: bytes) -> Ed25519PublicKey:
    return serialization.load_pem_public_key(data)


def ensure_keypair(private_path: Path, public_path: Path) -> tuple[Ed25519PrivateKey, Ed25519PublicKey]:
    """Load an Ed25519 keypair or create it if missing."""
    private_path.parent.mkdir(parents=True, exist_ok=True)
    public_path.parent.mkdir(parents=True, exist_ok=True)

    if private_path.exists():
        private_key = _load_private_key(private_path)
    else:
        private_key = Ed25519PrivateKey.generate()
        private_bytes = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
        private_path.write_bytes(private_bytes)
        private_path.chmod(0o600)

    public_key = private_key.public_key()
    if not public_path.exists():
        public_bytes = public_key.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        public_path.write_bytes(public_bytes)

    return private_key, public_key


def serialize_public_key(public_key: Ed25519PublicKey) -> str:
    return public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("utf-8")


def load_public_keys(values: Iterable[str]) -> list[Ed25519PublicKey]:
    keys: list[Ed25519PublicKey] = []
    for raw in values:
        if not raw:
            continue
        candidate = raw.strip()
        path = Path(candidate)
        if path.exists():
            data = path.read_bytes()
        else:
            # If the candidate looks like a path but is missing, skip until available.
            # This allows nodes to start before the head has written its key file.
            if path.suffix:  # crude hint that it's a file path
                continue
            data = candidate.encode("utf-8")
        try:
            keys.append(_load_public_key(data))
        except Exception as exc:  # pragma: no cover - defensive
            raise ValueError(f"Invalid public key provided: {candidate}") from exc
    return keys


@dataclass
class TokenSigner:
    private_key: Ed25519PrivateKey
    algorithm: str = "EdDSA"
    audience: str = "node"
    ttl_seconds: int = 60

    def sign_for_node(self, *, node_id: str) -> str:
        now = datetime.now(timezone.utc)
        payload = {
            "sub": "head",
            "aud": self.audience,
            "node_id": node_id,
            "iat": now,
            "exp": now + timedelta(seconds=self.ttl_seconds),
        }
        return jwt.encode(payload, self.private_key, algorithm=self.algorithm)


@dataclass
class TokenVerifier:
    public_keys: Sequence[Ed25519PublicKey]
    audience: str = "node"
    algorithm: str = "EdDSA"

    def verify_for_node(self, token: str, *, node_id: str) -> dict:
        last_error: Exception | None = None
        for key in self.public_keys:
            try:
                decoded = jwt.decode(
                    token,
                    key,
                    algorithms=[self.algorithm],
                    audience=self.audience,
                )
                if decoded.get("node_id") != node_id:
                    raise jwt.InvalidTokenError("Token node_id mismatch")
                return decoded
            except Exception as exc:  # pragma: no cover - attempts sequential keys
                last_error = exc
                continue
        if last_error:
            raise last_error
        raise jwt.InvalidTokenError("No public keys configured")
