"""
LLM servisi — Groq (ücretsiz, llama-3.1-8b-instant)
Özetleme, keyword, embedding, atıf, koleksiyon raporu.
"""
import json
import time
from groq import Groq, AsyncGroq, RateLimitError
from app.core.config import settings

# Sentence Transformers modelini global olarak cache'le
_st_model = None


def _get_client() -> Groq:
    return Groq(api_key=settings.GROQ_API_KEY)


def _chat(prompt: str, max_tokens: int = 1000) -> str:
    client = _get_client()
    for attempt in range(4):
        try:
            response = client.chat.completions.create(
                model=settings.GROQ_MODEL,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=max_tokens,
            )
            return response.choices[0].message.content.strip()
        except RateLimitError:
            if attempt == 3:
                raise
            time.sleep(10 * (attempt + 1))  # 10s, 20s, 30s


def _get_st_model():
    global _st_model
    if _st_model is None:
        from sentence_transformers import SentenceTransformer
        _st_model = SentenceTransformer('all-MiniLM-L6-v2')
    return _st_model


def detect_language(text: str) -> str:
    """
    Metnin dilini tahmin eder: 'en' veya 'tr'.
    Türkçe'ye özgü karakterlerin (ğ ü ş ı ö ç) yoğunluğuna bakar.
    500 karakterlik örnekte 3'ten fazla Türkçe karakter varsa Türkçe kabul edilir.
    """
    sample = text[:500].lower()
    tr_chars = sum(1 for c in sample if c in 'ğüşıöç')
    return 'tr' if tr_chars > 2 else 'en'


def build_summary_prompt(text: str) -> str:
    """Dile göre özet prompt'u oluşturur. Hem sync hem async yolda kullanılır."""
    lang = detect_language(text)
    if lang == 'tr':
        return (
            "Aşağıdaki akademik belgeyi Türkçe olarak 3-5 cümleyle özetle.\n"
            "Kurallar:\n"
            "- Sadece özet metnini yaz, \"özet:\", \"işte özet\" gibi başlık ekleme\n"
            "- Madde işareti veya numaralı liste kullanma\n"
            "- Belgenin ana bulgularını, yöntemini ve sonucunu kapsa\n\n"
            f"BELGE:\n{text[:8000]}\n\n"
        )
    return (
        "Summarize the following academic document in 3-5 sentences in English.\n"
        "Rules:\n"
        "- Write only the summary text, no \"Summary:\" prefix\n"
        "- No bullet points or numbered lists\n"
        "- Cover the document's main findings, methodology, and conclusion\n\n"
        f"DOCUMENT:\n{text[:8000]}\n\n"
    )


def summarize_document(text: str) -> str:
    return _chat(build_summary_prompt(text)).strip()


async def stream_summary(text: str):
    """
    Async generator — SSE satırları üretir.
    Groq'tan gelen token'ları birer birer yield eder.
    Son token'dan sonra tam özet metnini de döner (caller kaydetmek için).

    Yields: str  (SSE satırları)
    """
    import asyncio
    prompt  = build_summary_prompt(text)
    client  = AsyncGroq(api_key=settings.GROQ_API_KEY)
    chunks  = []

    stream = await client.chat.completions.create(
        model=settings.GROQ_MODEL,
        messages=[{"role": "user", "content": prompt}],
        stream=True,
        max_tokens=1000,
        temperature=0.3,
    )

    async for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            chunks.append(delta)
            yield f"data: {json.dumps({'text': delta})}\n\n"

    full = "".join(chunks).strip()
    yield f"data: {json.dumps({'done': True, 'full': full})}\n\n"


