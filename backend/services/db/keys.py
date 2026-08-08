import secrets

_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

def mint_key(length: int = 8) -> str:
    """Short opaque JSONB key for a property. Immutable once assigned."""
    return "".join(secrets.choice(_ALPHABET) for _ in range(length))
