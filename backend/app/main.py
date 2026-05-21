"""
Yapay Zeka Destekli Doküman ve Araştırma Yönetim Sistemi
Backend: Python 3.11 + FastAPI | LLM: Google Gemini | Depolama: MinIO
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi import Request
from fastapi.responses import JSONResponse
import logging

from app.core.config import settings
from app.db.session import engine, Base
from app.services.storage_service import ensure_bucket_exists
from app.api.v1.endpoints import admin, annotations, auth, citations, collections, documents, search, stats

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Uygulama başlangıcı ve kapanışında çalışan işlemler."""
    # DB tablolarını oluştur (production'da Alembic migration kullanılmalı)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # MinIO bucket kontrolü
    ensure_bucket_exists()

    yield
    # Kapanış işlemleri (gerekirse)
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
    allow_origins=["http://localhost:3000", "http://localhost:8000"],
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

@app.get("/health", tags=["Sistem"])
async def health_check():
    return {"status": "ok", "version": "1.0.0"}

# Limiter tanımla
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)