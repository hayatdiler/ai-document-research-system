/* ═══════════════════════════════════════
   chat.js — Belgelerle sohbet
═══════════════════════════════════════ */

let chatHistory   = [];   // [{role, content}]
let chatInited    = false;
let chatLoading   = false;

/* ─── Tab açılınca çağrılır ─── */
async function initChatTab() {
  if (!chatInited) {
    chatInited = true;
    await loadChatContextOptions();
    // Badge gizle
    const badge = document.getElementById('chat-badge');
    if (badge) badge.style.display = 'none';
  }
}

/* ─── Koleksiyon ve belge listelerini yükle ─── */
async function loadChatContextOptions() {
  try {
    const collections = await API.CollectionsAPI.list();
    const collSel = document.getElementById('chat-coll-id');
    if (collSel) {
      collSel.innerHTML = collections.length
        ? collections.map(c => `<option value="${c.collection_id}">${esc(c.name)}</option>`).join('')
        : '<option value="">Koleksiyon yok</option>';
    }
  } catch (e) {
    console.warn('Koleksiyonlar yüklenemedi:', e);
  }

  try {
    const docs = await API.apiFetch('/stats/recent-documents');
    const listEl = document.getElementById('chat-doc-list');
    if (listEl && docs?.length) {
      listEl.innerHTML = docs.map(d => `
        <label class="chat-doc-item">
          <input type="checkbox" class="chat-doc-cb" value="${d.doc_id}"
                 onchange="updateChatContextLabel()">
          <span class="chat-doc-item-name">${esc(d.title)}</span>
          ${d.status === 'Done'
            ? '<span class="doc-status status-done" style="padding:2px 7px;font-size:10px">✓</span>'
            : '<span class="doc-status status-proc" style="padding:2px 7px;font-size:10px">⏳</span>'}
        </label>
      `).join('');
    } else if (listEl) {
      listEl.innerHTML = '<div class="text-muted" style="font-size:13px;padding:8px 0">Belge bulunamadı.</div>';
    }
  } catch (e) {
    console.warn('Belgeler yüklenemedi:', e);
  }
}

/* ─── Mod değişimi ─── */
function onChatModeChange(mode) {
  document.getElementById('chat-collection-select').style.display = mode === 'collection' ? 'block' : 'none';
  document.getElementById('chat-docs-select').style.display       = mode === 'docs'       ? 'block' : 'none';
  updateChatContextLabel();
}

/* ─── Bağlam etiketini güncelle ─── */
function updateChatContextLabel() {
  const mode  = document.getElementById('chat-mode')?.value;
  const label = document.getElementById('chat-context-label');
  if (!label) return;

  if (mode === 'collection') {
    const sel  = document.getElementById('chat-coll-id');
    const name = sel?.options[sel.selectedIndex]?.text || '—';
    label.textContent = `"${name}" koleksiyonu bağlam olarak kullanılır`;
  } else if (mode === 'docs') {
    const checked = document.querySelectorAll('.chat-doc-cb:checked');
    label.textContent = checked.length
      ? `${checked.length} belge seçildi`
      : 'Lütfen en az bir belge seçin';
  } else {
    label.textContent = 'Tüm belgeleriniz bağlam olarak kullanılır';
  }
}

/* ─── Gönder kısayolu ─── */
function handleChatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
}

/* ─── Textarea otomatik büyütme ─── */
function autoResizeChatInput(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}

/* ─── Öneri butonuna bas ─── */
function useSuggestion(btn) {
  const input = document.getElementById('chat-input');
  if (input) {
    input.value = btn.textContent;
    input.focus();
    autoResizeChatInput(input);
  }
}

/* ─── Sohbet temizle ─── */
function clearChat() {
  chatHistory = [];
  const msgs = document.getElementById('chat-messages');
  if (msgs) msgs.innerHTML = buildWelcome();
  const input = document.getElementById('chat-input');
  if (input) { input.value = ''; input.style.height = 'auto'; }
}

/* ─── Mesaj gönder ─── */
async function sendChatMessage() {
  if (chatLoading) return;

  const input = document.getElementById('chat-input');
  const query = input?.value.trim();
  if (!query) return;

  // Bağlam parametrelerini topla
  const mode = document.getElementById('chat-mode')?.value || 'all';
  let collectionId = null;
  let docIds = null;

  if (mode === 'collection') {
    collectionId = document.getElementById('chat-coll-id')?.value || null;
    if (!collectionId) { showToast('❌ Koleksiyon seçin.', 'error'); return; }
  } else if (mode === 'docs') {
    const checked = [...document.querySelectorAll('.chat-doc-cb:checked')];
    if (!checked.length) { showToast('❌ En az bir belge seçin.', 'error'); return; }
    docIds = checked.map(cb => cb.value);
  }

  // Kullanıcı mesajını UI'a ekle
  appendMessage('user', query);
  chatHistory.push({ role: 'user', content: query });
  input.value = '';
  input.style.height = 'auto';

  // Yükleniyor göster
  chatLoading = true;
  setSendBtnLoading(true);
  const thinkingId = appendThinking();

  try {
    const res = await API.ChatAPI.send(query, {
      collectionId,
      docIds,
      history: chatHistory.slice(0, -1), // son mesajı zaten query olarak gönderdik
    });

    removeThinking(thinkingId);
    appendMessage('assistant', res.answer, res.sources);
    chatHistory.push({ role: 'assistant', content: res.answer });

  } catch (err) {
    removeThinking(thinkingId);
    appendMessage('error', err.message);
  } finally {
    chatLoading = false;
    setSendBtnLoading(false);
  }
}

