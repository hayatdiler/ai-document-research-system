/* ═══════════════════════════════════════
   app.js — Navigasyon, toast, kar tanesi, genel yardımcılar
═══════════════════════════════════════ */

/* ─── KAR TANELERİ ─── */
function initSnow() {
  const snow  = document.getElementById('snow');
  const chars = ['❄','❅','❆','·','•'];
  for (let i = 0; i < 28; i++) {
    const f = document.createElement('div');
    f.className  = 'flake';
    f.textContent = chars[Math.floor(Math.random() * chars.length)];
    f.style.left             = Math.random() * 100 + 'vw';
    f.style.animationDuration = (8 + Math.random() * 14) + 's';
    f.style.animationDelay   = (-Math.random() * 20) + 's';
    f.style.fontSize         = (8 + Math.random() * 12) + 'px';
    f.style.opacity          = 0.2 + Math.random() * 0.5;
    snow.appendChild(f);
  }
}

/* ─── EKRAN GEÇİŞİ ─── */
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = name === 'app'
    ? document.getElementById('app-screen')
    : document.getElementById('login-screen');
  if (target) target.classList.add('active');
}

/* ─── TAB NAVİGASYON ─── */
const TAB_TITLES = {
  dashboard:   'Dashboard',
  upload:      'Belge Yükle',
  search:      'Semantik Arama',
  viewer:      'PDF Görüntüleyici',
  collections: 'Koleksiyonlar',
  chat:        'Belgelerle Sohbet',
  settings:    'Ayarlar',
};

function switchTab(id, navEl) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById('tab-' + id);
  if (panel) panel.classList.add('active');

  const titleEl = document.getElementById('header-title');
  if (titleEl) titleEl.textContent = TAB_TITLES[id] || id;

  // navEl verilmemişse otomatik bul
  if (!navEl) {
    document.querySelectorAll('.nav-item').forEach(n => {
      if (n.getAttribute('onclick')?.includes(`'${id}'`)) {
        navEl = n;
      }
    });
  }

  if (navEl) {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    navEl.classList.add('active');
  }

  if (id === 'dashboard')   loadDashboardStats();
  if (id === 'collections') loadCollections();
  if (id === 'settings')    loadSettingsPage();
  if (id === 'chat')        initChatTab();
}

/* ─── SETTINGS ─── */
function loadSettingsPage() {
  const user = API.Auth.getUser();
  if (!user) return;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || '—'; };
  set('s-fullname', user.full_name);
  set('s-email',    user.email);
  set('s-role',     user.role === 'Admin' ? 'Yönetici' : user.role === 'Viewer' ? 'İzleyici' : 'Araştırmacı');
  set('s-created',  user.created_at ? new Date(user.created_at).toLocaleDateString('tr-TR') : '—');
}

/* ─── TOAST ─── */
let toastTimer;
function showToast(msg, type = 'default') {
  const t = document.getElementById('toast');
  t.textContent    = msg;
  t.style.background = type === 'error' ? '#c0392b' : 'var(--deep)';
  t.style.transform = 'translateY(0)';
  t.style.opacity  = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.style.transform = 'translateY(80px)';
    t.style.opacity   = '0';
  }, 3500);
}

/* ─── MODAL ─── */
function openModal(id)  { document.getElementById(id)?.classList.add('show'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('show'); }

/* ─── HEADER ARAMA ─── */
function handleHeaderSearch(value) {
  if (value.length > 2) {
    const searchInput = document.getElementById('main-search-input');
    if (searchInput) searchInput.value = value;
  }
}

/* ─── MODAL OVERLAY KAPAT ─── */

function initModals() {
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.classList.remove('show');
    });
  });
}

/* ─── KLAVYE KISAYOLLARI ─── */
function initKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    // Ctrl+K veya Cmd+K → arama
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      if (API.Auth.isLoggedIn()) {
        switchTab('search', null);
        setTimeout(() => document.getElementById('main-search-input')?.focus(), 50);
      }
    }
    // Ctrl+U → yükleme
    if ((e.ctrlKey || e.metaKey) && e.key === 'u') {
      if (API.Auth.isLoggedIn()) {
        e.preventDefault();
        switchTab('upload', null);
      }
    }
    // Ctrl+Shift+C → sohbet
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'C') {
      if (API.Auth.isLoggedIn()) {
        e.preventDefault();
        switchTab('chat', null);
        setTimeout(() => document.getElementById('chat-input')?.focus(), 50);
      }
    }
    // Escape → açık modalı kapat
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.show').forEach(m => m.classList.remove('show'));
    }
  });
}

/* ─── SAYFA YÜKLENME ─── */
document.addEventListener('DOMContentLoaded', () => {
  initSnow();
  initModals();
  initKeyboardShortcuts();
  startAutoRefresh();
  // Varsayılan renk noktalarını aktif göster
  const firstHl = document.querySelector('#hl-dots .cdot');
  const firstUl = document.querySelector('#ul-dots .cdot');
  if (firstHl) firstHl.classList.add('cdot-active');
  if (firstUl) firstUl.classList.add('cdot-active');
});

