/* ═══════════════════════════════════════
   api.js — Backend ile tüm iletişim buradan geçer
   Base URL: http://localhost:8000
═══════════════════════════════════════ */

const API_BASE = 'http://localhost:8000/api';

/* ─── TOKEN YÖNETİMİ ─── */
const Auth = {
  getToken: () => localStorage.getItem('token'),
  setToken: (t) => localStorage.setItem('token', t),
  removeToken: () => localStorage.removeItem('token'),
  getUser: () => JSON.parse(localStorage.getItem('user') || 'null'),
  setUser: (u) => localStorage.setItem('user', JSON.stringify(u)),
  removeUser: () => localStorage.removeItem('user'),
  isLoggedIn: () => !!localStorage.getItem('token'),
};

/* ─── ORTAK FETCH WRAPPER ─── */
async function apiFetch(path, options = {}) {
  const token = Auth.getToken();
  const headers = { ...options.headers };

  // FormData gönderiliyorsa Content-Type'ı browser'a bırak
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  // Token süresi dolmuşsa login'e at
  if (res.status === 401) {
    Auth.removeToken();
    Auth.removeUser();
    showScreen('login');
    throw new Error('Oturum süresi doldu, lütfen tekrar giriş yapın.');
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = data?.detail || `Sunucu hatası: ${res.status}`;
    throw new Error(msg);
  }

  return data;
}

/* ════════════════════════════════════════
   AUTH
════════════════════════════════════════ */
const AuthAPI = {
  /** E-posta + şifre ile giriş */
  login: async (email, password) => {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    Auth.setToken(data.access_token);
    return data;
  },

  /** Yeni kullanıcı kaydı */
  register: async (email, password, full_name) => {
    const data = await apiFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, full_name }),
    });
    return data;
  },

  /** Çıkış — token'ı temizle */
  logout: () => {
    Auth.removeToken();
    Auth.removeUser();
  },

  /** Google OAuth başlat */
  loginWithGoogle: () => {
    window.location.href = `${API_BASE}/auth/oauth/google`;
  },

  /** GitHub OAuth başlat */
  loginWithGithub: () => {
    window.location.href = `${API_BASE}/auth/oauth/github`;
  },
};

/* ════════════════════════════════════════
   DOCUMENTS
════════════════════════════════════════ */
const DocumentsAPI = {
  /** Belge yükle (multipart/form-data) */
  upload: async (file, meta = {}) => {
    const form = new FormData();
    form.append('file', file);
    form.append('title', meta.title || file.name);
    if (meta.author)    form.append('author', meta.author);
    if (meta.year)      form.append('year', meta.year);
    if (meta.publisher) form.append('publisher', meta.publisher);

    return apiFetch('/documents/upload', { method: 'POST', body: form });
  },

  /** Belge detayı */
  get: (docId) => apiFetch(`/documents/${docId}`),

  /** Belge sil */
  delete: async (docId) => {
  const token = Auth.getToken();
  const res = await fetch(`http://localhost:8000/api/documents/${docId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.detail || `Hata: ${res.status}`);
  }
  return true;
  },

  /** Geçici indirme URL'i al */
  getDownloadUrl: (docId) => apiFetch(`/documents/${docId}/download-url`),

  /** Okuma durumunu güncelle */
  updateReadingStatus: (docId, status) =>
    apiFetch(`/documents/${docId}/reading-status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
};

/* ════════════════════════════════════════
   SEARCH
════════════════════════════════════════ */
const SearchAPI = {
  /** Semantik arama (embedding tabanlı) */
  semantic: (query, top_k = 10) =>
    apiFetch('/search/semantic', {
      method: 'POST',
      body: JSON.stringify({ query, top_k }),
    }),

  /** Anahtar kelime araması (full-text) */
  keyword: (q, limit = 10) =>
    apiFetch(`/search/keyword?q=${encodeURIComponent(q)}&limit=${limit}`),
};

/* ════════════════════════════════════════
   COLLECTIONS
════════════════════════════════════════ */
const CollectionsAPI = {
  /** Koleksiyonları listele */
  list: () => apiFetch('/collections'),

  /** Yeni koleksiyon oluştur */
  create: (name, description = '') =>
    apiFetch('/collections', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    }),

  /** Koleksiyona belge ekle */
  addDocument: (collectionId, docId) =>
    apiFetch(`/collections/${collectionId}/documents/${docId}`, { method: 'POST' }),

  /** Rapor oluşturmayı başlat */
  requestReport: (collectionId, reportType = 'literature') =>
    apiFetch(`/collections/${collectionId}/report?report_type=${reportType}`, { method: 'POST' }),

  /** Rapor durumunu sorgula */
  getReport: (collectionId) =>
    apiFetch(`/collections/${collectionId}/report`),
};

/* ════════════════════════════════════════
   CITATIONS
════════════════════════════════════════ */
const CitationsAPI = {
  /** Atıf formatı üret (APA, MLA, BibTeX, IEEE) */
  get: (docId, format = 'APA') =>
    apiFetch(`/citations/${docId}?format=${format}`),
};

/* ════════════════════════════════════════
   ANNOTATIONS
════════════════════════════════════════ */
const AnnotationsAPI = {
  /** Yeni annotation kaydet */
  create: (docId, selectedText, pageNumber = null, color = '#FFFF00') =>
    apiFetch('/annotations', {
      method: 'POST',
      body: JSON.stringify({ doc_id: docId, selected_text: selectedText, page_number: pageNumber, color }),
    }),

  /** Yorum ekle */
  addComment: (annotationId, content, parentCommentId = null) =>
    apiFetch('/comments', {
      method: 'POST',
      body: JSON.stringify({ annotation_id: annotationId, content, parent_comment_id: parentCommentId }),
    }),

  /** Belgeye ait annotation'ları listele */
  list: (docId) => apiFetch(`/annotations?doc_id=${docId}`),
};

/* ════════════════════════════════════════
   CHAT
════════════════════════════════════════ */
const ChatAPI = {
  /** Belgelerle sohbet — stateless RAG */
  send: (query, { collectionId = null, docIds = null, history = [] } = {}) =>
    apiFetch('/chat', {
      method: 'POST',
      body: JSON.stringify({
        query,
        collection_id: collectionId || null,
        doc_ids: docIds || null,
        history,
      }),
    }),
};

/* ─── EXPORT ─── */
window.API = {
  Auth,
  AuthAPI,
  DocumentsAPI,
  SearchAPI,
  CollectionsAPI,
  CitationsAPI,
  AnnotationsAPI,
  ChatAPI,
  apiFetch,
};
