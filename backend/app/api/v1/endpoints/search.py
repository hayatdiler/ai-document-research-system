"""Arama endpoint'leri — /api/search/"""
import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user_id, get_db
from app.schemas.schemas import SearchResultItem, SemanticSearchRequest
from app.services.llm_service import generate_query_embedding

router = APIRouter(prefix="/search", tags=["Arama"])


def _build_filter_sql(
    base_conditions: list[str],
    params: dict,
    year_from: int | None,
    year_to: int | None,
    author: str | None,
) -> str:
    """
    Opsiyonel yıl ve yazar filtrelerini WHERE koşullarına ekler.
    citation_data JSONB alanından okur; yıl sayısal değilse filtre atlanır.
    """
    if year_from is not None or year_to is not None:
        year_parts = ["citation_data->>'year' ~ '^[0-9]{4}$'"]
        if year_from is not None:
            year_parts.append("(citation_data->>'year')::integer >= :year_from")
            params["year_from"] = year_from
        if year_to is not None:
            year_parts.append("(citation_data->>'year')::integer <= :year_to")
            params["year_to"] = year_to
        base_conditions.append("(" + " AND ".join(year_parts) + ")")

    if author:
        base_conditions.append("citation_data->>'author' ILIKE :author")
        params["author"] = f"%{author}%"

    return " AND ".join(base_conditions)


@router.post("/semantic", response_model=list[SearchResultItem])
async def semantic_search(
    payload: SemanticSearchRequest,
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id),
):
    """
    Semantik arama: sorgu → MiniLM embedding → pgvector cosine similarity.
    Sadece giriş yapan kullanıcının belgeleri aranır.
    """
    uid = str(uuid.UUID(current_user_id))
    query_vector = generate_query_embedding(payload.query)
    vector_str = "[" + ",".join(str(v) for v in query_vector) + "]"

    conditions = [
        "embedding_vector IS NOT NULL",
        "owner_id = :owner_id",
    ]
    params: dict = {
        "query_vec": vector_str,
        "top_k": payload.top_k,
        "owner_id": uid,
    }

    where = _build_filter_sql(conditions, params, payload.year_from, payload.year_to, payload.author)

    sql = text(f"""
        SELECT doc_id, title, summary, keywords, citation_data,
               1 - (embedding_vector <=> CAST(:query_vec AS vector)) AS similarity_score
        FROM documents
        WHERE {where}
        ORDER BY embedding_vector <=> CAST(:query_vec AS vector)
        LIMIT :top_k
    """)

    rows = (await db.execute(sql, params)).fetchall()

    return [
        SearchResultItem(
            doc_id=row.doc_id,
            title=row.title,
            summary=row.summary,
            similarity_score=round(float(row.similarity_score), 4),
            keywords=row.keywords,
            citation_data=row.citation_data,
        )
        for row in rows
    ]


@router.get("/keyword", response_model=list[SearchResultItem])
async def keyword_search(
    q:         str = Query(..., min_length=1),
    limit:     int = Query(default=10, ge=1, le=50),
    year_from: int | None = Query(default=None, ge=1000, le=9999),
    year_to:   int | None = Query(default=None, ge=1000, le=9999),
    author:    str | None = Query(default=None, max_length=255),
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id),
):
    """
    PostgreSQL full-text search ile anahtar kelime araması.
    Sadece giriş yapan kullanıcının belgeleri aranır.
    """
    uid = str(uuid.UUID(current_user_id))

    conditions = [
        "owner_id = :owner_id",
        "(to_tsvector('turkish', COALESCE(title,'') || ' ' || COALESCE(summary,''))"
        " @@ plainto_tsquery('turkish', :query)"
        " OR keywords::text ILIKE :like_query)",
    ]
    params: dict = {
        "query":      q,
        "like_query": f"%{q}%",
        "limit":      limit,
        "owner_id":   uid,
    }

    where = _build_filter_sql(conditions, params, year_from, year_to, author)

    sql = text(f"""
        SELECT doc_id, title, summary, keywords, citation_data,
               ts_rank(
                   to_tsvector('turkish', COALESCE(title,'') || ' ' || COALESCE(summary,'')),
                   plainto_tsquery('turkish', :query)
               ) AS similarity_score
        FROM documents
        WHERE {where}
        ORDER BY similarity_score DESC
        LIMIT :limit
    """)

    rows = (await db.execute(sql, params)).fetchall()

    return [
        SearchResultItem(
            doc_id=row.doc_id,
            title=row.title,
            summary=row.summary,
            similarity_score=round(float(row.similarity_score), 4),
            keywords=row.keywords,
            citation_data=row.citation_data,
        )
        for row in rows
    ]
