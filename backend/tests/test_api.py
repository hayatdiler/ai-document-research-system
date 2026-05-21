"""
ArcticDocs — Temel API Testleri
Çalıştırma: pytest tests/ -v
"""
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture
async def auth_token(client):
    """Test kullanıcısı oluştur ve token döndür."""
    await client.post("/api/auth/register", json={
        "email": "pytest@test.com",
        "password": "testpass123",
        "full_name": "Pytest Kullanici",
    })
    resp = await client.post("/api/auth/login", json={
        "email": "pytest@test.com",
        "password": "testpass123",
    })
    return resp.json()["access_token"]


# ── 1. Health Check ───────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_health_check(client):
    """API ayakta mı?"""
    resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


# ── 2. Kayıt ─────────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_register_success(client):
    """Yeni kullanıcı kaydı başarılı mı?"""
    resp = await client.post("/api/auth/register", json={
        "email": "newuser@test.com",
        "password": "password123",
        "full_name": "Yeni Kullanici",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["email"] == "newuser@test.com"
    assert data["role"] == "Researcher"


@pytest.mark.anyio
async def test_register_duplicate_email(client):
    """Aynı e-posta ile ikinci kayıt reddedilmeli."""
    payload = {"email": "dup@test.com", "password": "pass1234", "full_name": "Test"}
    await client.post("/api/auth/register", json=payload)
    resp = await client.post("/api/auth/register", json=payload)
    assert resp.status_code == 400


# ── 3. Giriş ─────────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_login_success(client):
    """Doğru bilgilerle giriş JWT döndürmeli."""
    await client.post("/api/auth/register", json={
        "email": "login@test.com",
        "password": "testpass123",
        "full_name": "Login Test",
    })
    resp = await client.post("/api/auth/login", json={
        "email": "login@test.com",
        "password": "testpass123",
    })
    assert resp.status_code == 200
    assert "access_token" in resp.json()


@pytest.mark.anyio
async def test_login_wrong_password(client):
    """Yanlış şifre 401 döndürmeli."""
    await client.post("/api/auth/register", json={
        "email": "wrong@test.com",
        "password": "correctpass",
        "full_name": "Wrong Test",
    })
    resp = await client.post("/api/auth/login", json={
        "email": "wrong@test.com",
        "password": "wrongpass",
    })
    assert resp.status_code == 401


# ── 4. Token Blacklist ────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_logout_blacklists_token(client, auth_token):
    """Logout sonrası token geçersiz olmalı."""
    headers = {"Authorization": f"Bearer {auth_token}"}

    # Logout
    resp = await client.post("/api/auth/logout", headers=headers)
    assert resp.status_code == 204

    # Aynı token ile istek — 401 bekliyoruz
    resp = await client.get(
        "/api/documents/00000000-0000-0000-0000-000000000000",
        headers=headers
    )
    assert resp.status_code == 401


# ── 5. Yetkisiz Erişim ────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_unauthorized_access(client):
    """Token olmadan korumalı endpoint 403 döndürmeli."""
    resp = await client.get("/api/documents/00000000-0000-0000-0000-000000000000")
    assert resp.status_code == 403


# ── 6. Arama ─────────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_keyword_search(client, auth_token):
    """Keyword arama endpoint'i çalışmalı."""
    headers = {"Authorization": f"Bearer {auth_token}"}
    resp = await client.get("/api/search/keyword?q=test&limit=5", headers=headers)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


@pytest.mark.anyio
async def test_semantic_search(client, auth_token):
    """Semantik arama endpoint'i çalışmalı."""
    headers = {"Authorization": f"Bearer {auth_token}"}
    resp = await client.post("/api/search/semantic", headers=headers, json={
        "query": "yapay zeka",
        "top_k": 5,
    })
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


# ── 7. Global Error Handler ───────────────────────────────────────────────────

@pytest.mark.anyio
async def test_404_handler(client):
    """Olmayan endpoint düzgün hata mesajı döndürmeli."""
    resp = await client.get("/api/olmayan-endpoint")
    assert resp.status_code == 404
    assert "detail" in resp.json()