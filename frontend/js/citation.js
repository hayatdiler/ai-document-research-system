/* ═══════════════════════════════════════
   citation.js — Atıf modal (gerçek API)
═══════════════════════════════════════ */

let pdfDoc = null;
let currentPage = 1;
let totalPages = 0;
let pdfScale = 1.2;

let activeCitationDocId = null;

/* ─── HTML escape (XSS önleme) ─── */
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ─── LLM özet metnini güvenli HTML'e çevir ─── */
function renderSummary(raw) {
  // LLM'nin eklediği "ÖZET:", "İşte özet:" gibi önekleri temizle
  const cleaned = raw
    .replace(/^(özet|özet:|i̇şte özet:?|summary:?)\s*/i, '')
    .trim();

  return cleaned
    .split('\n')
    .map(line => {
      const t = line.trim();
      if (!t) return '';
      // **bold** → <strong>
      const safe = esc(t).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      if (/^\d+\./.test(t)) return `<div style="margin:6px 0">${safe}</div>`;
      if (t.startsWith('- ') || t.startsWith('• ')) {
        return `<div style="margin:4px 0;padding-left:12px">• ${safe.slice(2)}</div>`;
      }
      return `<p style="margin:0 0 8px">${safe}</p>`;
    })
    .join('');
}

/* ─── Atıf tab geçişi ─── */
function switchCitTab(btn, format) {
  btn.closest('.citation-tabs')
     .querySelectorAll('.citation-tab')
     .forEach(t => t.classList.remove('active'));
  btn.classList.add('active');

  document.querySelectorAll('.citation-content')
          .forEach(c => c.classList.remove('active'));
  document.getElementById('cit-' + format.toLowerCase())?.classList.add('active');

  // Eğer bu format henüz yüklenmemişse API'den çek
  if (activeCitationDocId) {
    loadCitation(activeCitationDocId, format.toUpperCase());
  }
}

/* ─── Atıf modal aç ─── */
async function openCitationModal(docId) {
  activeCitationDocId = docId;
  openModal('citation-modal');

  // Tüm formatları yükle
  for (const fmt of ['APA', 'MLA', 'BibTeX', 'IEEE']) {
    loadCitation(docId, fmt);
  }
}

/* ─── Tek format yükle ─── */
async function loadCitation(docId, format) {
  const boxId  = 'cit-' + format.toLowerCase();
  const box    = document.querySelector(`#${boxId} .citation-box`);
  if (!box) return;

  box.textContent = 'Yükleniyor…';

  try {
    const data = await API.CitationsAPI.get(docId, format);
    box.textContent = data.citation || 'Atıf üretilemedi.';
  } catch (err) {
    box.textContent = `Hata: ${err.message}`;
  }
}

/* ─── Kopyala ─── */
async function copyText(format) {
  const box = document.querySelector(`#cit-${format.toLowerCase()} .citation-box`);
  if (!box) return;

  try {
    await navigator.clipboard.writeText(box.textContent);
    showToast(`📋 ${format.toUpperCase()} atıfı kopyalandı!`);
  } catch {
    showToast('❌ Kopyalama başarısız.', 'error');
  }
}

