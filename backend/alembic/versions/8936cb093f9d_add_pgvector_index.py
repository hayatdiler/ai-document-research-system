"""add_pgvector_index

Revision ID: 8936cb093f9d
Revises: 5b663cf928a6
Create Date: 2026-05-17 18:25:35.207102

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8936cb093f9d'
down_revision: Union[str, Sequence[str], None] = '5b663cf928a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # pgvector HNSW index — semantik arama için
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_documents_embedding_hnsw
        ON documents
        USING hnsw (embedding_vector vector_cosine_ops)
        WITH (m = 16, ef_construction = 64);
    """)

    # Keyword arama için full-text index
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_documents_fts
        ON documents
        USING gin(to_tsvector('turkish', COALESCE(title,'') || ' ' || COALESCE(summary,'')));
    """)


def downgrade() -> None:
    op.drop_index('idx_documents_embedding_hnsw', table_name='documents')
    op.drop_index('idx_documents_fts', table_name='documents')
