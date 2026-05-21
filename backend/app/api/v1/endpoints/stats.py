from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user_id, get_db
from app.models.models import Document, Collection, LLMJob, JobStatus

router = APIRouter(prefix="/stats", tags=["İstatistikler"])


@router.get("")
async def get_stats(
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id),
):
    doc_count  = await db.scalar(select(func.count()).select_from(Document))
    coll_count = await db.scalar(select(func.count()).select_from(Collection))
    job_count = await db.scalar(
        select(func.count())
        .select_from(LLMJob)
        .where(LLMJob.status == JobStatus.PENDING)
    )
    return {
        "total_documents":   doc_count  or 0,
        "total_collections": coll_count or 0,
        "total_llm_jobs":    job_count  or 0,
    }


@router.get("/recent-documents")
async def get_recent_documents(
        db: AsyncSession = Depends(get_db),
        current_user_id: str = Depends(get_current_user_id),
):
    from sqlalchemy import select
    from app.models.models import Document

    result = await db.execute(
        select(Document)
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
        }
        for d in docs
    ]