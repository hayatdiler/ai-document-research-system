"""initial_tables

Revision ID: 5b663cf928a6
Revises:
Create Date: 2026-05-16 01:59:40.839102

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '5b663cf928a6'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.execute("CREATE TYPE userrole    AS ENUM ('ADMIN', 'RESEARCHER', 'VIEWER')")
    op.execute("CREATE TYPE filetype    AS ENUM ('PDF', 'TXT')")
    op.execute("CREATE TYPE llmjobtype  AS ENUM ('SUMMARIZE', 'EXTRACT', 'EMBED', 'COLLECTION_REPORT')")
    op.execute("CREATE TYPE jobstatus   AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED')")
    op.execute("CREATE TYPE readingstatus AS ENUM ('Unread', 'Reading', 'Read', 'Reviewed')")

    op.create_table(
        'users',
        sa.Column('user_id',        postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('email',          sa.String(255), nullable=False),
        sa.Column('password_hash',  sa.String(255), nullable=True),
        sa.Column('full_name',      sa.String(255), nullable=False),
        sa.Column('role',           sa.Enum(name='userrole',   create_type=False), nullable=False, server_default='RESEARCHER'),
        sa.Column('oauth_provider', sa.String(50),  nullable=True),
        sa.Column('is_active',      sa.Boolean(),   nullable=False, server_default='true'),
        sa.Column('created_at',     sa.DateTime(timezone=True), server_default=sa.text('now()')),
    )
    op.create_index('ix_users_email', 'users', ['email'], unique=True)

    op.create_table(
        'documents',
        sa.Column('doc_id',       postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('owner_id',     postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('users.user_id', ondelete='CASCADE'), nullable=False),
        sa.Column('title',        sa.String(512),  nullable=False),
        sa.Column('file_path',    sa.String(1024), nullable=False),
        sa.Column('file_type',    sa.Enum(name='filetype',      create_type=False), nullable=False),
        sa.Column('upload_date',  sa.DateTime(timezone=True), server_default=sa.text('now()')),
        sa.Column('summary',      sa.Text(),  nullable=True),
        sa.Column('keywords',     postgresql.ARRAY(sa.String()), nullable=True),
        sa.Column('citation_data', sa.JSON(), nullable=True),
        sa.Column('reading_status', sa.Enum(name='readingstatus', create_type=False),
                  nullable=False, server_default='Unread'),
    )
    op.execute("ALTER TABLE documents ADD COLUMN embedding_vector vector(384)")

    op.create_table(
        'collections',
        sa.Column('collection_id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('name',          sa.String(255), nullable=False),
        sa.Column('description',   sa.Text(),      nullable=True),
        sa.Column('owner_id',      postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('users.user_id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_at',    sa.DateTime(timezone=True), server_default=sa.text('now()')),
    )

    op.create_table(
        'collection_documents',
        sa.Column('collection_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('collections.collection_id', ondelete='CASCADE'), primary_key=True),
        sa.Column('doc_id',        postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('documents.doc_id', ondelete='CASCADE'), primary_key=True),
    )

    op.create_table(
        'annotations',
        sa.Column('annotation_id',  postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('doc_id',         postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('documents.doc_id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id',        postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('users.user_id', ondelete='CASCADE'), nullable=False),
        sa.Column('selected_text',  sa.Text(),    nullable=False),
        sa.Column('page_number',    sa.Integer(), nullable=True),
        sa.Column('color',          sa.String(7), nullable=False, server_default="'#FFFF00'"),
        sa.Column('created_at',     sa.DateTime(timezone=True), server_default=sa.text('now()')),
    )

    op.create_table(
        'comments',
        sa.Column('comment_id',        postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('annotation_id',     postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('annotations.annotation_id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id',           postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('users.user_id', ondelete='CASCADE'), nullable=False),
        sa.Column('content',           sa.Text(), nullable=False),
        sa.Column('parent_comment_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('comments.comment_id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at',        sa.DateTime(timezone=True), server_default=sa.text('now()')),
    )

    op.create_table(
        'llm_jobs',
        sa.Column('job_id',    postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('doc_id',    postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('documents.doc_id', ondelete='CASCADE'), nullable=False),
        sa.Column('job_type',  sa.Enum(name='llmjobtype', create_type=False), nullable=False),
        sa.Column('status',    sa.Enum(name='jobstatus',  create_type=False), nullable=False, server_default='PENDING'),
        sa.Column('result',    sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
    )

    op.create_table(
        'collection_shares',
        sa.Column('share_id',       postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('collection_id',  postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('collections.collection_id', ondelete='CASCADE'), nullable=False),
        sa.Column('token',          sa.String(32),  nullable=False),
        sa.Column('created_by',     postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('users.user_id'), nullable=False),
        sa.Column('is_active',      sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('expires_at',     sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at',     sa.DateTime(timezone=True), server_default=sa.text('now()')),
    )
    op.create_index('ix_collection_shares_token', 'collection_shares', ['token'], unique=True)

    op.create_table(
        'collection_reports',
        sa.Column('report_id',      postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('collection_id',  postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('collections.collection_id', ondelete='CASCADE'), nullable=False),
        sa.Column('generated_by',   postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('users.user_id'), nullable=False),
        sa.Column('file_path',      sa.String(1024), nullable=True),
        sa.Column('report_text',    sa.Text(),        nullable=True),
        sa.Column('status',         sa.Enum(name='jobstatus', create_type=False),
                  nullable=False, server_default='PENDING'),
        sa.Column('created_at',     sa.DateTime(timezone=True), server_default=sa.text('now()')),
    )


def downgrade() -> None:
    op.drop_table('collection_reports')
    op.drop_index('ix_collection_shares_token', table_name='collection_shares')
    op.drop_table('collection_shares')
    op.drop_table('llm_jobs')
    op.drop_table('comments')
    op.drop_table('annotations')
    op.drop_table('collection_documents')
    op.drop_table('collections')
    op.drop_table('documents')
    op.drop_index('ix_users_email', table_name='users')
    op.drop_table('users')

    op.execute("DROP TYPE IF EXISTS readingstatus")
    op.execute("DROP TYPE IF EXISTS jobstatus")
    op.execute("DROP TYPE IF EXISTS llmjobtype")
    op.execute("DROP TYPE IF EXISTS filetype")
    op.execute("DROP TYPE IF EXISTS userrole")
