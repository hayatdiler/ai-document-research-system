"""Temel API testleri."""
import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app


@pytest.mark.asyncio
async def test_health_check():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_register_and_login():
    """Kayıt ve giriş akışını test eder."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Kayıt
        resp = await client.post("/api/auth/register", json={
            "email": "test@example.com",
            "password": "testpass123",
            "full_name": "Test Kullanıcı",
        })
        assert resp.status_code == 201

        # Giriş
        resp = await client.post("/api/auth/login", json={
            "email": "test@example.com",
            "password": "testpass123",
        })
        assert resp.status_code == 200
        assert "access_token" in resp.json()


@pytest.mark.asyncio
async def test_unauthorized_access():
    """Token olmadan belge erişimi reddedilmeli."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/api/documents/00000000-0000-0000-0000-000000000000")
    assert resp.status_code == 403
