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

/* ─── DASHBOARD STATS (API'den gerçek veri) ─── */
async function loadDashboardStats() {
  try {
    if (!API.Auth.isLoggedIn()) return;
    const data = await API.apiFetch('/stats');
    const docEl  = document.getElementById('stat-docs');
    const collEl = document.getElementById('stat-collections');
    if (docEl)  docEl.textContent  = data.total_documents;
    if (collEl) collEl.textContent = data.total_collections;
  } catch (err) {
    console.error('Stats yüklenemedi:', err);
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

/* ─── SAYFA YÜKLENME ─── */
document.addEventListener('DOMContentLoaded', () => {
  initSnow();
  initModals();
  startAutoRefresh();
});

async function loadDashboardStats() {
  try {
    if (!API.Auth.isLoggedIn()) return;
    const data = await API.apiFetch('/stats');
    const docEl  = document.getElementById('stat-docs');
    const collEl = document.getElementById('stat-collections');
    if (docEl)  docEl.textContent  = data.total_documents;
    if (collEl) collEl.textContent = data.total_collections;

    // LLM durumu
    const llmEl = document.getElementById('llm-status-content');
    if (llmEl) {
      const pending = data.total_llm_jobs || 0;
      if (pending > 0) {
        llmEl.innerHTML = `<span style="color:var(--primary)">⏳ ${pending} belge işlem kuyruğunda</span>`;
      } else {
        llmEl.innerHTML = `<span style="color:var(--success)">✅ Tüm belgeler işlendi</span>`;
      }
    }

    // Son belgeler
    const recent = await API.apiFetch('/stats/recent-documents');
    renderRecentDocs(recent);
  } catch (err) {
    console.error('Stats yüklenemedi:', err);
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

  grid.innerHTML = docs.map(d => {
    const status = d.status === 'Done'
      ? '<div class="doc-status status-done">✓ Hazır</div>'
      : '<div class="doc-status status-proc">⏳ İşleniyor</div>';
    const year = d.citation_data?.year || '';
    const author = d.citation_data?.author || '';

    const reprocessBtn = d.status !== 'Done'
      ? `<button onclick="reprocessDocument('${d.doc_id}')"
          style="background:none;border:none;cursor:pointer;color:var(--primary);font-size:12px;padding:0 4px"
          title="Yeniden İşle">🔄</button>`
      : '';

    return `
      <div class="doc-card">
        <div class="doc-type-badge">📄 ${d.file_type}</div>
        <div class="doc-title" onclick="loadDocumentInViewer('${d.doc_id}'); switchTab('viewer', null)" style="cursor:pointer">${d.title}</div>
        <div class="doc-authors">${author}</div>
        <div class="doc-meta">
          ${year ? `<div class="doc-meta-item">📅 ${year}</div>` : ''}
          ${status}
          ${reprocessBtn}
          <button onclick="deleteDocument('${d.doc_id}', this)"
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

window.apiFetch = apiFetch;

