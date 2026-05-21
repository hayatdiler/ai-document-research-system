/* ═══════════════════════════════════════
   search.js — Semantik & keyword arama (gerçek API)
═══════════════════════════════════════ */

let currentMode = 'normal'; // 'normal' | 'semantic'
let searchDebounceTimer = null;

/* ─── Mod seçimi ─── */
function setMode(btn, mode) {
  btn.closest('.search-mode-toggle')
     .querySelectorAll('.mode-btn')
     .forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentMode = mode;
  showToast(mode === 'semantic' ? '🧠 Semantik mod aktif' : '🔤 Normal arama modu');
}

/* ─── Header arama kutusundan yönlendir ─── */
function handleHeaderSearch(value) {
  const searchInput = document.getElementById('main-search-input');
  if (searchInput) searchInput.value = value;
  // Debounce ile otomatik arama
  clearTimeout(searchDebounceTimer);
  if (value.length > 2) {
    searchDebounceTimer = setTimeout(() => {
      switchTab('search', null);
      runSearch();
    }, 600);
  }
}

/* ─── Arama tetikleyici ─── */
function updateSearch(value) {
  clearTimeout(searchDebounceTimer);
  if (value.length > 2) {
    searchDebounceTimer = setTimeout(runSearch, 500);
  } else if (value.length === 0) {
    renderEmpty();
  }
}

/* ─── Ana arama fonksiyonu ─── */
async function runSearch() {
  const query = document.getElementById('main-search-input')?.value.trim();
  if (!query) { renderEmpty(); return; }

  renderLoading();

  try {
    let results;
    if (currentMode === 'semantic') {
      results = await API.SearchAPI.semantic(query, 10);
    } else {
      results = await API.SearchAPI.keyword(query, 10);
    }
    renderResults(results, query);
  } catch (err) {
    renderError(err.message);
  }
}

/* ─── Sonuçları render et ─── */
function renderResults(results, query) {
  const container = document.getElementById('search-results');

  if (!results || results.length === 0) {
    container.innerHTML = `
      <div class="search-empty">
        <div class="search-empty-icon">📂</div>
        <div class="search-empty-title">Sonuç Bulunamadı</div>
        <div class="search-empty-sub">"${query}" için sonuç yok. Farklı kelimeler deneyin.</div>
      </div>`;
    return;
  }

  container.innerHTML = results.map(r => {
    const score    = Math.round((r.similarity_score || 0) * 100);
    const summary  = highlight(r.summary || 'Özet henüz oluşturulmadı.', query);

    return `
      <div class="search-result-card" onclick="openDocument('${r.doc_id}')">
        <div class="relevance-score">
          <div class="score-val">${score}</div>
          <div class="score-label">skor</div>
        </div>
        <div class="result-content">
          <div class="result-title">${escHtml(r.title)}</div>
          <div class="result-snippet">${summary}</div>
        </div>
      </div>`;
  }).join('');

  showToast(`${results.length} sonuç bulundu.`);
}

/* ─── Yükleniyor ─── */
function renderLoading() {
  document.getElementById('search-results').innerHTML = `
    <div class="search-empty">
      <div class="search-empty-icon" style="animation: pulse 1.5s infinite">🔍</div>
      <div class="search-empty-title">Aranıyor…</div>
    </div>`;
}

/* ─── Boş durum ─── */
function renderEmpty() {
  document.getElementById('search-results').innerHTML = `
    <div class="search-empty">
      <div class="search-empty-icon">🔍</div>
      <div class="search-empty-title">Araştırmanızı Başlatın</div>
      <div class="search-empty-sub">Semantik modda anlamsal benzerlik ile arama yapabilirsiniz.</div>
    </div>`;
}

/* ─── Hata ─── */
function renderError(msg) {
  document.getElementById('search-results').innerHTML = `
    <div class="search-empty">
      <div class="search-empty-icon">⚠️</div>
      <div class="search-empty-title">Arama Başarısız</div>
      <div class="search-empty-sub">${escHtml(msg)}</div>
    </div>`;
}

/* ─── Belge aç ─── */
function openDocument(docId) {
  // Viewer tab'ına geç ve belgeyi yükle
  switchTab('viewer', null);
  loadDocumentInViewer(docId);
}

/* ─── Yardımcılar ─── */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function highlight(text, query) {
  if (!query || !text) return escHtml(text || '');
  const escaped = escHtml(text);
  const words   = query.split(/\s+/).filter(Boolean);
  let result    = escaped;
  words.forEach(word => {
    const re = new RegExp(`(${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    result = result.replace(re, '<span class="snippet-em">$1</span>');
  });
  return result;
}
