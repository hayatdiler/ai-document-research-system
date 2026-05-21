"""Kimlik doğrulama endpoint'leri — /api/auth/"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from app.core.deps import get_db, get_current_user_id
from app.core.security import create_access_token, get_password_hash, verify_password
from app.models.models import User, UserRole
from app.schemas.schemas import LoginRequest, RegisterRequest, TokenResponse, UserOut

from slowapi import Limiter
from slowapi.util import get_remote_address

router = APIRouter(prefix="/auth", tags=["Auth"])

bearer_scheme = HTTPBearer()

@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """Yeni kullanıcı kaydı."""
    # E-posta kontrolü
    result = await db.execute(select(User).where(User.email == payload.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Bu e-posta zaten kayıtlı")

    user = User(
        user_id=uuid.uuid4(),
        email=payload.email,
        password_hash=get_password_hash(payload.password),
        full_name=payload.full_name,
        role=UserRole.RESEARCHER,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user

limiter = Limiter(key_func=get_remote_address)

@router.post("/login", response_model=TokenResponse)
@limiter.limit("5/minute")  # dakikada 5 deneme
async def login(request: Request, payload: LoginRequest, db: AsyncSession = Depends(get_db)):
    """E-posta/şifre ile giriş. JWT döner."""
    result = await db.execute(select(User).where(User.email == payload.email))
    user: User | None = result.scalar_one_or_none()

    if not user or not user.password_hash:
        raise HTTPException(status_code=401, detail="Geçersiz e-posta veya şifre")
    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Geçersiz e-posta veya şifre")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Hesap devre dışı")

    token = create_access_token(subject=str(user.user_id))
    return TokenResponse(access_token=token)


@router.get("/oauth/google")
async def oauth_google_redirect():
    """
    Google OAuth 2.0 yönlendirme.
    Gerçek implementasyonda Authlib ile Google'a yönlendirilir.
    """
    # TODO: Authlib ile Google OAuth flow
    return {"detail": "Google OAuth yönlendirmesi — .env'deki GOOGLE_CLIENT_ID gerekli"}


@router.get("/oauth/github")
async def oauth_github_redirect():
    """GitHub OAuth 2.0 yönlendirme."""
    # TODO: Authlib ile GitHub OAuth flow
    return {"detail": "GitHub OAuth yönlendirmesi — .env'deki GITHUB_CLIENT_ID gerekli"}

@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
):
    """Token'ı blacklist'e ekle — gerçek logout."""
    from app.core.security import blacklist_token
    await blacklist_token(credentials.credentials)

@router.get("/me", response_model=UserOut)
async def get_me(
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id),
):
    """Giriş yapmış kullanıcının bilgilerini döner."""
    result = await db.execute(select(User).where(User.user_id == uuid.UUID(current_user_id)))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı")
    return user