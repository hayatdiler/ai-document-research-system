# ArcticDocs — Yapay Zeka Destekli Doküman ve Araştırma Yönetim Sistemi

## Proje Tanımı

ArcticDocs; araştırmacıların ve öğrencilerin akademik belgelerini (PDF / TXT) merkezi bir platformda yönetmelerini, yapay zeka desteğiyle analiz etmelerini ve anlam bazlı (semantik) arama yapmalarını sağlayan modern bir doküman yönetim sistemidir.

Kullanıcılar belgelerini sisteme yükledikten sonra Groq LLM (Llama 3.1) otomatik olarak her belgeyi özetler ve anahtar kelimelerini çıkarır. pgvector tabanlı vektör indeksi sayesinde belgeler arasında anlam bazlı arama yapılabilir; APA, MLA, BibTeX ve IEEE formatlarında akademik atıf üretilebilir. Tüm bu ağır LLM işlemleri Celery ve Redis üzerinden asenkron olarak yönetilir.

---

## Özellikler

| # | Özellik | Açıklama |
|---|---|---|
| 1 | **Akıllı Belge Analizi** | Yüklenen PDF/TXT dosyaları Groq LLM (Llama 3.1 8B Instant) ile otomatik olarak özetlenir ve anahtar kelimeleri çıkarılır. |
| 2 | **Semantik Arama** | `pgvector` + `HNSW` indeksi ile belgeler arasında anlam bazlı vektörel arama yapılır. |
| 3 | **Akademik Atıf Üretimi** | APA, MLA, BibTeX ve IEEE formatlarında tek tıkla atıf oluşturma ve dışa aktarma. |
| 4 | **Tarayıcı İçi PDF Görüntüleyici** | PDF.js ile sayfa gezinme, yakınlaştırma ve metin üzerinde vurgulama / yorum / alt çizgi ekleme. |
| 5 | **Koleksiyon Yönetimi** | Belgeler tematik koleksiyonlara gruplanabilir; koleksiyon düzeyinde literatür özeti ve trend analizi raporu oluşturulabilir. |
| 6 | **Asenkron İşlem Kuyruğu** | Uzun süren LLM işlemleri Celery + Redis aracılığıyla arka planda yönetilir; kullanıcı arayüzü bloke olmaz. |
| 7 | **Çoklu Kimlik Doğrulama** | E-posta/şifre ile kayıt ve JWT tabanlı oturum yönetiminin yanı sıra Google ve GitHub OAuth 2.0 ile sosyal giriş. |
| 8 | **Hız Sınırlama (Rate Limiting)** | `slowapi` ile API uç noktalarına istek sınırı uygulanarak sunucu kötüye kullanımı önlenir. |
| 9 | **Yönetici Paneli** | Admin kullanıcıları sistem istatistiklerini, kullanıcı listesini ve işlem loglarını görüntüleyebilir. |
| 10 | **Tam Konteynerize Altyapı** | Docker Compose ile tek komutta tüm servisler (API, veritabanı, önbellek, dosya depolama) ayağa kalkar. |

---

## Kullanılan Teknolojiler

### Backend

| Teknoloji | Versiyon | Kullanım Amacı |
|---|---|---|
| Python | 3.11 | Ana programlama dili |
| FastAPI | 0.111.0 | RESTful API çatısı |
| Uvicorn | 0.30.1 | ASGI sunucusu |
| SQLAlchemy | 2.0.36 | ORM ve asenkron DB erişimi |
| Alembic | 1.13.1 | Veritabanı migration yönetimi |
| Pydantic | 2.7.1 | Veri doğrulama ve şema yönetimi |
| Celery | 5.4.0 | Asenkron görev kuyruğu |
| Groq SDK | 0.9.0 | LLM (Llama 3.1) entegrasyonu |
| Sentence Transformers | 3.0.1 | Metin embedding üretimi |
| python-jose | 3.3.0 | JWT token üretimi ve doğrulama |
| passlib / bcrypt | 1.7.4 | Şifre hashleme |
| MinIO SDK | 7.2.7 | Nesne depolama istemcisi |
| pypdf | 4.3.1 | PDF metin çıkarımı |
| slowapi | 0.1.9 | API hız sınırlama |

### Frontend

| Teknoloji | Kullanım Amacı |
|---|---|
| HTML5 | Sayfa yapısı |
| CSS3 (Vanilla) | Stil; `variables.css`, `layout.css`, `dashboard.css`, `components.css`, `login.css` modülleri |
| JavaScript (Vanilla) | İstemci mantığı; `api.js`, `auth.js`, `upload.js`, `search.js`, `collections.js`, `citation.js` modülleri |
| PDF.js 3.11 | Tarayıcı içi PDF görüntüleme |
| Google Fonts | Cormorant Garamond, DM Sans, JetBrains Mono fontları |

### Veritabanı

| Teknoloji | Kullanım Amacı |
|---|---|
| PostgreSQL 16 | İlişkisel veritabanı |
| pgvector | Vektör depolama ve HNSW tabanlı semantik arama |

