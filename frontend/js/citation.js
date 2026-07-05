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
let _docAnnotations = [];   // mevcut belgenin annotation cache'i

/* ─── Belgeyi viewer'da aç ─── */
async function loadDocumentInViewer(docId) {
  if (!docId) return;
  currentDocId = docId;
  _docAnnotations = [];

  try {
    // Belge bilgisi ve annotation'ları paralel çek
    const [doc, annotations] = await Promise.all([
      API.DocumentsAPI.get(docId),
      API.AnnotationsAPI.list(docId).catch(() => []),
    ]);

    _docAnnotations = annotations || [];
    renderDocumentInfo(doc);
    renderAnnotationsList(_docAnnotations);
    await renderPdfFrame(null, doc.title, docId);
  } catch (err) {
    showToast(`❌ Belge yüklenemedi: ${err.message}`, 'error');
  }
}

/* ─── Sağ panel: özet, keywords, atıf butonları ─── */
async function renderDocumentInfo(doc) {
  const summaryEl = document.getElementById('doc-summary');
  const keywordsEl = document.getElementById('doc-keywords');

  // Okuma durumu seçicisini güncelle
  updateReadingStatusUI(doc.reading_status || 'Unread');

  // Özet butonu: özet varsa "Yenile", yoksa "Oluştur"
  const streamBtn = document.getElementById('summary-stream-btn');
  if (streamBtn) {
    streamBtn.style.display = 'inline-flex';
    streamBtn.textContent   = doc.summary ? '🔄 Yenile' : '✨ Oluştur';
    streamBtn.disabled      = false;
  }

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
  const renderTask = pdfjsLib.renderTextLayer({
    textContentSource: textContent,
    container: textLayerDiv,
    viewport,
    textDivs: [],
  });

  // Text layer tamamen render edilince annotation'ları uygula
  try {
    if (renderTask?.promise) await renderTask.promise;
  } catch { /* bazı PDF.js sürümlerinde promise yok — ignore */ }

  applyAnnotationsToPage(pageNum, textLayerDiv);
}

/* ─── Sağ paneldeki annotation listesini render et ─── */
function renderAnnotationsList(annotations) {
  const listEl = document.getElementById('doc-annotations-list');
  if (!listEl) return;

  if (!annotations.length) {
    listEl.innerHTML = '<div style="font-size:12px;color:var(--muted)">Henüz vurgulama yok.</div>';
    return;
  }

  listEl.innerHTML = annotations.map(a => {
    const pageLabel = a.page_number ? `S.${a.page_number}` : '';
    const preview   = esc(a.selected_text.slice(0, 55)) + (a.selected_text.length > 55 ? '…' : '');
    return `
      <div class="ann-list-item" onclick="scrollToAnnotation('${a.annotation_id}', ${a.page_number || 1})">
        <span class="ann-color-dot" style="background:${a.color}"></span>
        <div style="flex:1;min-width:0">
          <div class="ann-preview">${preview}</div>
          ${pageLabel ? `<div class="ann-page-label">${pageLabel}</div>` : ''}
        </div>
      </div>`;
  }).join('');
}

/* ─── Annotation'a scroll ─── */
function scrollToAnnotation(annotationId, pageNum) {
  // Önce o sayfaya git
  const pageDiv = document.querySelector(`[data-page-num="${pageNum}"]`);
  if (pageDiv) {
    pageDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Highlight span'ı bul ve flash yap
    setTimeout(() => {
      const span = pageDiv.querySelector(`[data-annotation-id="${annotationId}"]`);
      if (span) {
        span.style.outline = '2px solid var(--primary)';
        span.style.outlineOffset = '2px';
        setTimeout(() => { span.style.outline = ''; }, 1500);
      }
    }, 400);
  }
}

