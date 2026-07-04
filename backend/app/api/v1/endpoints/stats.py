import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user_id, get_db
from app.models.models import Document, Collection, LLMJob, JobStatus, ReadingStatus

router = APIRouter(prefix="/stats", tags=["İstatistikler"])


@router.get("")
async def get_stats(
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id),
):
    uid = uuid.UUID(current_user_id)
    doc_count = await db.scalar(
        select(func.count()).select_from(Document).where(Document.owner_id == uid)
    )
    coll_count = await db.scalar(
        select(func.count()).select_from(Collection).where(Collection.owner_id == uid)
    )
    job_count = await db.scalar(
        select(func.count())
        .select_from(LLMJob)
        .join(Document, Document.doc_id == LLMJob.doc_id)
        .where(Document.owner_id == uid)
        .where(LLMJob.status == JobStatus.PENDING)
    )
    unread_count = await db.scalar(
        select(func.count())
        .select_from(Document)
        .where(Document.owner_id == uid)
        .where(Document.reading_status == ReadingStatus.UNREAD)
    )
    return {
        "total_documents":   doc_count    or 0,
        "total_collections": coll_count   or 0,
        "total_llm_jobs":    job_count    or 0,
        "unread_count":      unread_count or 0,
    }


@router.get("/recent-documents")
async def get_recent_documents(
        db: AsyncSession = Depends(get_db),
        current_user_id: str = Depends(get_current_user_id),
):
    from sqlalchemy import select
    from app.models.models import Document

    uid = uuid.UUID(current_user_id)
    result = await db.execute(
        select(Document)
        .where(Document.owner_id == uid)
        .order_by(Document.upload_date.desc())
        .limit(6)
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
            "reading_status": d.reading_status.value if d.reading_status else "Unread",
        }
        for d in docs
    ]