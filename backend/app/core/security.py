from datetime import datetime, timedelta, timezone
from typing import Any

from jose import JWTError, jwt
from passlib.context import CryptContext
import redis.asyncio as aioredis

from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# ── Redis bağlantısı ──────────────────────────────────────────────────────────
redis_client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)

# ── Şifre ────────────────────────────────────────────────────────────────────

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

# ── JWT ──────────────────────────────────────────────────────────────────────

def create_access_token(subject: Any, expires_delta: timedelta | None = None) -> str:
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    payload = {"sub": str(subject), "exp": expire}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)

def decode_access_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        return payload
    except JWTError:
        return None

# ── Redis Blacklist ───────────────────────────────────────────────────────────

async def blacklist_token(token: str) -> None:
    """Token'ı Redis'e ekle, süresi dolunca otomatik silinir."""
    payload = decode_access_token(token)
    if not payload:
        return
    expire = payload.get("exp")
    ttl = int(expire - datetime.now(timezone.utc).timestamp())
    if ttl > 0:
        await redis_client.setex(f"blacklist:{token}", ttl, "1")

async def is_token_blacklisted(token: str) -> bool:
    """Token blacklist'te mi kontrol et."""
    result = await redis_client.get(f"blacklist:{token}")
    return result is not None