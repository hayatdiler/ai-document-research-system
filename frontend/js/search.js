/* ═══════════════════════════════════════
   search.js — Semantik & keyword arama (gerçek API)
═══════════════════════════════════════ */

let currentMode = 'normal'; // 'normal' | 'semantic'
let searchDebounceTimer  = null;
let filterDebounceTimer  = null;

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

/* ─── Aktif filtreleri topla ─── */
function getActiveFilters() {
  return {
    yearFrom: parseInt(document.getElementById('filter-year-from')?.value) || null,
    yearTo:   parseInt(document.getElementById('filter-year-to')?.value)   || null,
    author:   document.getElementById('filter-author')?.value.trim()       || null,
  };
}

function hasActiveFilters(f) {
  return !!(f.yearFrom || f.yearTo || f.author);
}

/* ─── Filtre paneli aç/kapat ─── */
function toggleFilterPanel(type) {
  const panel = document.getElementById(`fp-${type}`);
  const chip  = document.getElementById(`fc-${type}`);
  if (!panel) return;
  const open = panel.classList.toggle('open');
  chip?.classList.toggle('active', open);
  if (open) panel.querySelector('input')?.focus();
}

/* ─── Filtre girişi değişince (debounced) ─── */
function onFilterInput() {
  const f = getActiveFilters();
  const clearBtn = document.getElementById('filter-clear-btn');
  if (clearBtn) clearBtn.style.display = hasActiveFilters(f) ? 'flex' : 'none';

  // Chip'lerin görsel durumunu güncelle
  document.getElementById('fc-year')?.classList.toggle(
    'filter-chip-set', !!(f.yearFrom || f.yearTo)
  );
  document.getElementById('fc-author')?.classList.toggle(
    'filter-chip-set', !!f.author
  );

  // Sorgu varsa yeniden ara
  clearTimeout(filterDebounceTimer);
  const query = document.getElementById('main-search-input')?.value.trim();
  if (query) filterDebounceTimer = setTimeout(runSearch, 600);
}

/* ─── Filtreleri sıfırla ─── */
function clearFilters() {
  ['filter-year-from', 'filter-year-to', 'filter-author'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  ['fp-year', 'fp-author'].forEach(id =>
    document.getElementById(id)?.classList.remove('open')
  );
  ['fc-year', 'fc-author'].forEach(id =>
    document.getElementById(id)?.classList.remove('active', 'filter-chip-set')
  );
  const clearBtn = document.getElementById('filter-clear-btn');
  if (clearBtn) clearBtn.style.display = 'none';

  const query = document.getElementById('main-search-input')?.value.trim();
  if (query) runSearch();
}

/* ─── Ana arama fonksiyonu ─── */
async function runSearch() {
  const query = document.getElementById('main-search-input')?.value.trim();
  if (!query) { renderEmpty(); return; }

  renderLoading();
  const filters = getActiveFilters();

  try {
    let results;
    if (currentMode === 'semantic') {
      results = await API.SearchAPI.semantic(query, 10, filters);
    } else {
      results = await API.SearchAPI.keyword(query, 10, filters);
    }
    renderResults(results, query, filters);
  } catch (err) {
    renderError(err.message);
  }
}

/* ─── Sonuçları render et ─── */
function renderResults(results, query, filters = {}) {
  const container = document.getElementById('search-results');

  if (!results || results.length === 0) {
    container.innerHTML = `
      <div class="search-empty">
        <div class="search-empty-icon">📂</div>
        <div class="search-empty-title">Sonuç Bulunamadı</div>
        <div class="search-empty-sub">"${escHtml(query)}" için sonuç yok. Farklı kelimeler deneyin.</div>
      </div>`;
    return;
  }

  // Aktif filtre özeti
  const filterTags = [];
  if (filters.yearFrom || filters.yearTo) {
    filterTags.push(`📅 ${filters.yearFrom || '…'}–${filters.yearTo || '…'}`);
  }
  if (filters.author) filterTags.push(`👤 ${escHtml(filters.author)}`);
  const filterSummary = filterTags.length
    ? `<div class="filter-summary">${filterTags.map(t => `<span class="filter-tag-active">${t}</span>`).join('')}</div>`
    : '';

  container.innerHTML = filterSummary + results.map(r => {
    const score   = Math.round((r.similarity_score || 0) * 100);
    const pct     = Math.min(score, 100);
    const summary = highlight(r.summary || 'Özet henüz oluşturulmadı.', query);
    const author  = r.citation_data?.author ? `<span>👤 ${escHtml(r.citation_data.author)}</span>` : '';
    const year    = r.citation_data?.year   ? `<span>📅 ${r.citation_data.year}</span>` : '';
    const keywords = r.keywords?.length
      ? r.keywords.slice(0,4).map(k => `<span class="result-tag">${escHtml(k)}</span>`).join('')
      : '';

    const scoreColor = pct >= 70 ? 'var(--success)' : pct >= 40 ? 'var(--primary)' : 'var(--muted)';

    return `
      <div class="search-result-card" onclick="openDocument('${r.doc_id}')">
        <div class="relevance-score" style="background:linear-gradient(135deg,${scoreColor},var(--deep))">
          <div class="score-val">${pct}</div>
          <div class="score-label">skor</div>
        </div>
        <div class="result-content">
          <div class="result-title">${escHtml(r.title)}</div>
          ${(author || year) ? `<div class="result-authors" style="display:flex;gap:14px;font-size:12px;color:var(--muted);margin-bottom:6px">${author}${year}</div>` : ''}
          <div class="result-snippet">${summary}</div>
          ${keywords ? `<div class="result-tags" style="margin-top:8px">${keywords}</div>` : ''}
        </div>
        <div style="flex-shrink:0;display:flex;flex-direction:column;gap:6px;padding-left:8px" onclick="event.stopPropagation()">
          <button onclick="openDocument('${r.doc_id}')" class="result-action-btn" title="PDF'i Aç">📄</button>
          <button onclick="openDocumentActions(event,'${r.doc_id}')" class="result-action-btn" title="Atıf Oluştur">📝</button>
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
  switchTab('viewer', null);
  loadDocumentInViewer(docId);
}

/* ─── Sağ tık menüsü yerine Card action butonları ─── */
function openDocumentActions(event, docId) {
  event.stopPropagation();
  // Atıf modalını aç
  openCitationModal(docId);
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
