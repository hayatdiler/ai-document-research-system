/* ═══════════════════════════════════════
   collections.js — Koleksiyonlar & Rapor (gerçek API)
═══════════════════════════════════════ */

let activeCollectionId = null;
let reportPollTimer    = null;

/* ─── Koleksiyonları yükle ve listele ─── */
async function loadCollections() {
  const listEl = document.getElementById('collections-list-items');
  if (!listEl) return;

  listEl.innerHTML = '<div class="text-muted" style="padding:12px">Yükleniyor…</div>';

  try {
    const collections = await API.CollectionsAPI.list();
    renderCollectionList(collections);

    // İlk koleksiyonu otomatik seç
    if (collections.length > 0) {
      selectCollectionById(collections[0].collection_id, collections[0].name);
    }
  } catch (err) {
    listEl.innerHTML = `<div class="text-muted" style="padding:12px">❌ ${err.message}</div>`;
  }
}

/* ─── Koleksiyon listesini render et ─── */
function renderCollectionList(collections) {
  const listEl = document.getElementById('collections-list-items');
  if (!listEl) return;

  const icons = ['🤖','🌍','⚛','🧬','📚','🔬','💡','🎯'];

  if (collections.length === 0) {
    listEl.innerHTML = `
      <div class="text-muted" style="padding:12px;text-align:center">
        Henüz koleksiyon yok.<br>
        <button class="btn-sm" style="margin-top:10px" onclick="openNewCollectionModal()">+ Oluştur</button>
      </div>`;
    return;
  }

  listEl.innerHTML = collections.map((c, i) => `
    <div class="collection-item" id="coll-item-${c.collection_id}"
         onclick="selectCollectionById('${c.collection_id}', '${escHtml(c.name)}')">
      <div class="coll-icon">${icons[i % icons.length]}</div>
      <div class="coll-info">
        <div class="coll-name">${escHtml(c.name)}</div>
        <div class="coll-count">${c.description || 'Açıklama yok'}</div>
      </div>
    </div>
  `).join('');
}

/* ─── Koleksiyon seç ─── */
async function selectCollectionById(collectionId, name) {
  activeCollectionId = collectionId;

  document.querySelectorAll('.collection-item')
          .forEach(i => i.classList.remove('active'));
  const item = document.getElementById(`coll-item-${collectionId}`);
  if (item) item.classList.add('active');

  const titleEl = document.getElementById('coll-title');
  if (titleEl) titleEl.textContent = name;

  resetReportPanel();

  // Koleksiyondaki belgeleri yükle
  try {
    const docs = await API.apiFetch(`/collections/${collectionId}/documents`);
    renderCollectionDocs(docs);
  } catch (err) {
    console.error('Belgeler yüklenemedi:', err);
  }
}

function renderCollectionDocs(docs) {
  const grid = document.getElementById('collection-docs-grid');
  if (!grid) return;

  if (!docs || docs.length === 0) {
    grid.innerHTML = `<div class="text-muted" style="padding:20px;text-align:center">Bu koleksiyonda henüz belge yok.</div>`;
    return;
  }

  grid.innerHTML = docs.map(d => {
    const status = d.status === 'Done'
      ? '<div class="doc-status status-done">✓ Hazır</div>'
      : '<div class="doc-status status-proc">⏳ İşleniyor</div>';
    return `
      <div class="doc-card" onclick="loadDocumentInViewer('${d.doc_id}'); switchTab('viewer', null)">
        <div class="doc-type-badge">📄 ${d.file_type}</div>
        <div class="doc-title">${d.title}</div>
        <div class="doc-meta">${status}</div>
      </div>`;
  }).join('');
}

/* ─── Eski imza — sidebar koleksiyon tıklaması için ─── */
function selectCollection(el, name) {
  document.querySelectorAll('.collection-item').forEach(i => i.classList.remove('active'));
  el.classList.add('active');
  const titleEl = document.getElementById('coll-title');
  if (titleEl) titleEl.textContent = name;
  resetReportPanel();
}

/* ─── Yeni Koleksiyon Modal ─── */
function openNewCollectionModal() {
  openModal('new-collection-modal');
}

async function handleCreateCollection() {
  const nameEl = document.getElementById('new-coll-name');
  const descEl = document.getElementById('new-coll-desc');
  const btn    = document.getElementById('create-coll-btn');
  const name   = nameEl?.value.trim();

  if (!name) { showToast('❌ Koleksiyon adı zorunludur.', 'error'); return; }

  btn.disabled    = true;
  btn.textContent = 'Oluşturuluyor…';

  try {
    await API.CollectionsAPI.create(name, descEl?.value.trim() || '');
    closeModal('new-collection-modal');
    nameEl.value = '';
    if (descEl) descEl.value = '';
    showToast(`✅ "${name}" koleksiyonu oluşturuldu!`);
    loadCollections();
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Oluştur';
  }
}

