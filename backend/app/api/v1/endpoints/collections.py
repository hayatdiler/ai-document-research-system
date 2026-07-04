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
    col_result = await db.execute(
        select(Collection).where(
            Collection.collection_id == collection_id,
            Collection.owner_id == uuid.UUID(current_user_id),
        )
    )
    if not col_result.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="Bu koleksiyona erişim yetkiniz yok")

    doc_result = await db.execute(
        select(Document).where(
            Document.doc_id == doc_id,
            Document.owner_id == uuid.UUID(current_user_id),
        )
    )
    if not doc_result.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="Bu belgeye erişim yetkiniz yok")

    link = CollectionDocument(collection_id=collection_id, doc_id=doc_id)
    db.add(link)
    await db.commit()


@router.post("/{collection_id}/report", response_model=ReportOut, status_code=status.HTTP_202_ACCEPTED)
async def request_collection_report(
    collection_id: uuid.UUID,
    report_type: str = "literature",
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

    generate_collection_report_task.delay(
        str(report.report_id),
        str(collection_id),
        current_user_id,
        report_type,
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

    col_result = await db.execute(
        select(Collection).where(
            Collection.collection_id == collection_id,
            Collection.owner_id == uuid.UUID(current_user_id),
        )
    )
    if not col_result.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="Bu koleksiyona erişim yetkiniz yok")

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

from fastapi import Query as FastAPIQuery
from fastapi.responses import StreamingResponse
import io

@router.get("/{collection_id}/report/download")
async def download_report(
    collection_id: uuid.UUID,
    fmt: str = FastAPIQuery(default="pdf", alias="format", description="pdf veya docx"),
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id),
):
    """Koleksiyon raporunu PDF veya DOCX olarak indir."""
    result = await db.execute(
        select(CollectionReport)
        .where(CollectionReport.collection_id == collection_id)
        .where(CollectionReport.status == JobStatus.DONE)
        .order_by(CollectionReport.created_at.desc())
        .limit(1)
    )
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Rapor bulunamadı")

    # ── DOCX ──────────────────────────────────────────────────────────────────
    if fmt == "docx":
        if not report.report_text:
            raise HTTPException(
                status_code=422,
                detail="Bu rapor DOCX için gerekli ham metni içermiyor. "
                       "Lütfen raporu yeniden oluşturun.",
            )
        col_result = await db.execute(
            select(Collection).where(Collection.collection_id == collection_id)
        )
        col = col_result.scalar_one_or_none()
        col_name = col.name if col else "Koleksiyon"

        from app.services.export_service import generate_docx
        docx_bytes = generate_docx(col_name, report.report_text)

        safe_name = col_name.replace(" ", "_")[:30]
        return StreamingResponse(
            io.BytesIO(docx_bytes),
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f"attachment; filename=rapor_{safe_name}.docx"},
        )

    # ── PDF (varsayılan) ──────────────────────────────────────────────────────
    if not report.file_path:
        raise HTTPException(status_code=404, detail="PDF dosyası bulunamadı")

    from app.services.storage_service import download_file
    file_bytes = download_file(report.file_path)

    return StreamingResponse(
        io.BytesIO(file_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=rapor.pdf"},
    )


@router.get("/{collection_id}/export/bibtex")
async def export_bibtex(
    collection_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id),
):
    """Koleksiyondaki tüm belgelerin BibTeX atıflarını tek .bib dosyası olarak indir."""
    col_result = await db.execute(
        select(Collection).where(
            Collection.collection_id == collection_id,
            Collection.owner_id == uuid.UUID(current_user_id),
        )
    )
    col = col_result.scalar_one_or_none()
    if not col:
        raise HTTPException(status_code=403, detail="Bu koleksiyona erişim yetkiniz yok")

    doc_result = await db.execute(
        select(Document)
        .join(CollectionDocument, CollectionDocument.doc_id == Document.doc_id)
        .where(CollectionDocument.collection_id == collection_id)
        .order_by(Document.upload_date.asc())
    )
    docs = doc_result.scalars().all()

    if not docs:
        raise HTTPException(status_code=422, detail="Koleksiyonda belge bulunamadı")

    from app.services.export_service import generate_bibtex
    bib_content = generate_bibtex(docs)

    safe_name = col.name.replace(" ", "_")[:30]
    return StreamingResponse(
        io.BytesIO(bib_content.encode("utf-8")),
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={safe_name}.bib"},
    )