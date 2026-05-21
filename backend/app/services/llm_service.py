"""
LLM servisi — Groq (ücretsiz, llama-3.1-8b-instant)
Özetleme, keyword, embedding, atıf, koleksiyon raporu.
"""
import json
from groq import Groq
from app.core.config import settings

# Sentence Transformers modelini global olarak cache'le
_st_model = None


def _get_client() -> Groq:
    return Groq(api_key=settings.GROQ_API_KEY)


def _chat(prompt: str, max_tokens: int = 1000) -> str:
    client = _get_client()
    response = client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=max_tokens,
    )
    return response.choices[0].message.content.strip()


def _get_st_model():
    global _st_model
    if _st_model is None:
        from sentence_transformers import SentenceTransformer
        _st_model = SentenceTransformer('all-MiniLM-L6-v2')
    return _st_model


def summarize_document(text: str) -> str:
    prompt = f"""Aşağıdaki akademik belgeyi Türkçe olarak 3-5 cümleyle özetle.
Özet açık, bilgilendirici ve belgenin ana bulgularını yansıtmalıdır.

BELGE:
{text[:8000]}

ÖZET:"""
    return _chat(prompt)


def extract_keywords(text: str) -> list[str]:
    prompt = f"""Aşağıdaki belgeden 5-10 anahtar kelime çıkar.
Sadece JSON listesi döndür, başka hiçbir şey yazma.
Örnek: ["yapay zeka", "makine öğrenmesi"]

BELGE:
{text[:4000]}

JSON:"""
    raw = _chat(prompt, max_tokens=200)
    try:
        raw = raw.replace("```json", "").replace("```", "").strip()
        keywords = json.loads(raw)
        if isinstance(keywords, list):
            return [str(k) for k in keywords]
    except json.JSONDecodeError:
        lines = [l.strip().strip('"-,[]') for l in raw.splitlines()]
        return [l for l in lines if l]
    return []

def generate_trend_analysis(collection_name: str, summaries: list[str]) -> str:
    combined = "\n\n---\n\n".join([f"Belge {i+1}:\n{s}" for i, s in enumerate(summaries)])
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
    combined = "\n\n---\n\n".join([f"Belge {i+1}:\n{s}" for i, s in enumerate(summaries)])
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
    combined = "\n\n---\n\n".join([f"Belge {i+1}:\n{s}" for i, s in enumerate(summaries)])
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
    embedding = model.encode(text[:1000]).tolist()
    if len(embedding) < 768:
        embedding = embedding + [0.0] * (768 - len(embedding))
    return embedding[:768]


def generate_query_embedding(query: str) -> list[float]:
    return generate_embedding(query)


def generate_collection_report(collection_name: str, summaries: list[str]) -> str:
    combined = "\n\n---\n\n".join(
        [f"Belge {i+1}:\n{s}" for i, s in enumerate(summaries)]
    )
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