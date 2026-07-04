"""Pydantic şemaları — Request / Response doğrulama."""
import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, EmailStr, Field


# ── Auth ───────────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    full_name: str = Field(min_length=2, max_length=255)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


# ── User ───────────────────────────────────────────────────────────────────────

class UserOut(BaseModel):
    user_id: uuid.UUID
    email: str
    full_name: str
    role: str
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Document ───────────────────────────────────────────────────────────────────

class DocumentOut(BaseModel):
    doc_id: uuid.UUID
    title: str
    file_type: str
    upload_date: datetime
    summary: str | None
    keywords: list[str] | None
    citation_data: dict | None
    reading_status: str = "Unread"

    model_config = {"from_attributes": True}


class ReadingStatusUpdate(BaseModel):
    status: str  # Unread | Reading | Read | Reviewed


class CitationDataIn(BaseModel):
    """Belge yüklerken kullanıcının girdiği meta veri."""
    author: str | None = None
    year: int | None = None
    publisher: str | None = None
    journal: str | None = None
    doi: str | None = None


# ── Search ─────────────────────────────────────────────────────────────────────

class SemanticSearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=1000)
    top_k: int = Field(default=10, ge=1, le=50)


class SearchResultItem(BaseModel):
    doc_id: uuid.UUID
    title: str
    summary: str | None
    similarity_score: float
    keywords: list[str] | None = None
    citation_data: dict | None = None


# ── Collection ─────────────────────────────────────────────────────────────────

class CollectionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None


class CollectionOut(BaseModel):
    collection_id: uuid.UUID
    name: str
    description: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Annotation ─────────────────────────────────────────────────────────────────

class AnnotationCreate(BaseModel):
    doc_id: uuid.UUID
    selected_text: str
    page_number: int | None = None
    color: str = "#FFFF00"


class AnnotationOut(BaseModel):
    annotation_id: uuid.UUID
    doc_id: uuid.UUID
    selected_text: str
    page_number: int | None
    color: str
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Comment ────────────────────────────────────────────────────────────────────

class CommentCreate(BaseModel):
    annotation_id: uuid.UUID
    content: str
    parent_comment_id: uuid.UUID | None = None


class CommentOut(BaseModel):
    comment_id: uuid.UUID
    annotation_id: uuid.UUID
    content: str
    parent_comment_id: uuid.UUID | None
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Report ─────────────────────────────────────────────────────────────────────

class ReportOut(BaseModel):
    report_id: uuid.UUID
    collection_id: uuid.UUID
    status: str
    file_path: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
