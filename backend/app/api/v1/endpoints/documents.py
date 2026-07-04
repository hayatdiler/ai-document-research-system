"""Belge yönetimi endpoint'leri — /api/documents/"""
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user_id, get_db
from app.models.models import Document, FileType, LLMJob, LLMJobType, JobStatus, ReadingStatus
from app.schemas.schemas import DocumentOut, ReadingStatusUpdate
from app.services import storage_service
from app.tasks.llm_tasks import process_document_task

from slowapi import Limiter
from slowapi.util import get_remote_address


from fastapi.responses import StreamingResponse
import io

limiter = Limiter(key_func=get_remote_address)

router = APIRouter(prefix="/documents", tags=["Belgeler"])

ALLOWED_MIME = {"application/pdf", "text/plain"}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB


@router.post("/upload", response_model=DocumentOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("20/minute")
async def upload_document(
    request: Request,
    file: UploadFile = File(...),
    title: str = Form(...),
    author: str | None = Form(None),
    year: int | None = Form(None),
    publisher: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id),
):

    """PDF veya TXT belge yükle. LLM analizi otomatik başlatılır."""
    # Dosya türü doğrulama
    if file.content_type not in ALLOWED_MIME:
        raise HTTPException(status_code=400, detail="Sadece PDF ve TXT dosyaları kabul edilir")

    file_bytes = await file.read()

    # ── Magic bytes kontrolü ──────────────────────────────────────────────────────
    MAGIC_BYTES = {
        "application/pdf": b"%PDF",
        "text/plain": None,  # TXT için magic bytes yok, içerik kontrolü yeterli
    }

    if file.content_type == "application/pdf":
        if not file_bytes.startswith(b"%PDF"):
            raise HTTPException(
                status_code=400,
                detail="Geçersiz dosya içeriği. Yüklenen dosya gerçek bir PDF değil.",
            )

    if file.content_type == "text/plain":
        try:
            file_bytes.decode("utf-8")
        except UnicodeDecodeError:
            raise HTTPException(
                status_code=400,
                detail="Geçersiz TXT dosyası. Dosya UTF-8 formatında olmalıdır.",
            )

    if len(file_bytes) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="Dosya boyutu 50 MB sınırını aşıyor")

    # MinIO'ya yükle
    object_name = storage_service.upload_file(
        file_bytes,
        file.filename or "document",
        file.content_type,
    )

    file_type = FileType.PDF if file.content_type == "application/pdf" else FileType.TXT

    # Citation meta verisi
    citation_data = {
        "title": title,
        "author": author,
        "year": year,
        "publisher": publisher,
    }

    # Belge kaydını oluştur
    doc = Document(
        doc_id=uuid.uuid4(),
        owner_id=uuid.UUID(current_user_id),
        title=title,
        file_path=object_name,
        file_type=file_type,
        citation_data=citation_data,
    )
    db.add(doc)

    # LLM job kaydı oluştur
    job = LLMJob(
        job_id=uuid.uuid4(),
        doc_id=doc.doc_id,
        job_type=LLMJobType.SUMMARIZE,
        status=JobStatus.PENDING,
    )
    db.add(job)
    await db.commit()
    await db.refresh(doc)

    # Celery ile asenkron işlemi tetikle
    process_document_task.delay(str(doc.doc_id), object_name, title)

    return doc


@router.get("/{doc_id}", response_model=DocumentOut)
async def get_document(
    doc_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id),
):
    """Belge detayını, özeti ve anahtar kelimeleri döner."""
    result = await db.execute(select(Document).where(Document.doc_id == doc_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Belge bulunamadı")
    if str(doc.owner_id) != current_user_id:
        raise HTTPException(status_code=403, detail="Bu belgeye erişim yetkiniz yok")
    return doc


@router.delete("/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
        doc_id: uuid.UUID,
        db: AsyncSession = Depends(get_db),
        current_user_id: str = Depends(get_current_user_id),
):
    from sqlalchemy import delete as sql_delete
    from app.models.models import LLMJob, Annotation

    result = await db.execute(select(Document).where(Document.doc_id == doc_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Belge bulunamadı")
    if str(doc.owner_id) != current_user_id:
        raise HTTPException(status_code=403, detail="Bu belgeyi silme yetkiniz yok")

    # İlişkili kayıtları sil
    await db.execute(sql_delete(LLMJob).where(LLMJob.doc_id == doc_id))
    await db.execute(sql_delete(Annotation).where(Annotation.doc_id == doc_id))

    # MinIO'dan sil
    storage_service.delete_file(doc.file_path)

    # Belgeyi sil
    await db.delete(doc)
    await db.commit()

@router.get("/{doc_id}/download-url")
async def get_download_url(
    doc_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id),
):
    """MinIO'dan geçici imzalı indirme URL'i döner (1 saat geçerli)."""
    result = await db.execute(select(Document).where(Document.doc_id == doc_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Belge bulunamadı")
    if str(doc.owner_id) != current_user_id:
        raise HTTPException(status_code=403, detail="Bu belgeye erişim yetkiniz yok")

    url = storage_service.get_presigned_url(doc.file_path)
    return {"download_url": url, "expires_in": 3600}

@router.get("/{doc_id}/view")
async def view_document(
        doc_id: uuid.UUID,
        db: AsyncSession = Depends(get_db),
        current_user_id: str = Depends(get_current_user_id),
):
    """PDF'i backend üzerinden stream et — MinIO'ya direkt erişim gerekmez."""
    result = await db.execute(select(Document).where(Document.doc_id == doc_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Belge bulunamadı")

    file_bytes = storage_service.download_file(doc.file_path)

    return StreamingResponse(
        io.BytesIO(file_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename={doc.title}.pdf"}
    )

@router.patch("/{doc_id}/reading-status", response_model=DocumentOut)
async def update_reading_status(
    doc_id: uuid.UUID,
    payload: ReadingStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id),
):
    """Belgenin okuma durumunu güncelle."""
    try:
        new_status = ReadingStatus(payload.status)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Geçersiz durum. Seçenekler: Unread, Reading, Read, Reviewed",
        )

    result = await db.execute(select(Document).where(Document.doc_id == doc_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Belge bulunamadı")
    if str(doc.owner_id) != current_user_id:
        raise HTTPException(status_code=403, detail="Bu belgeye erişim yetkiniz yok")

    doc.reading_status = new_status
    await db.commit()
    await db.refresh(doc)
    return doc


@router.post("/{doc_id}/reprocess", status_code=status.HTTP_202_ACCEPTED)
async def reprocess_document(
        doc_id: uuid.UUID,
        db: AsyncSession = Depends(get_db),
        current_user_id: str = Depends(get_current_user_id),
):
    """Belgeyi yeniden LLM ile işle."""
    result = await db.execute(select(Document).where(Document.doc_id == doc_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Belge bulunamadı")

    from app.tasks.llm_tasks import process_document_task
    process_document_task.delay(str(doc.doc_id), doc.file_path, doc.title)

    return {"message": "LLM işleme başlatıldı"}