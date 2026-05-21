"""Koleksiyon ve rapor endpoint'leri — /api/collections/"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user_id, get_db
from app.models.models import Collection, CollectionDocument, CollectionReport, Document, JobStatus
from app.schemas.schemas import CollectionCreate, CollectionOut, ReportOut
from app.tasks.llm_tasks import generate_collection_report_task

router = APIRouter(prefix="/collections", tags=["Koleksiyonlar"])


@router.post("", response_model=CollectionOut, status_code=status.HTTP_201_CREATED)
async def create_collection(
    payload: CollectionCreate,
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id),
):
    """Yeni koleksiyon oluştur."""
    col = Collection(
        collection_id=uuid.uuid4(),
        name=payload.name,
        description=payload.description,
        owner_id=uuid.UUID(current_user_id),
    )
    db.add(col)
    await db.commit()
    await db.refresh(col)
    return col


@router.get("", response_model=list[CollectionOut])
async def list_collections(
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id),
):
    """Kullanıcının koleksiyonlarını listele."""
    result = await db.execute(
        select(Collection).where(Collection.owner_id == uuid.UUID(current_user_id))
    )
    return result.scalars().all()


@router.post("/{collection_id}/documents/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def add_document_to_collection(
    collection_id: uuid.UUID,
    doc_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id),
):
    """Koleksiyona belge ekle."""
    link = CollectionDocument(collection_id=collection_id, doc_id=doc_id)
    db.add(link)
    await db.commit()


@router.post("/{collection_id}/report", response_model=ReportOut, status_code=status.HTTP_202_ACCEPTED)
async def request_collection_report(
    collection_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id),
):
    """Koleksiyon için LLM destekli rapor üretimini başlat."""
    report = CollectionReport(
        report_id=uuid.uuid4(),
        collection_id=collection_id,
        generated_by=uuid.UUID(current_user_id),
        status=JobStatus.PENDING,
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)

    # Celery ile asenkron rapor üretimini başlat
    generate_collection_report_task.delay(
        str(report.report_id),
        str(collection_id),
        current_user_id,
    )
    return report


@router.get("/{collection_id}/report", response_model=ReportOut)
async def get_report_status(
    collection_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id),
):
    result = await db.execute(
        select(CollectionReport)
        .where(CollectionReport.collection_id == collection_id)
        .order_by(CollectionReport.created_at.desc())
        .limit(1)
    )
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Rapor bulunamadı")
    return report


@router.get("/{collection_id}/documents")
async def get_collection_documents(
        collection_id: uuid.UUID,
        db: AsyncSession = Depends(get_db),
        current_user_id: str = Depends(get_current_user_id),
):
    from app.models.models import CollectionDocument
    from app.schemas.schemas import DocumentOut

    result = await db.execute(
        select(Document)
        .join(CollectionDocument, CollectionDocument.doc_id == Document.doc_id)
        .where(CollectionDocument.collection_id == collection_id)
    )
    docs = result.scalars().all()
    return [
        {
            "doc_id": str(d.doc_id),
            "title": d.title,
            "file_type": d.file_type.value,
            "upload_date": d.upload_date.isoformat(),
            "summary": d.summary,
            "status": "Done" if d.summary else "Processing",
            "citation_data": d.citation_data,
        }
        for d in docs
    ]

from fastapi.responses import StreamingResponse
import io

@router.get("/{collection_id}/report/download")
async def download_report(
    collection_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id),
):
    result = await db.execute(
        select(CollectionReport)
        .where(CollectionReport.collection_id == collection_id)
        .where(CollectionReport.status == JobStatus.DONE)
        .order_by(CollectionReport.created_at.desc())
        .limit(1)
    )
    report = result.scalar_one_or_none()
    if not report or not report.file_path:
        raise HTTPException(status_code=404, detail="Rapor bulunamadı")

    from app.services.storage_service import download_file
    file_bytes = download_file(report.file_path)

    return StreamingResponse(
        io.BytesIO(file_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=rapor.pdf"}
    )