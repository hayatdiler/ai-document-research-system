"""Atıf dışa aktarma endpoint'i — /api/citations/"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user_id, get_db
from app.models.models import Document
from app.services.llm_service import format_citation

router = APIRouter(prefix="/citations", tags=["Atıf"])

SUPPORTED_FORMATS = {"APA", "MLA", "BibTeX", "IEEE"}


@router.get("/{doc_id}")
async def export_citation(
    doc_id: uuid.UUID,
    format: str = Query(default="APA", description="APA | MLA | BibTeX | IEEE"),
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id),
):
    """İstenen formatta atıf metni döner."""
    if format not in SUPPORTED_FORMATS:
        raise HTTPException(
            status_code=400,
            detail=f"Desteklenmeyen format. Seçenekler: {', '.join(SUPPORTED_FORMATS)}",
        )

    result = await db.execute(select(Document).where(Document.doc_id == doc_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Belge bulunamadı")

    if not doc.citation_data:
        raise HTTPException(status_code=422, detail="Bu belge için atıf meta verisi eksik")

    citation_text = format_citation(doc.citation_data, format)
    return {"format": format, "citation": citation_text}
