"""
Celery asenkron görevleri.
Belge yüklendiğinde tetiklenen LLM pipeline:
  1. PDF'den metin çıkar
  2. Groq ile özetle
  3. Anahtar kelime çıkar
  4. Embedding üret ve pgvector'e kaydet
"""
import logging
import uuid

from celery import Celery

from app.core.config import settings

logger = logging.getLogger(__name__)

celery_app = Celery("docai", broker=settings.REDIS_URL, backend=settings.REDIS_URL)
celery_app.conf.task_serializer = "json"
celery_app.conf.result_serializer = "json"
celery_app.conf.broker_connection_retry_on_startup = True


@celery_app.task(bind=True, max_retries=3, default_retry_delay=30)
def process_document_task(self, doc_id: str, file_path: str, title: str):
    import asyncio
    asyncio.run(_process_document(doc_id, file_path, title))


def _extract_text_pypdf(file_bytes: bytes) -> str:
    """pypdf ile metin çıkar; taranmış sayfalarda boş döner."""
    from pypdf import PdfReader
    import io
    reader = PdfReader(io.BytesIO(file_bytes))
    parts = [page.extract_text() or '' for page in reader.pages]
    return " ".join(parts)


def _extract_text_ocr(file_bytes: bytes, max_pages: int = 15) -> str:
    """
    Taranmış PDF için OCR fallback.
    pdf2image ile sayfaları görüntüye çevirir, pytesseract ile okur.
    Türkçe+İngilizce dil paketi kullanır.
    max_pages: Celery worker zaman aşımını önlemek için sayfa sınırı.
    """
    try:
        from pdf2image import convert_from_bytes
        import pytesseract

        logger.info(f"OCR başlatılıyor (max {max_pages} sayfa, dpi=200)")
        images = convert_from_bytes(
            file_bytes,
            dpi=200,
            first_page=1,
            last_page=max_pages,
        )

        parts = []
        for i, img in enumerate(images, 1):
            page_text = pytesseract.image_to_string(img, lang='tur+eng')
            if page_text.strip():
                parts.append(page_text.strip())
            logger.info(f"OCR sayfa {i}/{len(images)}: {len(page_text)} karakter")

        result = "\n\n".join(parts)
        logger.info(f"OCR tamamlandı: toplam {len(result)} karakter")
        return result

    except ImportError:
        logger.warning("pdf2image veya pytesseract kurulu değil — OCR atlanıyor")
        return ""
    except Exception as exc:
        logger.error(f"OCR hatası: {exc}")
        return ""


async def _process_document(doc_id: str, file_path: str, title: str):
    import io
    from sqlalchemy import update
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    from app.core.config import settings
    from app.models.models import Document, LLMJob, JobStatus
    from app.services import storage_service, llm_service

    engine = create_async_engine(settings.DATABASE_URL, pool_pre_ping=True)
    SessionLocal = async_sessionmaker(bind=engine, expire_on_commit=False)

    async with SessionLocal() as db:
        try:
            file_bytes = storage_service.download_file(file_path)

            # 1. pypdf ile metin çıkarmayı dene
            text = _extract_text_pypdf(file_bytes)

            # 2. Boş ya da çok az metin → taranmış PDF, OCR'a geç
            if len(text.strip()) < 100:
                logger.info(f"pypdf yetersiz metin ({len(text.strip())} karakter) — OCR deneniyor")
                text = _extract_text_ocr(file_bytes)

            # 3. OCR da boş döndüyse başlığı bağlam olarak kullan
            if not text.strip():
                logger.warning(f"Metin çıkarılamadı, başlık kullanılıyor: {title}")
                text = title

            summary = llm_service.summarize_document(text)
            keywords = llm_service.extract_keywords(text)
            embedding = llm_service.generate_embedding(f"{title}\n\n{summary}")

            # Belgeyi güncelle
            await db.execute(
                update(Document)
                .where(Document.doc_id == uuid.UUID(doc_id))
                .values(
                    summary=summary,
                    keywords=keywords,
                    embedding_vector=embedding,
                )
            )

            # Job'ı DONE olarak işaretle
            await db.execute(
                update(LLMJob)
                .where(LLMJob.doc_id == uuid.UUID(doc_id))
                .values(status=JobStatus.DONE)
            )

            await db.commit()

        except Exception as exc:
            await db.rollback()
            await db.execute(
                update(LLMJob)
                .where(LLMJob.doc_id == uuid.UUID(doc_id))
                .values(status=JobStatus.FAILED)
            )
            await db.commit()
            raise exc