def extract_keywords(text: str) -> list[str]:
    lang = detect_language(text)

    if lang == 'tr':
        prompt = f"""Aşağıdaki belgeden 5-10 anahtar kelime çıkar.
Sadece JSON listesi döndür, başka hiçbir şey yazma.
Örnek: ["yapay zeka", "makine öğrenmesi"]

BELGE:
{text[:4000]}

JSON:"""
    else:
        prompt = f"""Extract 5-10 keywords from the following document.
Return only a JSON list, nothing else.
Example: ["machine learning", "neural networks"]

DOCUMENT:
{text[:4000]}

JSON:"""

    raw = _chat(prompt, max_tokens=200)
    try:
        raw = raw.replace("```json", "").replace("```", "").strip()
        # JSON array başlamıyorsa ilk [ ile sonra ] arasını bul
        start = raw.find('[')
        end   = raw.rfind(']')
        if start != -1 and end != -1:
            raw = raw[start:end+1]
        keywords = json.loads(raw)
        if isinstance(keywords, list):
            cleaned = [str(k).strip() for k in keywords if str(k).strip() and len(str(k).strip()) > 1]
            return cleaned[:10]
    except (json.JSONDecodeError, ValueError):
        # Fallback: satırları ayrıştır, kısa/boş olanları at
        lines = [l.strip().strip('"-,[]{}') for l in raw.splitlines()]
        cleaned = [l for l in lines if len(l) > 2 and not l.startswith('{')]
        return cleaned[:10]
    return []

def generate_trend_analysis(collection_name: str, summaries: list[str]) -> str:
    combined = "\n\n---\n\n".join(summaries)
    prompt = f"""'{collection_name}' koleksiyonundaki belgeler:

{combined[:6000]}

Aşağıdaki formatta Türkçe trend analizi raporu yaz:

# Araştırma Trendleri
- [trend 1]
- [trend 2]

# Zaman İçindeki Gelişim
[açıklama]

# Gelecek Araştırma Yönleri
- [yön 1]
- [yön 2]

RAPOR:"""
    return _chat(prompt, max_tokens=2000)


def generate_citation_network(collection_name: str, summaries: list[str]) -> str:
    combined = "\n\n---\n\n".join(summaries)
    prompt = f"""'{collection_name}' koleksiyonundaki belgeler:

{combined[:6000]}

Aşağıdaki formatta Türkçe atıf ağı analizi yaz:

# Temel Çalışmalar
- [çalışma 1]

# Belgeler Arası İlişkiler
- [ilişki 1]

# Etki Analizi
[açıklama]

RAPOR:"""
    return _chat(prompt, max_tokens=2000)


def generate_comparison(collection_name: str, summaries: list[str]) -> str:
    combined = "\n\n---\n\n".join(summaries)
    prompt = f"""'{collection_name}' koleksiyonundaki belgeler:

{combined[:6000]}

Aşağıdaki formatta Türkçe metodolojik karşılaştırma raporu yaz:

# Metodoloji Karşılaştırması
- [yöntem 1 vs yöntem 2]

# Güçlü ve Zayıf Yönler
- [güçlü yön]
- [zayıf yön]

# En İyi Yaklaşım
[açıklama]

RAPOR:"""
    return _chat(prompt, max_tokens=2000)

def generate_embedding(text: str) -> list[float]:
    model = _get_st_model()
    # all-MiniLM-L6-v2 outputs 384-dimensional vectors
    embedding = model.encode(text[:1000]).tolist()
    return embedding[:384]


def generate_query_embedding(query: str) -> list[float]:
    return generate_embedding(query)


def generate_collection_report(collection_name: str, summaries: list[str]) -> str:
    combined = "\n\n---\n\n".join(summaries)
    prompt = f"""'{collection_name}' koleksiyonuna ait belgeler:

{combined[:6000]}

Aşağıdaki formatta Türkçe literatür raporu yaz. Format'a kesinlikle uy:

# Yönetici Özeti
[2-3 cümle özet]

# Ortak Temalar ve Bulgular
- [tema 1]
- [tema 2]

# Farklılıklar ve Tartışmalı Noktalar
- [farklılık 1]
- [farklılık 2]

# Genel Değerlendirme ve Sonuç
[2-3 cümle sonuç]

RAPOR:"""
    return _chat(prompt, max_tokens=2000)


def format_citation(citation_data: dict, format: str) -> str:
    prompt = f"""Şu meta veriyle {format} atıf formatında atıf oluştur.
Sadece atıf metnini yaz, açıklama ekleme.

META VERİ:
{json.dumps(citation_data, ensure_ascii=False, indent=2)}

{format} ATIF:"""
    return _chat(prompt, max_tokens=300)