/* ─── .txt olarak indir ─── */
function downloadCitation(format) {
  const box = document.querySelector(`#cit-${format.toLowerCase()} .citation-box`);
  if (!box) return;

  const ext  = format === 'BibTeX' ? '.bib' : '.txt';
  const blob = new Blob([box.textContent], { type: 'text/plain' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `citation_${format}${ext}`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast(`⬇ ${format} dosyası indirildi.`);
}


/* ═══════════════════════════════════════
   viewer.js — PDF Görüntüleyici
═══════════════════════════════════════ */

let currentDocId = null;

/* ─── Belgeyi viewer'da aç ─── */
async function loadDocumentInViewer(docId) {
  if (!docId) return;
  currentDocId = docId;
  try {
    const doc = await API.DocumentsAPI.get(docId);
    renderDocumentInfo(doc);
    await renderPdfFrame(null, doc.title, docId);
  } catch (err) {
    showToast(`❌ Belge yüklenemedi: ${err.message}`, 'error');
  }
}

/* ─── Sağ panel: özet, keywords, atıf butonları ─── */
async function renderDocumentInfo(doc) {
  const summaryEl = document.getElementById('doc-summary');
  const keywordsEl = document.getElementById('doc-keywords');

  if (summaryEl) {
    const raw = doc.summary || 'Özet henüz oluşturulmadı…';
    summaryEl.innerHTML = renderSummary(raw);
  }

  if (keywordsEl && doc.keywords?.length) {
    keywordsEl.innerHTML = doc.keywords
      .map(k => `<div class="keyword-chip">${esc(k)}</div>`)
      .join('');
  }

  // Koleksiyonları yükle
  await loadCollectionDropdown(doc.doc_id);

  document.querySelectorAll('.cite-export-btn').forEach(btn => {
    btn.onclick = () => openCitationModal(doc.doc_id);
  });
}

async function loadCollectionDropdown(docId) {
  const select = document.getElementById('collection-select');
  const btn = document.getElementById('add-to-collection-btn');
  if (!select || !btn) return;

  try {
    const collections = await API.CollectionsAPI.list();
    select.innerHTML = '<option value="">— Koleksiyon Seçin —</option>' +
      collections.map(c => `<option value="${c.collection_id}">${c.name}</option>`).join('');

    btn.onclick = async () => {
      const collId = select.value;
      if (!collId) { showToast('❌ Koleksiyon seçin.', 'error'); return; }
      try {
        await API.CollectionsAPI.addDocument(collId, docId);
        showToast('✅ Belge koleksiyona eklendi!');
      } catch (err) {
        showToast(`❌ ${err.message}`, 'error');
      }
    };
  } catch (err) {
    console.error('Koleksiyonlar yüklenemedi:', err);
  }
}

/* ─── PDF iframe ile göster (lazy loading) ─── */
let _pdfObserver = null;

async function renderPdfFrame(downloadUrl, title, docId) {
  const canvas = document.querySelector('.pdf-canvas');
  if (!canvas) return;

  canvas.innerHTML = `
    <div style="text-align:center;padding:40px;color:rgba(255,255,255,0.5)">
      <div style="font-size:32px;margin-bottom:12px">⏳</div>
      <div>PDF yükleniyor…</div>
    </div>`;

  // Önceki IntersectionObserver'ı temizle
  if (_pdfObserver) { _pdfObserver.disconnect(); _pdfObserver = null; }

  try {
    const token = API.Auth.getToken();
    const response = await fetch(`http://localhost:8000/api/documents/${docId}/view`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) throw new Error('PDF yüklenemedi');

    const arrayBuffer = await response.arrayBuffer();

    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    totalPages = pdfDoc.numPages;

    const pageInfo = document.getElementById('pdf-page-info');
    if (pageInfo) pageInfo.textContent = `1 / ${totalPages} sayfa`;

    canvas.innerHTML = `<div id="pdf-container" style="width:100%;display:flex;flex-direction:column;align-items:center;gap:12px;padding:16px;"></div>`;
    const container = document.getElementById('pdf-container');

    // Placeholder divler oluştur — IntersectionObserver ile lazy render
    const dpr = window.devicePixelRatio || 1;
    const placeholderViewport = (await pdfDoc.getPage(1)).getViewport({ scale: pdfScale * dpr });
    const estW = placeholderViewport.width / dpr;
    const estH = placeholderViewport.height / dpr;

    for (let i = 1; i <= totalPages; i++) {
      const placeholder = document.createElement('div');
      placeholder.dataset.pageNum = i;
      placeholder.dataset.rendered = 'false';
      placeholder.style.cssText = `width:${estW}px;height:${estH}px;background:rgba(255,255,255,0.05);border-radius:4px;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.2);font-size:12px;`;
      placeholder.textContent = `Sayfa ${i}`;
      container.appendChild(placeholder);
    }

    // İlk sayfayı hemen render et
    await renderPage(1, container.querySelector('[data-page-num="1"]'));

    // Geri kalanlar için lazy loading
    _pdfObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const div = entry.target;
          if (div.dataset.rendered === 'false') {
            div.dataset.rendered = 'true';
            renderPage(parseInt(div.dataset.pageNum), div);
            _pdfObserver.unobserve(div);
          }
        }
      });
    }, { root: canvas, rootMargin: '200px' });

    container.querySelectorAll('[data-page-num]').forEach(el => {
      if (el.dataset.pageNum !== '1') _pdfObserver.observe(el);
    });

    // Sayfa scroll takibi
    canvas.addEventListener('scroll', () => {
      const visible = container.querySelectorAll('[data-page-num]');
      let closest = 1;
      for (const el of visible) {
        const rect = el.getBoundingClientRect();
        const canvasRect = canvas.getBoundingClientRect();
        if (rect.top >= canvasRect.top - 10) { closest = parseInt(el.dataset.pageNum); break; }
      }
      currentPage = closest;
      if (pageInfo) pageInfo.textContent = `${currentPage} / ${totalPages} sayfa`;
    }, { passive: true });

  } catch (err) {
    canvas.innerHTML = `<div style="text-align:center;color:rgba(255,100,100,0.8);padding:40px">❌ ${err.message}</div>`;
  }
}