@celery_app.task(bind=True, max_retries=2)
def generate_collection_report_task(self, report_id: str, collection_id: str, user_id: str, report_type: str = "literature"):
    import asyncio
    asyncio.run(_generate_report(report_id, collection_id, user_id, report_type))


async def _generate_report(report_id: str, collection_id: str, user_id: str, report_type: str = "literature"):
    from io import BytesIO
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import cm
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    import os
    from sqlalchemy import select, update
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    from app.core.config import settings
    from app.models.models import Collection, CollectionReport, Document, JobStatus
    from app.services import llm_service, storage_service

    logger.info(f"Rapor üretimi başladı: tip={report_type}, koleksiyon={collection_id}")

    engine = create_async_engine(settings.DATABASE_URL, pool_pre_ping=True)
    SessionLocal = async_sessionmaker(bind=engine, expire_on_commit=False)

    async with SessionLocal() as db:
        try:
            result = await db.execute(
                select(Collection).where(Collection.collection_id == uuid.UUID(collection_id))
            )
            collection = result.scalar_one()

            from app.models.models import CollectionDocument
            doc_result = await db.execute(
                select(Document)
                .join(CollectionDocument, CollectionDocument.doc_id == Document.doc_id)
                .where(CollectionDocument.collection_id == uuid.UUID(collection_id))
            )
            docs = doc_result.scalars().all()
            summaries = [doc.summary for doc in docs if doc.summary]

            if not summaries:
                raise ValueError("Koleksiyonda özetlenmiş belge bulunamadı")

            if report_type == "trend":
                report_text = llm_service.generate_trend_analysis(collection.name, summaries)
            elif report_type == "citation":
                report_text = llm_service.generate_citation_network(collection.name, summaries)
            elif report_type == "comparison":
                report_text = llm_service.generate_comparison(collection.name, summaries)
            else:
                report_text = llm_service.generate_collection_report(collection.name, summaries)

            font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
            bold_font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

            if os.path.exists(font_path):
                pdfmetrics.registerFont(TTFont('DejaVu', font_path))
                pdfmetrics.registerFont(TTFont('DejaVu-Bold', bold_font_path))
                font_name = 'DejaVu'
                font_bold = 'DejaVu-Bold'
            else:
                font_name = 'Helvetica'
                font_bold = 'Helvetica-Bold'

            title_style = ParagraphStyle('title', fontName=font_bold, fontSize=16,
                spaceAfter=20, alignment=1)
            heading_style = ParagraphStyle('heading', fontName=font_bold, fontSize=13,
                spaceAfter=8, spaceBefore=12)
            normal_style = ParagraphStyle('normal', fontName=font_name, fontSize=11,
                spaceAfter=6, leading=16)

            buffer = BytesIO()
            doc = SimpleDocTemplate(buffer, pagesize=A4,
                rightMargin=2*cm, leftMargin=2*cm,
                topMargin=2*cm, bottomMargin=2*cm)

            story = []
            story.append(Paragraph(f"Koleksiyon Raporu: {collection.name}", title_style))
            story.append(Spacer(1, 0.5*cm))

            clean_text = report_text.replace('**', '').replace('*', '')

            for line in clean_text.split('\n'):
                line = line.strip()
                if not line:
                    story.append(Spacer(1, 0.2*cm))
                    continue
                if line.startswith('#'):
                    line = line.lstrip('#').strip()
                    story.append(Paragraph(line, heading_style))
                elif line[0].isdigit() and '. ' in line[:3]:
                    story.append(Paragraph(f'<b>{line}</b>', normal_style))
                elif line.startswith('-') or line.startswith('•'):
                    line = '• ' + line.lstrip('-•').strip()
                    story.append(Paragraph(line, normal_style))
                else:
                    story.append(Paragraph(line, normal_style))

            doc.build(story)
            pdf_bytes = buffer.getvalue()

            object_name = storage_service.upload_file(
                pdf_bytes,
                f"report_{report_id}.pdf",
                "application/pdf"
            )

            await db.execute(
                update(CollectionReport)
                .where(CollectionReport.report_id == uuid.UUID(report_id))
                .values(status=JobStatus.DONE, file_path=object_name, report_text=report_text)
            )
            await db.commit()

        except Exception as exc:
            await db.rollback()
            await db.execute(
                update(CollectionReport)
                .where(CollectionReport.report_id == uuid.UUID(report_id))
                .values(status=JobStatus.FAILED)
            )
            await db.commit()
            raise exc