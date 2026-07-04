/* ═══════════════════════════════════════
   share.js — Koleksiyon paylaşım linki
═══════════════════════════════════════ */

/* ─── Paylaş modalını aç ─── */
async function openShareModal() {
  if (!activeCollectionId) {
    showToast('❌ Önce bir koleksiyon seçin.', 'error');
    return;
  }

  openModal('share-modal');
  document.getElementById('share-loading').style.display = 'block';
  document.getElementById('share-content').style.display = 'none';
  document.getElementById('share-error').style.display   = 'none';

  try {
    const data = await API.ShareAPI.create(activeCollectionId);
    showShareData(data);
  } catch (err) {
    document.getElementById('share-loading').style.display = 'none';
    const errEl = document.getElementById('share-error');
    errEl.style.display = 'block';
    errEl.textContent   = `❌ ${err.message}`;
  }
}

function showShareData(data) {
  document.getElementById('share-loading').style.display = 'none';
  document.getElementById('share-content').style.display = 'block';

  const input = document.getElementById('share-link-input');
  if (input) input.value = data.share_url;

  const expiresEl = document.getElementById('share-expires-label');
  if (expiresEl) {
    expiresEl.textContent = data.expires_at
      ? `⏳ Geçerlilik: ${new Date(data.expires_at).toLocaleDateString('tr-TR')}`
      : '♾ Süresiz geçerli';
  }
}

function copyShareLink() {
  const input = document.getElementById('share-link-input');
  if (!input) return;
  navigator.clipboard.writeText(input.value)
    .then(() => showToast('📋 Link kopyalandı!'))
    .catch(() => {
      input.select();
      document.execCommand('copy');
      showToast('📋 Link kopyalandı!');
    });
}

async function revokeShareLink() {
  if (!activeCollectionId) return;
  if (!confirm('Paylaşım linkini iptal etmek istediğinizden emin misiniz?')) return;

  try {
    await API.ShareAPI.revoke(activeCollectionId);
    closeModal('share-modal');
    showToast('🗑 Paylaşım linki iptal edildi.');
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  }
}

/* ════════════════════════════════════════
   Paylaşılan koleksiyon görünümü (public)
════════════════════════════════════════ */

async function loadSharedCollection(token) {
  const body = document.getElementById('shared-body');
  if (!body) return;

  try {
    const data = await API.ShareAPI.getShared(token);
    renderSharedCollection(data);
  } catch (err) {
    body.innerHTML = `
      <div class="shared-error">
        <div style="font-size:52px;margin-bottom:16px">🔒</div>
        <div style="font-size:22px;font-weight:700;color:var(--deep);margin-bottom:8px">
          ${err.message.includes('dolmuş') ? 'Link Süresi Dolmuş' : 'Link Bulunamadı'}
        </div>
        <div style="font-size:14px;color:var(--muted)">${err.message}</div>
      </div>`;
  }
}

function renderSharedCollection(data) {
  const body = document.getElementById('shared-body');
  if (!body) return;

  const expiresNote = data.expires_at
    ? `<span style="color:var(--muted);font-size:12px">⏳ ${new Date(data.expires_at).toLocaleDateString('tr-TR')} tarihine kadar geçerli</span>`
    : '';

  const docsHtml = data.documents.length
    ? data.documents.map(d => {
        const year    = d.citation_data?.year   ? `📅 ${d.citation_data.year}` : '';
        const author  = d.citation_data?.author ? `👤 ${escShared(d.citation_data.author)}` : '';
        const kws     = (d.keywords || []).slice(0, 5)
          .map(k => `<span class="result-tag">${escShared(k)}</span>`).join('');
        const summary = d.summary
          ? `<p style="font-size:13px;color:var(--muted);line-height:1.6;margin:8px 0 0">${escShared(d.summary.slice(0, 300))}${d.summary.length > 300 ? '…' : ''}</p>`
          : '';

        return `
          <div class="shared-doc-card">
            <div class="doc-type-badge">📄 ${d.file_type}</div>
            <div class="doc-title" style="margin:8px 0 4px">${escShared(d.title)}</div>
            ${(author || year) ? `<div style="display:flex;gap:14px;font-size:12px;color:var(--muted)">${author}${year ? `<span>${year}</span>` : ''}</div>` : ''}
            ${summary}
            ${kws ? `<div class="result-tags" style="margin-top:8px">${kws}</div>` : ''}
          </div>`;
      }).join('')
    : '<div style="color:var(--muted);text-align:center;padding:24px">Bu koleksiyonda belge yok.</div>';

  body.innerHTML = `
    <div class="shared-collection-header">
      <div style="font-size:28px;font-weight:700;font-family:\'Cormorant Garamond\',serif;color:var(--deep)">
        📁 ${escShared(data.name)}
      </div>
      ${data.description ? `<p style="font-size:14px;color:var(--muted);margin-top:6px">${escShared(data.description)}</p>` : ''}
      <div style="display:flex;align-items:center;gap:16px;margin-top:10px;font-size:13px;color:var(--muted)">
        <span>👤 ${escShared(data.shared_by)} tarafından paylaşıldı</span>
        <span>📄 ${data.documents.length} belge</span>
        ${expiresNote}
      </div>
    </div>
    <div class="shared-docs-grid">${docsHtml}</div>
    <div style="text-align:center;margin-top:40px;font-size:12px;color:var(--muted)">
      ArcticDocs ile oluşturuldu ·
      <a href="/" style="color:var(--primary)">Kendi hesabınıza giriş yapın</a>
    </div>`;
}

function escShared(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ─── Sayfa yüklenince URL hash'e bak ─── */
(function checkSharedRoute() {
  const hash = window.location.hash;
  if (!hash.startsWith('#shared/')) return;

  const token = hash.slice(8).split('?')[0];
  if (!token) return;

  document.addEventListener('DOMContentLoaded', () => {
    // Login ve app ekranlarını gizle, shared ekranını göster
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const sharedScreen = document.getElementById('shared-screen');
    if (sharedScreen) sharedScreen.classList.add('active');
    loadSharedCollection(token);
  });
})();
