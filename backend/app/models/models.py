"""
Tasarım dokümanındaki sınıf diyagramına birebir karşılık gelen ORM modelleri.
Backend: Python/FastAPI  |  LLM: Groq (llama-3.1-8b-instant)  |  Depolama: MinIO
"""
import enum
import uuid
from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


# ── Enum Tanımları ─────────────────────────────────────────────────────────────

class UserRole(str, enum.Enum):
    ADMIN = "Admin"
    RESEARCHER = "Researcher"
    VIEWER = "Viewer"


class FileType(str, enum.Enum):
    PDF = "PDF"
    TXT = "TXT"


class LLMJobType(str, enum.Enum):
    SUMMARIZE = "Summarize"
    EXTRACT = "Extract"
    EMBED = "Embed"
    COLLECTION_REPORT = "CollectionReport"


class JobStatus(str, enum.Enum):
    PENDING = "Pending"
    RUNNING = "Running"
    DONE = "Done"
    FAILED = "Failed"


class ReadingStatus(str, enum.Enum):
    UNREAD    = "Unread"
    READING   = "Reading"
    READ      = "Read"
    REVIEWED  = "Reviewed"


# ── Modeller ───────────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)  # OAuth girişinde boş
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), default=UserRole.RESEARCHER, nullable=False)
    oauth_provider: Mapped[str | None] = mapped_column(String(50), nullable=True)  # google / github / null
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # İlişkiler
    documents: Mapped[list["Document"]] = relationship("Document", back_populates="owner")
    collections: Mapped[list["Collection"]] = relationship("Collection", back_populates="owner")
    annotations: Mapped[list["Annotation"]] = relationship("Annotation", back_populates="user")


class Document(Base):
    __tablename__ = "documents"

    doc_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.user_id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    file_path: Mapped[str] = mapped_column(String(1024), nullable=False)   # MinIO object key
    file_type: Mapped[FileType] = mapped_column(Enum(FileType), nullable=False)
    upload_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    keywords: Mapped[list[str] | None] = mapped_column(ARRAY(String), nullable=True)
    embedding_vector: Mapped[list[float] | None] = mapped_column(Vector(384), nullable=True)  # all-MiniLM-L6-v2: 384 boyut
    citation_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    reading_status: Mapped[ReadingStatus] = mapped_column(
        Enum(ReadingStatus), nullable=False, default=ReadingStatus.UNREAD,
        server_default=ReadingStatus.UNREAD.value,
    )

    # İlişkiler
    owner: Mapped["User"] = relationship("User", back_populates="documents")
    annotations: Mapped[list["Annotation"]] = relationship("Annotation", back_populates="document")
    llm_jobs: Mapped[list["LLMJob"]] = relationship("LLMJob", back_populates="document")


class Collection(Base):
    __tablename__ = "collections"

    collection_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.user_id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # İlişkiler
    owner: Mapped["User"] = relationship("User", back_populates="collections")
    documents: Mapped[list["Document"]] = relationship(
        "Document", secondary="collection_documents", lazy="selectin"
    )
    reports: Mapped[list["CollectionReport"]] = relationship("CollectionReport", back_populates="collection")


class CollectionDocument(Base):
    """Koleksiyon ↔ Belge çok-çok köprü tablosu."""
    __tablename__ = "collection_documents"

    collection_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("collections.collection_id", ondelete="CASCADE"), primary_key=True
    )
    doc_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("documents.doc_id", ondelete="CASCADE"), primary_key=True
    )


class Annotation(Base):
    __tablename__ = "annotations"

    annotation_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    doc_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("documents.doc_id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.user_id", ondelete="CASCADE"))
    selected_text: Mapped[str] = mapped_column(Text, nullable=False)
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    color: Mapped[str] = mapped_column(String(7), default="#FFFF00")   # HEX
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # İlişkiler
    document: Mapped["Document"] = relationship("Document", back_populates="annotations")
    user: Mapped["User"] = relationship("User", back_populates="annotations")
    comments: Mapped[list["Comment"]] = relationship("Comment", back_populates="annotation")


class Comment(Base):
    """Threaded yorum sistemi — parent_comment_id ile öz-referans."""
    __tablename__ = "comments"

    comment_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    annotation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("annotations.annotation_id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.user_id", ondelete="CASCADE"))
    content: Mapped[str] = mapped_column(Text, nullable=False)
    parent_comment_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("comments.comment_id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # İlişkiler
    annotation: Mapped["Annotation"] = relationship("Annotation", back_populates="comments")
    replies: Mapped[list["Comment"]] = relationship("Comment", remote_side="Comment.parent_comment_id")


class LLMJob(Base):
    """Asenkron LLM işleri için kuyruk tablosu."""
    __tablename__ = "llm_jobs"

    job_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    doc_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("documents.doc_id", ondelete="CASCADE"))
    job_type: Mapped[LLMJobType] = mapped_column(Enum(LLMJobType), nullable=False)
    status: Mapped[JobStatus] = mapped_column(Enum(JobStatus), default=JobStatus.PENDING, nullable=False)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # İlişkiler
    document: Mapped["Document"] = relationship("Document", back_populates="llm_jobs")


class CollectionReport(Base):
    __tablename__ = "collection_reports"

    report_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    collection_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("collections.collection_id", ondelete="CASCADE"))
    generated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.user_id"))
    file_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)   # MinIO object key (PDF)
    report_text: Mapped[str | None] = mapped_column(Text, nullable=True)          # DOCX için ham metin
    status: Mapped[JobStatus] = mapped_column(Enum(JobStatus), default=JobStatus.PENDING)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # İlişkiler
    collection: Mapped["Collection"] = relationship("Collection", back_populates="reports")
