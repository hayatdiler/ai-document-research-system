"""
Yapay Zeka Destekli Doküman ve Araştırma Yönetim Sistemi
Backend: Python 3.11 + FastAPI | LLM: Groq (Llama 3.1) | Depolama: MinIO
"""
import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi import Request
from fastapi.responses import JSONResponse
from sqlalchemy import text
import logging

from app.core.config import settings
from app.db.session import engine
from app.services.storage_service import ensure_bucket_exists
from app.api.v1.endpoints import admin, annotations, auth, chat, citations, collections, documents, search, share, stats

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

logger = logging.getLogger(__name__)


def _alembic_cfg():
    from alembic.config import Config
    return Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))


def _alembic_upgrade():
    from alembic import command
    command.upgrade(_alembic_cfg(), "head")


def _alembic_stamp_head():
    from alembic import command
    command.stamp(_alembic_cfg(), "head")
    logger.info("Alembic: mevcut veritabanı 'head' olarak işaretlendi")


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.connect() as conn:
        has_version = await conn.scalar(text(
            "SELECT EXISTS (SELECT FROM information_schema.tables "
            "WHERE table_schema='public' AND table_name='alembic_version')"
        ))
        has_users = await conn.scalar(text(
            "SELECT EXISTS (SELECT FROM information_schema.tables "
            "WHERE table_schema='public' AND table_name='users')"
        ))

    if has_users and not has_version:
        # Tablolar var ama alembic takibi yok → stamp ile işaretle
        await asyncio.to_thread(_alembic_stamp_head)
    else:
        # Temiz DB veya alembic zaten var → upgrade çalıştır
        await asyncio.to_thread(_alembic_upgrade)

    ensure_bucket_exists()
    yield
    await engine.dispose()


app = FastAPI(
    title="AI Doküman Yönetim Sistemi",
    description="Yapay zeka destekli belge yükleme, özetleme, semantik arama ve atıf sistemi.",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — frontend ile iletişim için
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:8000", "http://localhost:5500", "null"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# ── Global Exception Handler ─────────────────────────────────────────────────
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Beklenmeyen hata: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "Sunucu hatası oluştu. Lütfen tekrar deneyin."},
    )

@app.exception_handler(404)
async def not_found_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=404,
        content={"detail": "İstenen kaynak bulunamadı."},
    )

@app.exception_handler(403)
async def forbidden_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=403,
        content={"detail": "Bu işlem için yetkiniz yok."},
    )

# ── Router'ları kaydet ────────────────────────────────────────────────────────
API_PREFIX = "/api"

app.include_router(auth.router, prefix=API_PREFIX)
app.include_router(documents.router, prefix=API_PREFIX)
app.include_router(search.router, prefix=API_PREFIX)
app.include_router(collections.router, prefix=API_PREFIX)
app.include_router(annotations.router, prefix=API_PREFIX)
app.include_router(citations.router, prefix=API_PREFIX)
app.include_router(admin.router, prefix=API_PREFIX)
app.include_router(stats.router, prefix=API_PREFIX)
app.include_router(chat.router, prefix=API_PREFIX)
app.include_router(share.router, prefix=API_PREFIX)

@app.get("/health", tags=["Sistem"])
async def health_check():
    return {"status": "ok", "version": "1.0.0"}

# Limiter tanımla
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)