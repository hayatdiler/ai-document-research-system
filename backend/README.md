# Yapay Zeka Destekli Doküman ve Araştırma Yönetim Sistemi

Bu proje, araştırmacıların ve öğrencilerin akademik belgelerini (PDF/TXT) merkezi bir platformda yönetmelerini, yapay zeka desteğiyle analiz etmelerini ve anlam bazlı (semantik) arama yapmalarını sağlayan modern bir doküman yönetim sistemidir.

## 🌟 Öne Çıkan Özellikler
* **Akıllı Analiz:** Yüklenen PDF'lerin Groq LLM (Llama 3.1) ile otomatik özetlenmesi ve anahtar kelime çıkarımı.
* **Semantik Arama:** `pgvector` ve `HNSW` indeksi kullanarak belgeler içinde anlam bazlı (vektörel) arama.
* **Akademik Atıf Desteği:** APA, MLA, BibTeX ve IEEE formatlarında otomatik atıf oluşturma.
* **PDF Görüntüleyici:** PDF.js ile tarayıcı üzerinde PDF okuma ve metin işaretleme.
* **Koleksiyon & Rapor:** Belgeler koleksiyonlara eklenebilir, Groq ile otomatik literatür raporu oluşturulabilir.
* **Asenkron İşleme:** Uzun süren LLM işlemlerinin `Celery` ve `Redis` ile arka planda yönetilmesi.

## 🛠 Teknoloji Yığını
| Katman | Teknoloji |
|---|---|
| **Backend** | Python 3.11 + FastAPI |
| **Frontend** | HTML5 + CSS3 + Vanilla JavaScript |
| **Veritabanı** | PostgreSQL + pgvector |
| **LLM** | Groq API (Llama 3.1 8B Instant) |
| **Embedding** | Sentence Transformers (all-MiniLM-L6-v2) |
| **Dosya Depolama** | MinIO (S3 Uyumlu Self-hosted) |
| **Kimlik Doğrulama** | JWT + Redis Token Blacklist |
| **Kuyruk / Cache** | Redis + Celery |
| **Konteyner** | Docker + Docker Compose |

## 📋 Ön Koşullar
* **Docker Desktop**
* **Python 3.11+**
* **Groq API Key** ([console.groq.com](https://console.groq.com) üzerinden ücretsiz alınabilir)

## 🚀 Hızlı Başlangıç

1. **Ortam değişkenlerini hazırlayın:**
```bash
cp .env.example .env
# .env dosyasında GROQ_API_KEY ve SECRET_KEY değerlerini doldurun
```

2. **Sistemi Docker ile ayağa kaldırın:**
```bash
docker-compose up --build
```

3. **Frontend'i başlatın:**
```bash
cd frontend
python -m http.server 3000
```

4. **Erişim:**
   - 🌐 Uygulama: [http://localhost:3000](http://localhost:3000)
   - 📖 API Docs: [http://localhost:8000/docs](http://localhost:8000/docs)
   - 🗄 MinIO: [http://localhost:9001](http://localhost:9001)

## 📁 Proje Yapısı
```text
proje/
├── backend/
│   ├── app/
│   │   ├── api/v1/endpoints/   # API uç noktaları
│   │   ├── core/               # Güvenlik, konfigürasyon
│   │   ├── db/                 # Veritabanı yönetimi
│   │   ├── models/             # ORM Modelleri
│   │   ├── schemas/            # Pydantic şemaları
│   │   ├── services/           # LLM ve depolama servisleri
│   │   └── tasks/              # Celery arka plan görevleri
│   ├── alembic/                # Veritabanı migration'ları
│   ├── docker-compose.yml
│   ├── Dockerfile
│   └── requirements.txt
└── frontend/
    ├── css/                    # Stil dosyaları
    ├── js/                     # JavaScript modülleri
    └── index.html              # Ana giriş noktası
```

## 👤 Hazırlayanlar
* **170423011 - Hayat Diler**
* **170423035 - Nilay Kuru**

_Bu proje, IEEE Std 1016-2009 standartlarına uygun olarak tasarlanmıştır._