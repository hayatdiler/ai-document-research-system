/* ═══════════════════════════════════════
   citation.js — Atıf modal (gerçek API)
═══════════════════════════════════════ */

let pdfDoc = null;
let currentPage = 1;
let totalPages = 0;
let pdfScale = 1.2;

let activeCitationDocId = null;

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
    const html = raw
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .split('\n')
      .map(line => {
        const trimmed = line.trim();
        if (!trimmed) return '';
        if (/^\d+\./.test(trimmed)) {
          return `<div style="margin:6px 0">${trimmed}</div>`;
        }
        return `<p style="margin:0 0 8px">${trimmed}</p>`;
      })
      .join('');
    summaryEl.innerHTML = html;
  }

  if (keywordsEl && doc.keywords?.length) {
    keywordsEl.innerHTML = doc.keywords.map(k =>
      `<div class="keyword-chip">${k}</div>`
    ).join('');
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

/* ─── PDF iframe ile göster ─── */
async function renderPdfFrame(downloadUrl, title, docId) {
  const canvas = document.querySelector('.pdf-canvas');
  if (!canvas) return;

  canvas.innerHTML = `
    <div id="pdf-container" style="width:100%;display:flex;flex-direction:column;align-items:center;gap:12px;padding:16px;">
    </div>`;

  try {
    const token = API.Auth.getToken();
    const response = await fetch(`http://localhost:8000/api/documents/${docId}/view`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) throw new Error('PDF yüklenemedi');

    const arrayBuffer = await response.arrayBuffer();

    // pdf.js worker
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    totalPages = pdfDoc.numPages;

    // Sayfa bilgisini güncelle
    const pageInfo = document.getElementById('pdf-page-info');
    if (pageInfo) pageInfo.textContent = `1 / ${totalPages} sayfa`;

    // Tüm sayfaları render et
    const container = document.getElementById('pdf-container');
    for (let i = 1; i <= totalPages; i++) {
      await renderPage(i, container, docId);
    }

  } catch (err) {
    canvas.innerHTML = `<div style="text-align:center;color:rgba(255,100,100,0.8);padding:40px">❌ ${err.message}</div>`;
  }
}

async function renderPage(pageNum, container, docId) {
  const page = await pdfDoc.getPage(pageNum);

  const dpr = window.devicePixelRatio || 1;
  const viewport = page.getViewport({ scale: pdfScale * dpr });

  const pageDiv = document.createElement('div');
  pageDiv.style.cssText = `position:relative;background:white;border-radius:4px;box-shadow:0 4px 20px rgba(0,0,0,0.4);margin-bottom:8px;`;
  pageDiv.dataset.pageNum = pageNum;

  const canvas = document.createElement('canvas');
  canvas.width  = viewport.width;
  canvas.height = viewport.height;
  // Görsel boyutu DPR'a göre küçült
  canvas.style.cssText = `display:block;width:${viewport.width / dpr}px;height:${viewport.height / dpr}px;`;

  const textLayerDiv = document.createElement('div');
  textLayerDiv.className = 'textLayer';
  textLayerDiv.style.cssText = `position:absolute;top:0;left:0;width:${viewport.width / dpr}px;height:${viewport.height / dpr}px;--scale-factor:${pdfScale};`;

  pageDiv.appendChild(canvas);
  pageDiv.appendChild(textLayerDiv);
  container.appendChild(pageDiv);

  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

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

function changeScale(delta) {
  if (!pdfDoc) return;
  pdfScale = Math.min(Math.max(pdfScale + delta, 0.5), 3.0);

  // PDF'i yeniden render et
  const container = document.getElementById('pdf-container');
  if (container) container.innerHTML = '';

  for (let i = 1; i <= totalPages; i++) {
    renderPage(i, container, currentDocId);
  }
}