/* ─── Streaming özet ─── */
async function requestStreamSummary() {
  if (!currentDocId) return;

  const summaryEl = document.getElementById('doc-summary');
  const btn       = document.getElementById('summary-stream-btn');
  if (!summaryEl || !btn) return;

  // UI: başlıyor
  btn.disabled      = true;
  btn.textContent   = '⏳';
  summaryEl.classList.add('streaming-active');
  summaryEl.textContent = '';

  try {
    const token    = API.Auth.getToken();
    const response = await fetch(
      `http://localhost:8000/api/documents/${currentDocId}/summary/stream`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` } }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || `Sunucu hatası: ${response.status}`);
    }

    const reader  = response.body.getReader();
    const decoder = new TextDecoder();
    let   buffer  = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Son yarım satır → sonraki döngüye taşı

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (!raw) continue;

        let payload;
        try { payload = JSON.parse(raw); } catch { continue; }

        if (payload.error) {
          summaryEl.classList.remove('streaming-active');
          summaryEl.innerHTML = `<span style="color:var(--danger)">❌ ${esc(payload.error)}</span>`;
          btn.disabled = false; btn.textContent = '🔄 Yenile';
          return;
        }

        if (payload.status === 'streaming') {
          summaryEl.textContent = '';  // "Hazırlanıyor…" temizle
          continue;
        }

        if (payload.text) {
          // Token'ı karakter karakter ekle
          summaryEl.textContent += payload.text;
        }

        if (payload.done) {
          summaryEl.classList.remove('streaming-active');
          // Son hali güzel render et
          summaryEl.innerHTML = renderSummary(summaryEl.textContent);
          btn.disabled = false; btn.textContent = '🔄 Yenile';
        }
      }
    }

  } catch (err) {
    summaryEl.classList.remove('streaming-active');
    summaryEl.innerHTML = `<span style="color:var(--danger)">❌ ${esc(err.message)}</span>`;
    btn.disabled = false; btn.textContent = '🔄 Yenile';
    showToast(`❌ ${err.message}`, 'error');
  }
}

/* ─── Okuma durumu UI ─── */
function updateReadingStatusUI(status) {
  document.querySelectorAll('.rs-btn').forEach(btn => {
    btn.classList.toggle('rs-active', btn.dataset.status === status);
  });
}

async function setReadingStatus(status) {
  if (!currentDocId) return;
  try {
    await API.DocumentsAPI.updateReadingStatus(currentDocId, status);
    updateReadingStatusUI(status);
    const labels = { Unread: 'Okunmadı', Reading: 'Okunuyor', Read: 'Okundu', Reviewed: 'İncelendi' };
    showToast(`📌 Durum: ${labels[status] || status}`);
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  }
}

/* ─── Sayfadaki annotation'ları text layer'a uygula ─── */
function applyAnnotationsToPage(pageNum, textLayerDiv) {
  if (!_docAnnotations.length) return;

  // page_number null ise ilk sayfada göster
  const pageAnns = _docAnnotations.filter(
    a => a.page_number === pageNum || (!a.page_number && pageNum === 1)
  );

  for (const ann of pageAnns) {
    highlightTextInLayer(textLayerDiv, ann);
  }
}

/* ─── Text span'larında annotation metnini bul ve vurgula ─── */
function highlightTextInLayer(textLayerDiv, annotation) {
  const spans = Array.from(textLayerDiv.querySelectorAll('span'));
  if (!spans.length) return;

  const searchText = annotation.selected_text.trim().toLowerCase();
  if (searchText.length < 3) return;

  // Tüm span metinlerini birleştir, konum haritası oluştur
  let fullText = '';
  const spanMap = spans.map(span => {
    const start = fullText.length;
    fullText += span.textContent;
    return { span, start, end: fullText.length };
  });

  // İlk eşleşmeyi bul (max 80 karakter karşılaştır)
  const needle = searchText.slice(0, 80);
  const foundIdx = fullText.toLowerCase().indexOf(needle);
  if (foundIdx === -1) return;

  const foundEnd = foundIdx + needle.length;

  // Eşleşen span'ları vurgula
  for (const { span, start, end } of spanMap) {
    if (end > foundIdx && start < foundEnd) {
      span.style.backgroundColor = annotation.color;
      span.style.opacity = '0.75';
      span.style.borderRadius = '2px';
      span.style.cursor = 'pointer';
      span.dataset.annotationId = annotation.annotation_id;
      span.title = `📌 Kaldırmak için tıkla: ${annotation.selected_text.slice(0, 60)}`;
      span.onclick = (e) => { e.stopPropagation(); deleteAnnotation(annotation.annotation_id); };
    }
  }
}/* ─── Annotation kaydet ─── */

async function deleteAnnotation(annotationId) {
  try {
    await API.AnnotationsAPI.delete(annotationId);
    _docAnnotations = _docAnnotations.filter(a => a.annotation_id !== annotationId);
    renderAnnotationsList(_docAnnotations);
    // Tüm sayfadaki bu annotation span'larını temizle
    document.querySelectorAll(`[data-annotation-id="${annotationId}"]`).forEach(span => {
      span.style.backgroundColor = '';
      span.style.opacity = '';
      span.style.cursor = '';
      span.onclick = null;
      delete span.dataset.annotationId;
    });
    showToast('🗑 Vurgu kaldırıldı.');
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  }
}

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
    showToast('✅ Vurgu kaydedildi!');
    selection.removeAllRanges();
    // Annotation listesini yenile ve sayfaya uygula
    _docAnnotations = await API.AnnotationsAPI.list(currentDocId);
    renderAnnotationsList(_docAnnotations);
    const pageDiv = document.querySelector('.pdf-page-wrapper .textLayer');
    if (pageDiv) applyAnnotationsToPage(_currentPageNum || 1, pageDiv);
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

  selection.removeAllRanges();

  try {
    const ann = await API.AnnotationsAPI.create(currentDocId, selectedText, pageNumber, color);

    // Cache'e ekle, listeyi ve sayfayı hemen güncelle
    _docAnnotations.push(ann);
    renderAnnotationsList(_docAnnotations);

    const targetPage    = pageNumber || 1;
    const targetPageDiv = document.querySelector(`[data-page-num="${targetPage}"]`);
    const textLayerDiv  = targetPageDiv?.querySelector('.textLayer');
    if (textLayerDiv) highlightTextInLayer(textLayerDiv, ann);

    showToast('✅ Annotation kaydedildi!');
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  }
}

function togglePdfFullscreen() {
  const panel = document.querySelector('.pdf-viewer-panel');
  const btn   = document.getElementById('fullscreen-btn');
  const isFs  = panel.classList.toggle('pdf-fullscreen');
  btn.textContent = isFs ? '✕' : '⛶';
  btn.title = isFs ? 'Tam Ekrandan Çık (ESC)' : 'Tam Ekran';
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const panel = document.querySelector('.pdf-viewer-panel');
    if (panel && panel.classList.contains('pdf-fullscreen')) togglePdfFullscreen();
  }
});

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