async function loadDashboardStats() {
  try {
    if (!API.Auth.isLoggedIn()) return;

    // Skeleton göster
    const docEl  = document.getElementById('stat-docs');
    const collEl = document.getElementById('stat-collections');
    if (docEl)  docEl.innerHTML  = '<span class="stat-skeleton"></span>';
    if (collEl) collEl.innerHTML = '<span class="stat-skeleton"></span>';

    const data = await API.apiFetch('/stats');
    if (docEl)  { docEl.innerHTML  = ''; docEl.textContent  = data.total_documents; }
    if (collEl) { collEl.innerHTML = ''; collEl.textContent = data.total_collections; }

    const unreadEl = document.getElementById('stat-unread');
    const unreadChangeEl = document.getElementById('stat-unread-change');
    if (unreadEl) { unreadEl.innerHTML = ''; unreadEl.textContent = data.unread_count ?? 0; }
    if (unreadChangeEl) {
      const n = data.unread_count ?? 0;
      unreadChangeEl.textContent = n > 0 ? `${n} bekliyor` : 'Hepsi okundu ✓';
      unreadChangeEl.style.color = n > 0 ? 'var(--primary)' : 'var(--success)';
    }

    // LLM durumu
    const llmEl = document.getElementById('llm-status-content');
    if (llmEl) {
      const pending = data.total_llm_jobs || 0;
      if (pending > 0) {
        llmEl.innerHTML = `
          <div style="display:flex;align-items:center;gap:10px">
            <div class="pulse-dot" style="background:var(--primary)"></div>
            <span style="color:var(--primary);font-weight:500">⏳ ${pending} belge işlem kuyruğunda</span>
          </div>`;
      } else {
        llmEl.innerHTML = `
          <div style="display:flex;align-items:center;gap:10px">
            <div class="pulse-dot"></div>
            <span style="color:var(--success);font-weight:500">✅ Tüm belgeler işlendi — Groq / Llama 3.1 hazır</span>
          </div>`;
      }
    }

    // Son belgeler
    const recent = await API.apiFetch('/stats/recent-documents');
    renderRecentDocs(recent);
  } catch (err) {
    console.error('Stats yüklenemedi:', err);
    const grid = document.getElementById('recent-docs');
    if (grid) grid.innerHTML = `
      <div class="doc-card" style="grid-column:1/-1;text-align:center;padding:40px;color:var(--muted)">
        ⚠ İstatistikler yüklenemedi. API bağlantısını kontrol edin.
      </div>`;
  }
}

function renderRecentDocs(docs) {
  const grid = document.getElementById('recent-docs');
  if (!grid) return;

  if (!docs || docs.length === 0) {
    grid.innerHTML = `
      <div class="doc-card" style="grid-column:1/-1;text-align:center;padding:40px;color:var(--muted)">
        Belge yüklemek için <strong>Belge Yükle</strong> sekmesine gidin.
      </div>`;
    return;
  }

  const READING_STATUS_META = {
    Unread:   { label: 'Okunmadı',  color: 'var(--muted)',    icon: '📬' },
    Reading:  { label: 'Okunuyor',  color: 'var(--primary)',  icon: '📖' },
    Read:     { label: 'Okundu',    color: 'var(--success)',  icon: '✅' },
    Reviewed: { label: 'İncelendi', color: '#9b59b6',         icon: '🔍' },
  };

  function truncate(str, n) {
    if (!str) return '';
    return str.length > n ? str.slice(0, n) + '…' : str;
  }

  grid.innerHTML = docs.map(d => {
    const llmStatus = d.status === 'Done'
      ? '<div class="doc-status status-done">✓ Hazır</div>'
      : '<div class="doc-status status-proc">⏳ İşleniyor</div>';
    const year   = d.citation_data?.year   || '';
    const author = d.citation_data?.author || '';
    const summarySnippet = d.summary
      ? `<div style="font-size:12px;color:var(--muted);line-height:1.5;margin:8px 0;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${truncate(d.summary, 120)}</div>`
      : '';

    const rs   = READING_STATUS_META[d.reading_status] || READING_STATUS_META.Unread;
    const rsBadge = `<span class="reading-badge" style="color:${rs.color}" title="${rs.label}">${rs.icon}</span>`;

    const reprocessBtn = d.status !== 'Done'
      ? `<button onclick="event.stopPropagation();reprocessDocument('${d.doc_id}')"
          style="background:none;border:none;cursor:pointer;color:var(--primary);font-size:12px;padding:0 4px"
          title="Yeniden İşle">🔄</button>`
      : '';

    return `
      <div class="doc-card" onclick="loadDocumentInViewer('${d.doc_id}'); switchTab('viewer', null)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
          <div class="doc-type-badge">📄 ${d.file_type}</div>
          ${rsBadge}
        </div>
        <div class="doc-title">${d.title}</div>
        ${author ? `<div class="doc-authors">👤 ${author}</div>` : ''}
        ${summarySnippet}
        <div class="doc-meta">
          ${year ? `<div class="doc-meta-item">📅 ${year}</div>` : ''}
          ${llmStatus}
          ${reprocessBtn}
          <button onclick="event.stopPropagation();deleteDocument('${d.doc_id}', this)"
            style="margin-left:auto;background:none;border:none;cursor:pointer;color:var(--danger);font-size:16px;padding:0 4px"
            title="Belgeyi Sil">🗑</button>
        </div>
      </div>`;
  }).join('');
}

async function deleteDocument(docId, btn) {
  if (!confirm('Bu belgeyi silmek istediğinizden emin misiniz?')) return;

  try {
    await API.DocumentsAPI.delete(docId);
    showToast('✅ Belge silindi.');
    loadDashboardStats(); // Dashboard'ı yenile
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  }
}

async function reprocessDocument(docId) {
  try {
    await API.apiFetch(`/documents/${docId}/reprocess`, { method: 'POST' });
    showToast('🔄 LLM işleme başlatıldı!');
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  }
}

// Dashboard otomatik yenileme
function startAutoRefresh() {
  setInterval(async () => {
    if (document.getElementById('tab-dashboard')?.classList.contains('active')) {
      await loadDashboardStats();
    }
  }, 5000); // 5 saniyede bir
}


