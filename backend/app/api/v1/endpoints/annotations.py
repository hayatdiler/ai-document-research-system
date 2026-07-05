"""Annotation ve threaded yorum endpoint'leri — /api/annotations/ & /api/comments/"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user_id, get_db
from app.models.models import Annotation, Comment
from app.schemas.schemas import AnnotationCreate, AnnotationOut, CommentCreate, CommentOut

router = APIRouter(tags=["Annotation & Yorum"])


@router.get("/annotations", response_model=list[AnnotationOut])
async def list_annotations(
    doc_id: uuid.UUID = Query(..., description="Belge ID"),
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id),
):
    """Bir belgeye ait tüm annotation'ları döner (sadece giriş yapan kullanıcının)."""
    result = await db.execute(
        select(Annotation)
        .where(
            Annotation.doc_id == doc_id,
            Annotation.user_id == uuid.UUID(current_user_id),
        )
        .order_by(Annotation.created_at.asc())
    )
    return result.scalars().all()


@router.post("/annotations", response_model=AnnotationOut, status_code=status.HTTP_201_CREATED)
async def create_annotation(
    payload: AnnotationCreate,
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id),
):
    """PDF üzerinde metin işaretle ve annotation kaydet."""
    ann = Annotation(
        annotation_id=uuid.uuid4(),
        doc_id=payload.doc_id,
        user_id=uuid.UUID(current_user_id),
        selected_text=payload.selected_text,
        page_number=payload.page_number,
        color=payload.color,
    )
    db.add(ann)
    await db.commit()
    await db.refresh(ann)
    return ann


@router.delete("/annotations/{annotation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_annotation(
    annotation_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id),
):
    """Annotation sil (sadece sahibi silebilir)."""
    result = await db.execute(
        select(Annotation).where(
            Annotation.annotation_id == annotation_id,
            Annotation.user_id == uuid.UUID(current_user_id),
        )
    )
    ann = result.scalar_one_or_none()
    if not ann:
        raise HTTPException(status_code=404, detail="Annotation bulunamadı")
    await db.delete(ann)
    await db.commit()


@router.post("/comments", response_model=CommentOut, status_code=status.HTTP_201_CREATED)
async def create_comment(
    payload: CommentCreate,
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id),
):
    """Annotation üzerine (isteğe bağlı threaded) yorum ekle."""
    comment = Comment(
        comment_id=uuid.uuid4(),
        annotation_id=payload.annotation_id,
        user_id=uuid.UUID(current_user_id),
        content=payload.content,
        parent_comment_id=payload.parent_comment_id,
    )
    db.add(comment)
    await db.commit()
    await db.refresh(comment)
    return comment