### Altyapı ve Diğer Servisler

| Teknoloji | Kullanım Amacı |
|---|---|
| Redis 7 | Celery mesaj broker'ı ve JWT token kara listesi |
| MinIO | Self-hosted S3 uyumlu nesne depolama (PDF/TXT dosyaları) |
| Docker & Docker Compose | Konteynerize dağıtım |
| Groq API | Bulut tabanlı LLM (Llama 3.1 8B Instant) servisi |
| Google OAuth 2.0 | Sosyal kimlik doğrulama |
| GitHub OAuth 2.0 | Sosyal kimlik doğrulama |

---

## Kurulum Adımları

### Ön Koşullar

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Docker Engine + Docker Compose dahil)
- Python 3.11+ *(yalnızca frontend yerel sunucusu için)*
- Groq API Anahtarı — [console.groq.com](https://console.groq.com) adresinden ücretsiz alınabilir

### 1. Depoyu Klonlayın

```bash
git clone https://github.com/kullanici-adi/ai-document-research-system-1.git
cd ai-document-research-system-1
```

### 2. Ortam Değişkenlerini Yapılandırın

```bash
cd backend
cp .env.example .env
```

`.env` dosyasını bir metin editörüyle açın ve zorunlu değerleri doldurun:

```env
SECRET_KEY=guclu-ve-rastgele-bir-anahtar-girin
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxxx

# İsteğe bağlı: Google ve GitHub OAuth
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

### 3. Docker ile Tüm Servisleri Başlatın

```bash
# backend/ dizininde
docker-compose up --build
```

Bu komut aşağıdaki servisleri otomatik olarak başlatır:

| Servis | Adres |
|---|---|
| FastAPI (API) | http://localhost:8000 |
| Swagger UI (API Docs) | http://localhost:8000/docs |
| PostgreSQL | localhost:5432 |
| Redis | localhost:6379 |
| MinIO (Nesne Depolama) | http://localhost:9000 |
| MinIO Yönetim Paneli | http://localhost:9001 |

### 4. Frontend'i Başlatın

Yeni bir terminal açın:

```bash
cd frontend
python -m http.server 3000
```

### 5. Uygulamaya Erişin

Tarayıcınızda [http://localhost:3000](http://localhost:3000) adresini açın.

---

## Kullanım

### Hesap Oluşturma ve Giriş

1. Uygulama açıldığında giriş/kayıt ekranı karşılar.
2. **Hesap Oluştur** sekmesinden e-posta ve şifre ile kayıt olun ya da **Google / GitHub** ile hızlı giriş yapın.

### Belge Yükleme

1. Sol menüden **Belge Yükle** sekmesine geçin.
2. PDF veya TXT dosyalarını sürükleyip bırakın ya da **Dosya Seç** butonunu kullanın.
3. Başlık, yazar, yıl ve yayın bilgilerini girin; varsayılan atıf formatını seçin.
4. **Yükle ve İşle** butonuna tıklayın.
5. Arka planda Celery worker belgeyi işler; LLM özeti ve anahtar kelimeler otomatik oluşturulur.

### Semantik Arama

1. Sol menüden **Semantik Arama** sekmesine geçin.
2. Doğal dil ifadesiyle sorgu girin (ör. *"iklim değişikliğinin tarımsal verime etkisi"*).
3. **Normal** veya **Semantik** mod seçin; **Ara** butonuna tıklayın.
4. Sonuçlar anlam benzerliğine göre sıralanır.

### PDF Görüntüleyici ve Notlar

1. Dashboard ya da arama sonuçlarından bir belgeye tıklayın.
2. **PDF Görüntüleyici** sekmesinde belge görüntülenir.
3. Metin seçerek **Vurgula**, **Yorum** veya **Altı Çiz** araçlarıyla not ekleyin.
4. Sağ panelde AI özeti ve anahtar kelimeler görüntülenir.

### Atıf Oluşturma

1. PDF görüntüleyici sağ panelinde **Atıf Oluştur** butonuna tıklayın.
2. Açılan modalde APA, MLA, BibTeX veya IEEE formatını seçin.
3. **Kopyala** ya da **İndir** ile atıfı dışa aktarın.

### Koleksiyonlar ve Raporlar

1. Sol menüden **Koleksiyonlar** sekmesine geçin.
2. **+ Yeni Koleksiyon** ile tematik bir klasör oluşturun.
3. Belgelerinizi koleksiyona ekleyin.
4. **Rapor Oluştur** ile koleksiyondaki belgelerin literatür özeti, trend analizi veya karşılaştırma raporunu LLM'e oluşturturun.

---

## Katkı
### Hayat Diler
### Nilay Kuru
---

## Lisans

Bu proje [MIT Lisansı](https://opensource.org/licenses/MIT) kapsamında lisanslanmıştır.

---

*Hazırlayanlar: **170423011 - Hayat Diler** · **170423035 - Nilay Kuru***  
*IEEE Std 1016-2009 standartlarına uygun olarak tasarlanmıştır.*