async function renderPage(pageNum, pageDiv) {
  if (!pdfDoc || !pageDiv) return;

  const page = await pdfDoc.getPage(pageNum);
  const dpr = window.devicePixelRatio || 1;
  const viewport = page.getViewport({ scale: pdfScale * dpr });

  // Placeholder'ı gerçek içerikle değiştir
  pageDiv.innerHTML = '';
  pageDiv.style.cssText = `position:relative;background:white;border-radius:4px;box-shadow:0 4px 20px rgba(0,0,0,0.4);margin-bottom:8px;`;

  const canvasEl = document.createElement('canvas');
  canvasEl.width  = viewport.width;
  canvasEl.height = viewport.height;
  canvasEl.style.cssText = `display:block;width:${viewport.width / dpr}px;height:${viewport.height / dpr}px;`;

  const textLayerDiv = document.createElement('div');
  textLayerDiv.className = 'textLayer';
  textLayerDiv.style.cssText = `position:absolute;top:0;left:0;width:${viewport.width / dpr}px;height:${viewport.height / dpr}px;--scale-factor:${pdfScale};`;

  pageDiv.appendChild(canvasEl);
  pageDiv.appendChild(textLayerDiv);

  await page.render({ canvasContext: canvasEl.getContext('2d'), viewport }).promise;

  const textContent = await page.getTextContent();
  pdfjsLib.renderTextLayer({
    textContentSource: textContent,
    container: textLayerDiv,
    viewport,
    textDivs: [],
  });
}/* ─── Annotation kaydet ─── */

async function saveAnnotation(color = '#FFFF00') {
  if (!currentDocId) return;

  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) {
    showToast('❌ Önce metni seçin.', 'error');
    return;
  }

  const selectedText = selection.toString().trim();
  if (!selectedText) return;

  try {
    await API.AnnotationsAPI.create(currentDocId, selectedText, null, color);
    showToast('✅ Annotation kaydedildi!');
    selection.removeAllRanges();
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  }
}

async function saveSelectedAnnotation(color) {
  if (!currentDocId) {
    showToast('❌ Önce bir belge açın.', 'error');
    return;
  }

  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) {
    showToast('❌ Önce PDF\'den metin seçin.', 'error');
    return;
  }

  const selectedText = selection.toString().trim();
  if (!selectedText) {
    showToast('❌ Seçili metin bulunamadı.', 'error');
    return;
  }

  const pageDiv = selection.anchorNode?.parentElement?.closest('[data-page-num]');
  const pageNumber = pageDiv ? parseInt(pageDiv.dataset.pageNum) : null;

  // Görsel vurgulama — API'den önce yap
// Görsel vurgulama
const range = selection.getRangeAt(0).cloneRange();
const span = document.createElement('span');
span.style.backgroundColor = color;
span.style.opacity = '0.5';
span.style.mixBlendMode = 'multiply';

try {
  range.surroundContents(span);
} catch(e) {
  // Çok satırlı seçim — her node'u ayrı vurgula
  const fragment = range.cloneContents();
  const spans = [];
  fragment.querySelectorAll('*').forEach(node => {
    const s = document.createElement('span');
    s.style.backgroundColor = color;
    s.style.opacity = '0.5';
    spans.push(s);
  });
  // Basit fallback: selection'ı işaretle
  const div = document.createElement('div');
  div.style.cssText = `
    position:fixed;
    background:${color};
    opacity:0.3;
    pointer-events:none;
    z-index:999;
  `;
  const rect = range.getBoundingClientRect();
  div.style.left = rect.left + 'px';
  div.style.top = rect.top + 'px';
  div.style.width = rect.width + 'px';
  div.style.height = rect.height + 'px';
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 2000);
}
selection.removeAllRanges();

  try {
    await API.AnnotationsAPI.create(currentDocId, selectedText, pageNumber, color);
    showToast('✅ Annotation kaydedildi!');
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  }
}

function changePage(delta) {
  if (!pdfDoc) return;
  const newPage = currentPage + delta;
  if (newPage < 1 || newPage > totalPages) return;
  currentPage = newPage;

  const container = document.getElementById('pdf-container');
  if (!container) return;

  // Sayfaya scroll et
  const pageDiv = container.querySelector(`[data-page-num="${currentPage}"]`);
  if (pageDiv) pageDiv.scrollIntoView({ behavior: 'smooth' });

  const pageInfo = document.getElementById('pdf-page-info');
  if (pageInfo) pageInfo.textContent = `${currentPage} / ${totalPages} sayfa`;
}

async function changeScale(delta) {
  if (!pdfDoc) return;
  pdfScale = Math.min(Math.max(pdfScale + delta, 0.5), 3.0);

  // Mevcut sayfadan yeniden başlat
  if (currentDocId) await renderPdfFrame(null, null, currentDocId);
}