/* ─── Rapor paneli göster ─── */
function showReportPanel() {
  const rp = document.getElementById('report-panel');
  if (rp) {
    rp.style.display = 'block';
    rp.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

/* ─── Rapor paneli sıfırla ─── */
function resetReportPanel() {
  const rp   = document.getElementById('report-panel');
  const prog = document.getElementById('report-progress');
  const fill = document.getElementById('report-fill');
  const btn  = document.querySelector('.generate-report-btn');

  if (rp)   rp.style.display = 'none';
  if (prog) prog.classList.remove('show');
  if (fill) fill.style.width = '0%';
  if (btn)  { btn.disabled = false; btn.innerHTML = '🤖 Raporu Oluştur'; }

  clearInterval(reportPollTimer);
}

/* ─── Rapor türü seç ─── */
function selectReport(el) {
  el.closest('.report-options')
    .querySelectorAll('.report-option')
    .forEach(r => r.classList.remove('selected'));
  el.classList.add('selected');
}

/* ─── Rapor oluşturmayı başlat ─── */
async function startReport(btn) {
  if (!activeCollectionId) {
    showToast('❌ Lütfen önce bir koleksiyon seçin.', 'error');
    return;
  }

  // Seçilen rapor türünü al
  const selectedOption = document.querySelector('.report-option.selected .report-option-title')?.textContent;
  let reportType = 'literature';
  if (selectedOption?.includes('Trend')) reportType = 'trend';
  else if (selectedOption?.includes('Atıf')) reportType = 'citation';
  else if (selectedOption?.includes('Karşılaştırma')) reportType = 'comparison';

  btn.disabled    = true;
  btn.innerHTML   = '⏳ İşleniyor…';

  const prog = document.getElementById('report-progress');
  const fill = document.getElementById('report-fill');
  prog.classList.add('show');

  // Adım animasyonlarını başlat
  animateReportSteps();

  try {
    // Backend'e rapor isteği gönder
    await API.CollectionsAPI.requestReport(activeCollectionId, reportType);
    showToast('📊 Rapor kuyruğa alındı, işleniyor…');

    // Durum pollingi başlat
    pollReportStatus(btn, fill);
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
    btn.disabled    = false;
    btn.innerHTML   = '🤖 Raporu Oluştur';
    prog.classList.remove('show');
  }
}

/* ─── Rapor durumunu sorgula (polling) ─── */
function pollReportStatus(btn, fill) {
  let progress = 20;
  clearInterval(reportPollTimer);

  reportPollTimer = setInterval(async () => {
    try {
      const report = await API.CollectionsAPI.getReport(activeCollectionId);

      if (report.status === 'Done') {
        clearInterval(reportPollTimer);
        fill.style.width = '100%';
        completeAllSteps();
        btn.disabled  = false;
        btn.innerHTML = '✅ Rapor Hazır';
        btn.onclick   = null;

        // PDF + DOCX indirme butonları
        const existingDl = document.getElementById('report-dl-btns');
        if (!existingDl) {
          const dlGroup = document.createElement('div');
          dlGroup.id = 'report-dl-btns';
          dlGroup.style.cssText = 'display:flex;gap:8px;margin-top:12px';
          dlGroup.innerHTML = `
            <button class="btn-sm" style="flex:1" onclick="downloadReport('pdf')">📄 PDF İndir</button>
            <button class="btn-outline" style="flex:1" onclick="downloadReport('docx')">📝 Word İndir</button>
          `;
          btn.parentNode.insertBefore(dlGroup, btn.nextSibling);
        }
        showToast('📊 Rapor başarıyla oluşturuldu!');
      } else if (report.status === 'Failed') {
        clearInterval(reportPollTimer);
        showToast('❌ Rapor oluşturulamadı.', 'error');
        btn.disabled  = false;
        btn.innerHTML = '🤖 Tekrar Dene';
      } else {
        // Devam ediyor — progress artır
        progress = Math.min(progress + 10, 90);
        fill.style.width = progress + '%';
      }
    } catch (e) {
      clearInterval(reportPollTimer);
    }
  }, 3000);
}

/* ─── Rapor indir (PDF veya DOCX) ─── */
async function downloadReport(format = 'pdf') {
  if (!activeCollectionId) return;
  try {
    const response = await API.CollectionsAPI.downloadReport(activeCollectionId, format);
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'İndirme başarısız');
    }
    const blob = await response.blob();
    const url  = URL.createObjectURL(blob);
    const ext  = format === 'docx' ? 'docx' : 'pdf';
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `rapor_${activeCollectionId}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`📥 Rapor indirildi! (.${ext})`);
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  }
}

/* ─── BibTeX toplu dışa aktarma ─── */
async function exportBibtex() {
  if (!activeCollectionId) {
    showToast('❌ Önce bir koleksiyon seçin.', 'error');
    return;
  }
  try {
    const response = await API.CollectionsAPI.downloadBibtex(activeCollectionId);
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'BibTeX dışa aktarımı başarısız');
    }
    const blob = await response.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `koleksiyon_${activeCollectionId}.bib`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('📚 BibTeX dosyası indirildi!');
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  }
}

/* ─── Adım animasyonu ─── */
function animateReportSteps() {
  const steps = ['rs-1','rs-2','rs-3','rs-4'];
  let si = 0;

  const iv = setInterval(() => {
    if (si >= steps.length) { clearInterval(iv); return; }
    const icon = document.getElementById(steps[si])?.querySelector('.step-icon');
    if (!icon) { si++; return; }

    // Öncekini bitir
    if (si > 0) {
      const prev = document.getElementById(steps[si-1])?.querySelector('.step-icon');
      if (prev) { prev.textContent = '✓'; prev.className = 'step-icon step-done'; }
    }
    icon.textContent = '⟳';
    icon.className   = 'step-icon step-active';
    si++;
  }, 2000);
}

function completeAllSteps() {
  ['rs-1','rs-2','rs-3','rs-4'].forEach(id => {
    const icon = document.getElementById(id)?.querySelector('.step-icon');
    if (icon) { icon.textContent = '✓'; icon.className = 'step-icon step-done'; }
  });
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
