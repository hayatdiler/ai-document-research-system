"""Arama endpoint'leri — /api/search/"""
import uuid
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user_id, get_db
from app.schemas.schemas import SearchResultItem, SemanticSearchRequest
from app.services.llm_service import generate_query_embedding

router = APIRouter(prefix="/search", tags=["Arama"])


@router.post("/semantic", response_model=list[SearchResultItem])
async def semantic_search(
    payload: SemanticSearchRequest,
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id),
):
    """
    Semantik arama: sorgu metni → Gemini embedding → pgvector cosine similarity.
    En yüksek benzerliğe sahip belgeler döner.
    """
    # Gemini ile sorgu vektörü üret
    query_vector = generate_query_embedding(payload.query)
    vector_str = "[" + ",".join(str(v) for v in query_vector) + "]"

    # pgvector cosine distance sorgusu
    sql = text("""
        SELECT doc_id, title, summary,
               1 - (embedding_vector <=> CAST(:query_vec AS vector)) AS similarity_score
        FROM documents
        WHERE embedding_vector IS NOT NULL
        ORDER BY embedding_vector <=> CAST(:query_vec AS vector)
        LIMIT :top_k
    """)
    result = await db.execute(sql, {"query_vec": vector_str, "top_k": payload.top_k})
    rows = result.fetchall()

    return [
        SearchResultItem(
            doc_id=row.doc_id,
            title=row.title,
            summary=row.summary,
            similarity_score=round(float(row.similarity_score), 4),
        )
        for row in rows
    ]


@router.get("/keyword", response_model=list[SearchResultItem])
async def keyword_search(
    q: str = Query(..., min_length=1, description="Arama terimi"),
    limit: int = Query(default=10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id),
):
    """
    PostgreSQL full-text search ile anahtar kelime araması.
    Başlık, özet ve anahtar kelimeler aranır.
    """
    sql = text("""
        SELECT doc_id, title, summary,
               ts_rank(
                   to_tsvector('turkish', COALESCE(title,'') || ' ' || COALESCE(summary,'')),
                   plainto_tsquery('turkish', :query)
               ) AS similarity_score
        FROM documents
        WHERE to_tsvector('turkish', COALESCE(title,'') || ' ' || COALESCE(summary,''))
              @@ plainto_tsquery('turkish', :query)
           OR keywords::text ILIKE :like_query
        ORDER BY similarity_score DESC
        LIMIT :limit
    """)
    result = await db.execute(sql, {"query": q, "like_query": f"%{q}%", "limit": limit})
    rows = result.fetchall()

    return [
        SearchResultItem(
            doc_id=row.doc_id,
            title=row.title,
            summary=row.summary,
            similarity_score=round(float(row.similarity_score), 4),
        )
        for row in rows
    ]
