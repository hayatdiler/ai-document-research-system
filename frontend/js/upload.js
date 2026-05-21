/* ═══════════════════════════════════════
   upload.js — Dosya yükleme (gerçek API)
═══════════════════════════════════════ */

let selectedFiles = [];

/* ─── Dosya seçimi (input) ─── */
function handleFileSelect(e) {
  processFiles(e.target.files);
}

/* ─── Drag & Drop ─── */
function handleDrop(e) {
  e.preventDefault();
  document.getElementById('drop-zone').classList.remove('dragging');
  processFiles(e.dataTransfer.files);
}

/* ─── Dosyaları kuyruğa ekle ─── */
function processFiles(files) {
  if (!files || files.length === 0) return;

  const allowed = ['application/pdf', 'text/plain'];
  const queue   = document.getElementById('file-queue');
  const list    = document.getElementById('file-list');

  Array.from(files).forEach(f => {
    if (!allowed.includes(f.type)) {
      showToast(`❌ ${f.name} desteklenmiyor. Sadece PDF ve TXT.`, 'error');
      return;
    }
    if (f.size > 50 * 1024 * 1024) {
      showToast(`❌ ${f.name} 50 MB sınırını aşıyor.`, 'error');
      return;
    }

    selectedFiles.push(f);

    const sizeStr = f.size > 1024 * 1024
      ? (f.size / (1024 * 1024)).toFixed(1) + ' MB'
      : (f.size / 1024).toFixed(1) + ' KB';
    const ext = f.name.split('.').pop().toUpperCase();

    list.innerHTML += `
      <div class="file-item" id="file-item-${selectedFiles.length - 1}">
        <div class="file-ext">${ext}</div>
        <div class="file-info">
          <div class="file-name">${f.name}</div>
          <div class="file-size">${sizeStr}</div>
        </div>
        <div id="file-status-${selectedFiles.length - 1}" style="font-size:16px;color:var(--muted)">⏳</div>
      </div>
    `;
  });

  if (selectedFiles.length > 0) {
    queue.style.display = 'block';
    showToast(`${selectedFiles.length} dosya kuyruğa eklendi.`);
  }
}

/* ─── Meta veri topla ─── */
function getMetaData() {
  return {
    title:     document.getElementById('meta-title')?.value.trim()     || '',
    author:    document.getElementById('meta-author')?.value.trim()    || '',
    year:      document.getElementById('meta-year')?.value.trim()      || '',
    publisher: document.getElementById('meta-publisher')?.value.trim() || '',
  };
}

/* ─── Yükle butonu ─── */
async function simulateUpload(btn) {
  if (selectedFiles.length === 0) {
    showToast('❌ Önce bir dosya seçin.', 'error');
    return;
  }

  const meta = getMetaData();
  if (!meta.title) {
    showToast('❌ Lütfen belge başlığını girin.', 'error');
    document.getElementById('meta-title')?.focus();
    return;
  }

  btn.disabled    = true;
  btn.textContent = '⏳ Yükleniyor…';

  let successCount = 0;
  let failCount    = 0;

  for (let i = 0; i < selectedFiles.length; i++) {
    const statusEl = document.getElementById(`file-status-${i}`);
    try {
      // Her dosya için başlığı biraz farklılaştır (çoklu yüklemede)
      const fileMeta = {
        ...meta,
        title: selectedFiles.length > 1
          ? `${meta.title} (${i + 1})`
          : meta.title,
      };

      await API.DocumentsAPI.upload(selectedFiles[i], fileMeta);
      if (statusEl) statusEl.textContent = '✅';
      successCount++;
    } catch (err) {
      if (statusEl) statusEl.textContent = '❌';
      failCount++;
      console.error(`Yükleme hatası (${selectedFiles[i].name}):`, err.message);
    }
  }

  // Sonuç bildirimi
  if (successCount > 0) {
    showToast(`✅ ${successCount} belge yüklendi, LLM işleme başladı!`);
  }
  if (failCount > 0) {
    showToast(`❌ ${failCount} dosya yüklenemedi.`, 'error');
  }

  // Formu temizle
  setTimeout(() => {
    selectedFiles = [];
    document.getElementById('file-list').innerHTML   = '';
    document.getElementById('file-queue').style.display = 'none';
    document.getElementById('real-file-input').value = '';
    btn.textContent = '📤 Yükle ve İşle';
    btn.disabled    = false;

    // Dashboard'a dön
    if (successCount > 0) switchTab('dashboard', null);
  }, 1500);
}

/* ─── Atıf format seçici ─── */
function selectCF(btn) {
  btn.closest('.cf-options')
     .querySelectorAll('.cf-option')
     .forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
}
