"""Admin endpoint'leri — /api/admin/ (yalnızca Admin rolü)"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user_id, get_db
from app.models.models import User, UserRole
from app.schemas.schemas import UserOut

router = APIRouter(prefix="/admin", tags=["Admin"])


async def require_admin(current_user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    """Admin rolü kontrolü."""
    result = await db.execute(select(User).where(User.user_id == uuid.UUID(current_user_id)))
    user = result.scalar_one_or_none()
    if not user or user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Bu işlem için Admin yetkisi gerekli")
    return user


@router.get("/users", response_model=list[UserOut])
async def list_users(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Tüm kullanıcıları listele (Admin)."""
    result = await db.execute(select(User))
    return result.scalars().all()


@router.patch("/users/{user_id}/role", response_model=UserOut)
async def update_user_role(
    user_id: uuid.UUID,
    role: UserRole,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Kullanıcı rolünü güncelle (Admin)."""
    result = await db.execute(select(User).where(User.user_id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı")

    user.role = role
    await db.commit()
    await db.refresh(user)
    return user
