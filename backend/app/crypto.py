"""Encryption at rest for environment variable values (Fernet = AES-128-CBC + HMAC).

The Fernet key is DERIVED from PAAS_SECRET_KEY with HKDF instead of reusing the
JWT secret directly: one master secret, separate keys per purpose. The "info"
label makes this key unrelated to anything else derived from the same secret.

Trade-off: rotating PAAS_SECRET_KEY makes stored values undecryptable. A real
system would keep the key in a KMS / Vault and support key rotation.
"""
import base64

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from .config import SECRET_KEY


def _derive_key() -> bytes:
    raw = HKDF(algorithm=hashes.SHA256(), length=32, salt=None,
               info=b"hostra-env-vars").derive(SECRET_KEY.encode())
    return base64.urlsafe_b64encode(raw)


_fernet = Fernet(_derive_key())


def encrypt(value: str) -> str:
    return _fernet.encrypt(value.encode()).decode()


def decrypt(token: str) -> str:
    try:
        return _fernet.decrypt(token.encode()).decode()
    except InvalidToken:
        raise ValueError("Cannot decrypt value (was PAAS_SECRET_KEY changed?)")
