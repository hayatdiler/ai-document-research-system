"""Belgelerle sohbet endpoint'i — /api/chat"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user_id, get_db
from app.models.models import Collection, CollectionDocument, Document
from app.services.chat_service import chat

router = APIRouter(prefix="/chat", tags=["Sohbet"])


class ChatMessage(BaseModel):
    role: str        # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    collection_id: uuid.UUID | None = None
    doc_ids: list[uuid.UUID] | None = None
    history: list[ChatMessage] = []


class ChatResponse(BaseModel):
    answer: str
    sources: list[dict]


@router.post("", response_model=ChatResponse)
async def chat_with_documents(
    payload: ChatRequest,
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id),
):
    """
    Kullanıcının seçtiği belge veya koleksiyona dayanarak soru yanıtla.
    Bağlam gönderilmezse kullanıcının tüm belgelerini kullanır.
    """
    uid = uuid.UUID(current_user_id)
    documents = []

    if payload.collection_id:
        # Koleksiyonun kullanıcıya ait olduğunu doğrula
        col_res = await db.execute(
            select(Collection).where(
                Collection.collection_id == payload.collection_id,
                Collection.owner_id == uid,
            )
        )
        if not col_res.scalar_one_or_none():
            raise HTTPException(status_code=403, detail="Bu koleksiyona erişim yetkiniz yok")

        # Koleksiyondaki belgeleri çek
        doc_res = await db.execute(
            select(Document)
            .join(CollectionDocument, CollectionDocument.doc_id == Document.doc_id)
            .where(CollectionDocument.collection_id == payload.collection_id)
        )
        documents = doc_res.scalars().all()

    elif payload.doc_ids:
        # Belirtilen belgeleri çek — hepsi kullanıcıya ait olmalı
        doc_res = await db.execute(
            select(Document).where(
                Document.doc_id.in_(payload.doc_ids),
                Document.owner_id == uid,
            )
        )
        documents = doc_res.scalars().all()
        if len(documents) != len(payload.doc_ids):
            raise HTTPException(status_code=403, detail="Bazı belgelere erişim yetkiniz yok")

    else:
        # Bağlam verilmemişse kullanıcının son 10 belgesini kullan
        doc_res = await db.execute(
            select(Document)
            .where(Document.owner_id == uid)
            .order_by(Document.upload_date.desc())
            .limit(10)
        )
        documents = doc_res.scalars().all()

    if not documents:
        raise HTTPException(
            status_code=422,
            detail="Sohbet için belge bulunamadı. Önce belge yükleyin.",
        )

    history = [{"role": m.role, "content": m.content} for m in payload.history]
    result = chat(payload.query, documents, history)
    return result
