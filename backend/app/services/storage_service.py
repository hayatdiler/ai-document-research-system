"""MinIO dosya depolama servisi."""
import io
import uuid
from datetime import timedelta

from minio import Minio
from minio.error import S3Error

from app.core.config import settings


def _get_client() -> Minio:
    """Container içi işlemler için — minio:9000"""
    return Minio(
        endpoint=settings.MINIO_ENDPOINT,
        access_key=settings.MINIO_ACCESS_KEY,
        secret_key=settings.MINIO_SECRET_KEY,
        secure=settings.MINIO_SECURE,
    )


def _get_public_client() -> Minio:
    """Presigned URL için — localhost:9000 (tarayıcıdan erişilebilir)"""
    return Minio(
        endpoint="localhost:9000",
        access_key=settings.MINIO_ACCESS_KEY,
        secret_key=settings.MINIO_SECRET_KEY,
        secure=False,
    )


def ensure_bucket_exists() -> None:
    """Uygulama başlangıcında bucket'ın var olduğunu garantiler."""
    client = _get_client()
    if not client.bucket_exists(settings.MINIO_BUCKET_NAME):
        client.make_bucket(settings.MINIO_BUCKET_NAME)


def upload_file(file_data: bytes, filename: str, content_type: str = "application/pdf") -> str:
    client = _get_client()
    object_name = f"{uuid.uuid4()}/{filename}"
    client.put_object(
        bucket_name=settings.MINIO_BUCKET_NAME,
        object_name=object_name,
        data=io.BytesIO(file_data),
        length=len(file_data),
        content_type=content_type,
    )
    return object_name


def get_presigned_url(object_name: str, expires_seconds: int = 3600) -> str:
    from datetime import timedelta
    from minio import Minio

    # Presigned URL localhost ile üret — imza da localhost'a göre hesaplanır
    client = Minio(
        endpoint="host.docker.internal:9000",
        access_key=settings.MINIO_ACCESS_KEY,
        secret_key=settings.MINIO_SECRET_KEY,
        secure=False,
    )
    url = client.presigned_get_object(
        bucket_name=settings.MINIO_BUCKET_NAME,
        object_name=object_name,
        expires=timedelta(seconds=expires_seconds),
    )
    # host.docker.internal → localhost (tarayıcı için)
    url = url.replace("host.docker.internal:9000", "localhost:9000")
    return url

def delete_file(object_name: str) -> None:
    client = _get_client()
    try:
        client.remove_object(settings.MINIO_BUCKET_NAME, object_name)
    except S3Error:
        pass


def download_file(object_name: str) -> bytes:
    client = _get_client()
    response = client.get_object(settings.MINIO_BUCKET_NAME, object_name)
    data = response.read()
    response.close()
    return data