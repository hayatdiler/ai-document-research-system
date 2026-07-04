"""
RAG tabanlı sohbet servisi.
Kullanıcının seçtiği belge/koleksiyonları bağlam olarak Groq'a gönderir.
"""
from groq import Groq
from app.core.config import settings


def _get_client() -> Groq:
    return Groq(api_key=settings.GROQ_API_KEY)


def _build_context(documents: list) -> tuple[str, list[dict]]:
    """
    Belge listesinden LLM bağlamı ve kaynak listesi üretir.
    Özet yoksa başlıkla yer tutar; toplam ~6000 karakter ile sınırlar.
    """
    parts = []
    sources = []
    total_chars = 0
    limit = 6000

    for i, doc in enumerate(documents, 1):
        title = doc.title or "Başlıksız"
        summary = (doc.summary or "").strip()

        if not summary:
            continue

        chunk = f"[Kaynak {i}: {title}]\n{summary}"
        if total_chars + len(chunk) > limit:
            # Kalan alanı doldur, sonra dur
            remaining = limit - total_chars
            if remaining > 100:
                parts.append(chunk[:remaining] + "…")
            break

        parts.append(chunk)
        total_chars += len(chunk)
        sources.append({"doc_id": str(doc.doc_id), "title": title})

    context = "\n\n---\n\n".join(parts)
    return context, sources


def chat(
    query: str,
    documents: list,
    history: list[dict],
) -> dict:
    """
    RAG tabanlı sohbet.

    Args:
        query:     Kullanıcının sorusu
        documents: SQLAlchemy Document nesneleri
        history:   [{"role": "user"|"assistant", "content": "..."}]

    Returns:
        {"answer": str, "sources": [{"doc_id": str, "title": str}]}
    """
    context, sources = _build_context(documents)

    if not context:
        return {
            "answer": "Seçilen belgeler henüz işlenmemiş veya özeti bulunmuyor. "
                      "Lütfen belgelerin LLM işlemesinin tamamlanmasını bekleyin.",
            "sources": [],
        }

    system_prompt = (
        "Sen bir akademik araştırma asistanısın. "
        "Yalnızca aşağıdaki belgelere dayanarak soruları yanıtla. "
        "Belgede geçmeyen bilgileri uydurma; bilmiyorsan açıkça söyle. "
        "Türkçe yanıtla. Kaynakları atıfla göster (ör. [Kaynak 1]).\n\n"
        f"BELGELER:\n{context}"
    )

    messages = [{"role": "system", "content": system_prompt}]

    # Son 8 mesajı geçmiş olarak gönder (4 tur)
    for msg in history[-8:]:
        if msg.get("role") in ("user", "assistant") and msg.get("content"):
            messages.append({"role": msg["role"], "content": msg["content"]})

    messages.append({"role": "user", "content": query})

    client = _get_client()
    response = client.chat.completions.create(
        model=settings.GROQ_MODEL,
        messages=messages,
        max_tokens=1200,
        temperature=0.3,
    )

    answer = response.choices[0].message.content.strip()
    return {"answer": answer, "sources": sources}
