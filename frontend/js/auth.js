/* ═══════════════════════════════════════
   auth.js — Giriş / Kayıt form mantığı
═══════════════════════════════════════ */

/* ─── Tab geçişi ─── */
function switchLoginTab(tab) {
  document.querySelectorAll('.login-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');

  const lform = document.getElementById('lform');
  const rform = document.getElementById('rform');
  lform.style.display = tab === 'login' ? 'block' : 'none';
  rform.style.display = tab === 'register' ? 'block' : 'none';
  clearFormError('login-error');
  clearFormError('register-error');
}

/* ─── Hata göster/gizle ─── */
function showFormError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
}
function clearFormError(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('show');
}

/* ─── Buton loading state ─── */
function setButtonLoading(btn, loading, defaultText) {
  btn.disabled = loading;
  btn.textContent = loading ? 'Lütfen bekleyin…' : defaultText;
}

/* ─── GİRİŞ ─── */
async function handleLogin() {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const btn      = document.getElementById('login-btn');
  clearFormError('login-error');

  if (!email || !password) {
    showFormError('login-error', 'E-posta ve şifre alanları zorunludur.');
    return;
  }

  setButtonLoading(btn, true, 'Giriş Yap →');
  try {
    // 1. Login — token otomatik set ediliyor (AuthAPI.login içinde)
    await API.AuthAPI.login(email, password);

    // 2. Token set edildikten sonra /me çağır
    try {
      const user = await API.apiFetch('/auth/me');
      API.Auth.setUser(user);
    } catch (e) {
      // /me başarısız olsa bile devam et
      console.warn('Kullanıcı bilgisi alınamadı:', e);
    }

    goToApp();
  } catch (err) {
    showFormError('login-error', err.message);
  } finally {
    setButtonLoading(btn, false, 'Giriş Yap →');
  }
}

/* ─── KAYIT ─── */
async function handleRegister() {
  const fullName = document.getElementById('reg-name').value.trim();
  const email    = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const btn      = document.getElementById('register-btn');
  clearFormError('register-error');

  if (!fullName || !email || !password) {
    showFormError('register-error', 'Tüm alanları doldurun.');
    return;
  }
  if (password.length < 8) {
    showFormError('register-error', 'Şifre en az 8 karakter olmalıdır.');
    return;
  }

  setButtonLoading(btn, true, 'Hesap Oluştur →');
  try {
    await API.AuthAPI.register(email, password, fullName);
    // Kayıt başarılı → otomatik login yap
    await API.AuthAPI.login(email, password);
    goToApp();
    showToast('Hesabınız oluşturuldu! 🎉');
  } catch (err) {
    showFormError('register-error', err.message);
  } finally {
    setButtonLoading(btn, false, 'Hesap Oluştur →');
  }
}

/* ─── ENTER tuşu desteği ─── */
function handleLoginKeydown(e) {
  if (e.key === 'Enter') handleLogin();
}
function handleRegisterKeydown(e) {
  if (e.key === 'Enter') handleRegister();
}

/* ─── OAUTH ─── */
function loginWithGoogle() { API.AuthAPI.loginWithGoogle(); }
function loginWithGithub() { API.AuthAPI.loginWithGithub(); }

/* ─── ÇIKIŞ ─── */
function handleLogout() {
  API.AuthAPI.logout();
  showScreen('login');
  showToast('Çıkış yapıldı.');
}

/* ─── Uygulama ekranına geç & kullanıcı bilgisini güncelle ─── */
function goToApp() {
  showScreen('app');
  loadUserInfo();
  loadDashboardStats();
  showToast('Hoş geldiniz! 👋');
}

/* ─── Sidebar kullanıcı kartını doldur ─── */
function loadUserInfo() {
  const user = API.Auth.getUser();
  if (!user) return;

  const initials = user.full_name
    ? user.full_name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : '?';

  const nameEl   = document.getElementById('sidebar-user-name');
  const roleEl   = document.getElementById('sidebar-user-role');
  const avatarEl = document.getElementById('sidebar-avatar');
  const hAvatarEl = document.getElementById('header-avatar');

  if (nameEl)   nameEl.textContent  = user.full_name || user.email;
  if (roleEl)   roleEl.textContent  = user.role || 'Araştırmacı';
  if (avatarEl) avatarEl.textContent = initials;
  if (hAvatarEl) hAvatarEl.textContent = initials;
}

/* ─── Sayfa yüklendiğinde zaten login'se direkt uygulamaya gönder ─── */
document.addEventListener('DOMContentLoaded', () => {
  if (API.Auth.isLoggedIn()) {
    goToApp();
  }
});