/* ─── Mesaj baloncuğu ekle ─── */
function appendMessage(role, content, sources = []) {
  const msgs = document.getElementById('chat-messages');
  if (!msgs) return;

  // Karşılama mesajını kaldır
  msgs.querySelector('.chat-welcome')?.remove();

  const div = document.createElement('div');
  div.className = `chat-msg chat-msg-${role}`;

  if (role === 'user') {
    div.innerHTML = `<div class="chat-bubble chat-bubble-user">${esc(content)}</div>`;
  } else if (role === 'error') {
    div.innerHTML = `<div class="chat-bubble chat-bubble-error">⚠ ${esc(content)}</div>`;
  } else {
    const renderedContent = renderAssistantContent(content);
    const sourcesHtml = sources.length
      ? `<div class="chat-sources">
           <div class="chat-sources-label">Kaynaklar:</div>
           ${sources.map(s => `
             <button class="chat-source-chip" onclick="loadDocumentInViewer('${s.doc_id}'); switchTab('viewer', null)">
               📄 ${esc(s.title)}
             </button>`).join('')}
         </div>`
      : '';
    div.innerHTML = `
      <div class="chat-avatar">🤖</div>
      <div>
        <div class="chat-bubble chat-bubble-assistant">${renderedContent}</div>
        ${sourcesHtml}
      </div>`;
  }

  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

/* ─── Düşünüyor animasyonu ─── */
function appendThinking() {
  const msgs = document.getElementById('chat-messages');
  if (!msgs) return null;

  const id = 'thinking-' + Date.now();
  const div = document.createElement('div');
  div.id = id;
  div.className = 'chat-msg chat-msg-assistant';
  div.innerHTML = `
    <div class="chat-avatar">🤖</div>
    <div class="chat-bubble chat-bubble-assistant chat-thinking">
      <span></span><span></span><span></span>
    </div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return id;
}

function removeThinking(id) {
  if (id) document.getElementById(id)?.remove();
}

/* ─── Asistan yanıtını güvenli HTML'e çevir ─── */
function renderAssistantContent(text) {
  if (!text) return '';

  return text
    .split('\n')
    .map(line => {
      const t = line.trim();
      if (!t) return '<br>';
      // Başlıklar
      if (t.startsWith('### ')) return `<h4 style="margin:10px 0 4px;font-size:13px;font-weight:700;color:var(--deep)">${esc(t.slice(4))}</h4>`;
      if (t.startsWith('## '))  return `<h3 style="margin:10px 0 4px;font-size:14px;font-weight:700;color:var(--deep)">${esc(t.slice(3))}</h3>`;
      // Bullet
      if (t.startsWith('- ') || t.startsWith('• ')) {
        const safe = esc(t.slice(2)).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        return `<div style="padding:2px 0 2px 14px;position:relative">
          <span style="position:absolute;left:0;top:0">•</span>${safe}</div>`;
      }
      // Numaralı liste
      if (/^\d+\.\s/.test(t)) {
        const safe = esc(t).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        return `<div style="padding:2px 0">${safe}</div>`;
      }
      // Normal metin
      const safe = esc(t).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      return `<p style="margin:0 0 6px">${safe}</p>`;
    })
    .join('');
}

function setSendBtnLoading(loading) {
  const btn = document.getElementById('chat-send-btn');
  if (!btn) return;
  btn.disabled = loading;
  btn.style.opacity = loading ? '0.5' : '1';
}

function buildWelcome() {
  return `<div class="chat-welcome">
    <div class="chat-welcome-icon">🤖</div>
    <div class="chat-welcome-title">Araştırma Asistanı</div>
    <div class="chat-welcome-sub">Belgeleriniz hakkında soru sorun.</div>
    <div class="chat-suggestions">
      <button class="chat-suggestion" onclick="useSuggestion(this)">Bu belgelerde hangi yöntemler kullanılmış?</button>
      <button class="chat-suggestion" onclick="useSuggestion(this)">Ana bulgular nelerdir?</button>
      <button class="chat-suggestion" onclick="useSuggestion(this)">Belgeler arasındaki temel farklılıklar neler?</button>
      <button class="chat-suggestion" onclick="useSuggestion(this)">Bu çalışmaların sınırlılıkları nelerdir?</button>
    </div>
  </div>`;
}

/* ─── HTML escape ─── */
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
