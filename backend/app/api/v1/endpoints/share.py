"""Koleksiyon paylaşım endpoint'leri."""
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.deps import get_current_user_id, get_db
from app.models.models import Collection, CollectionDocument, CollectionShare, Document

router = APIRouter(tags=["Paylaşım"])


class ShareResponse(BaseModel):
    token: str
    share_url: str
    expires_at: datetime | None
    created_at: datetime


class SharedCollectionResponse(BaseModel):
    collection_id: str
    name: str
    description: str | None
    documents: list[dict]
    shared_by: str
    expires_at: datetime | None


# ── Kimlik doğrulamalı endpointler ────────────────────────────────────────────

@router.post("/collections/{collection_id}/share", response_model=ShareResponse)
async def create_or_get_share_link(
    collection_id: uuid.UUID,
    expires_days: int | None = None,
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id),
):
    """
    Koleksiyon için paylaşım linki oluştur.
    Aktif link varsa onu döner; yoksa yeni token üretir.
    expires_days: kaç gün geçerli (None → süresiz).
    """
    col_res = await db.execute(
        select(Collection).where(
            Collection.collection_id == collection_id,
            Collection.owner_id == uuid.UUID(current_user_id),
        )
    )
    if not col_res.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="Bu koleksiyona erişim yetkiniz yok")

    # Aktif paylaşım var mı?
    existing = await db.execute(
        select(CollectionShare).where(
            CollectionShare.collection_id == collection_id,
            CollectionShare.is_active == True,
        )
    )
    share = existing.scalar_one_or_none()

    if share:
        # Süresi geçmişse iptal et, yenisini üret
        if share.expires_at and share.expires_at < datetime.now(timezone.utc):
            share.is_active = False
            await db.commit()
            share = None

    if not share:
        expires_at = (
            datetime.now(timezone.utc) + timedelta(days=expires_days)
            if expires_days else None
        )
        share = CollectionShare(
            share_id=uuid.uuid4(),
            collection_id=collection_id,
            token=secrets.token_urlsafe(16),
            created_by=uuid.UUID(current_user_id),
            is_active=True,
            expires_at=expires_at,
        )
        db.add(share)
        await db.commit()
        await db.refresh(share)

    share_url = f"{settings.FRONTEND_URL}/#shared/{share.token}"
    return ShareResponse(
        token=share.token,
        share_url=share_url,
        expires_at=share.expires_at,
        created_at=share.created_at,
    )


@router.delete("/collections/{collection_id}/share", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_share_link(
    collection_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id),
):
    """Aktif paylaşım linkini iptal et."""
    col_res = await db.execute(
        select(Collection).where(
            Collection.collection_id == collection_id,
            Collection.owner_id == uuid.UUID(current_user_id),
        )
    )
    if not col_res.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="Bu koleksiyona erişim yetkiniz yok")

    share_res = await db.execute(
        select(CollectionShare).where(
            CollectionShare.collection_id == collection_id,
            CollectionShare.is_active == True,
        )
    )
    share = share_res.scalar_one_or_none()
    if share:
        share.is_active = False
        await db.commit()


# ── Public endpoint — kimlik doğrulama YOK ────────────────────────────────────

@router.get("/shared/{token}", response_model=SharedCollectionResponse)
async def view_shared_collection(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Token ile koleksiyona public, read-only erişim.
    Giriş gerektirmez.
    """
    share_res = await db.execute(
        select(CollectionShare).where(
            CollectionShare.token == token,
            CollectionShare.is_active == True,
        )
    )
    share = share_res.scalar_one_or_none()
    if not share:
        raise HTTPException(status_code=404, detail="Paylaşım linki bulunamadı veya süresi dolmuş")

    if share.expires_at and share.expires_at < datetime.now(timezone.utc):
        share.is_active = False
        await db.commit()
        raise HTTPException(status_code=410, detail="Paylaşım linkinin süresi dolmuş")

    col_res = await db.execute(
        select(Collection).where(Collection.collection_id == share.collection_id)
    )
    col = col_res.scalar_one_or_none()
    if not col:
        raise HTTPException(status_code=404, detail="Koleksiyon bulunamadı")

    # Sahibin adını çek
    from app.models.models import User
    owner_res = await db.execute(select(User).where(User.user_id == col.owner_id))
    owner = owner_res.scalar_one_or_none()
    shared_by = owner.full_name if owner else "Araştırmacı"

    # Koleksiyondaki belgeler (hassas alanlar hariç)
    doc_res = await db.execute(
        select(Document)
        .join(CollectionDocument, CollectionDocument.doc_id == Document.doc_id)
        .where(CollectionDocument.collection_id == share.collection_id)
        .order_by(Document.upload_date.asc())
    )
    docs = doc_res.scalars().all()

    return SharedCollectionResponse(
        collection_id=str(col.collection_id),
        name=col.name,
        description=col.description,
        shared_by=shared_by,
        expires_at=share.expires_at,
        documents=[
            {
                "title":        d.title,
                "summary":      d.summary,
                "keywords":     d.keywords or [],
                "citation_data": d.citation_data or {},
                "file_type":    d.file_type.value,
                "upload_date":  d.upload_date.isoformat(),
            }
            for d in docs
        ],
    )
