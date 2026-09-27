"""create the schema

Conversations, notes, tasks, and the record of confirmed suggestions, with the normalization and
phonetic fold from docs/component/search.component.md, copied without change so search keys match
other projects. The downgrade leaves the two extensions installed, since other schemas may use them.

Revision ID: 0001
Revises: 
Create Date: 2026-09-27 16:26:15.348727

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

IMM_UNACCENT = """
CREATE FUNCTION imm_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS
$$ SELECT public.unaccent('public.unaccent', $1) $$
"""

NORM = """
CREATE FUNCTION norm(t text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$ SELECT btrim(regexp_replace(lower(imm_unaccent(coalesce(t, ''))), '[^a-z0-9]+', ' ', 'g')) $$
"""

FON = r"""
CREATE FUNCTION fon(t text) RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE s text := norm(t);
BEGIN
  s := replace(s, 'oe', 'u');
  s := replace(s, 'sch', 'sk');
  s := replace(s, 'sc', 'sk');
  s := replace(s, 'dj', 'j');
  s := replace(s, 'tj', 'c');
  s := replace(s, 'nj', 'ny');
  s := replace(s, 'sj', 'sy');
  s := replace(s, 'ph', 'f');
  s := replace(s, 'v', 'f');
  s := replace(s, 'th', 't');
  s := replace(s, 'ch', 'k');
  s := replace(s, 'kh', 'k');
  s := replace(s, 'x', 'ks');
  s := replace(s, 'q', 'k');
  s := replace(s, 'z', 's');
  s := regexp_replace(s, '(?<![ns])y', 'i', 'g');
  s := regexp_replace(s, '(.)\1', '\1', 'g');
  RETURN s;
END $$
"""

# revision identifiers, used by Alembic.
revision: str = '0001'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute("CREATE EXTENSION IF NOT EXISTS unaccent")
    op.execute(IMM_UNACCENT)
    op.execute(NORM)
    op.execute(FON)
    op.create_table('conversations',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('title', sa.String(length=120), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('search_norm', sa.Text(), sa.Computed('norm(title)', persisted=True), nullable=True),
    sa.Column('search_fon', sa.Text(), sa.Computed('fon(title)', persisted=True), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_conversations_updated_at'), 'conversations', ['updated_at'], unique=False)
    op.create_table('notes',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('content', sa.Text(), server_default='', nullable=False),
    sa.Column('source', sa.String(length=16), server_default='user', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('search_norm', sa.Text(), sa.Computed('norm(title)', persisted=True), nullable=True),
    sa.Column('search_fon', sa.Text(), sa.Computed("fon(title || ' ' || content)", persisted=True), nullable=True),
    sa.CheckConstraint("source IN ('user', 'assistant')", name='notes_source_check'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_notes_updated_at'), 'notes', ['updated_at'], unique=False)
    op.create_table('tasks',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('title', sa.String(length=300), nullable=False),
    sa.Column('done', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('due_on', sa.Date(), nullable=True),
    sa.Column('done_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('source', sa.String(length=16), server_default='user', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('search_norm', sa.Text(), sa.Computed('norm(title)', persisted=True), nullable=True),
    sa.Column('search_fon', sa.Text(), sa.Computed('fon(title)', persisted=True), nullable=True),
    sa.CheckConstraint("source IN ('user', 'assistant')", name='tasks_source_check'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_tasks_done'), 'tasks', ['done'], unique=False)
    op.create_table('messages',
    sa.Column('id', sa.BigInteger(), sa.Identity(always=False), nullable=False),
    sa.Column('conversation_id', sa.Uuid(), nullable=False),
    sa.Column('role', sa.String(length=16), nullable=False),
    sa.Column('content', sa.Text(), nullable=False),
    sa.Column('reasoning', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('search_fon', sa.Text(), sa.Computed('fon(content)', persisted=True), nullable=True),
    sa.CheckConstraint("role IN ('user', 'assistant')", name='messages_role_check'),
    sa.ForeignKeyConstraint(['conversation_id'], ['conversations.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_messages_conversation_id'), 'messages', ['conversation_id'], unique=False)
    op.create_table('applied_actions',
    sa.Column('id', sa.BigInteger(), sa.Identity(always=False), nullable=False),
    sa.Column('message_id', sa.BigInteger(), nullable=False),
    sa.Column('action_index', sa.Integer(), nullable=False),
    sa.Column('action_type', sa.String(length=32), nullable=False),
    sa.Column('target_type', sa.String(length=16), nullable=False),
    sa.Column('target_id', sa.Uuid(), nullable=False),
    sa.Column('applied_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("target_type IN ('note', 'task')", name='applied_actions_target_check'),
    sa.ForeignKeyConstraint(['message_id'], ['messages.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('message_id', 'action_index', name='applied_actions_once')
    )
    op.create_index(op.f('ix_applied_actions_message_id'), 'applied_actions', ['message_id'], unique=False)

    # The indexes each stage of the search ladder uses: exact and prefix on titles, fuzzy on the
    # phonetic keys
    for table in ("conversations", "notes", "tasks"):
        op.execute(f"CREATE INDEX {table}_search_norm_idx ON {table} (search_norm)")
        op.execute(f"CREATE INDEX {table}_search_pre_idx ON {table} (search_norm text_pattern_ops)")
    for table in ("conversations", "notes", "tasks", "messages"):
        op.execute(f"CREATE INDEX {table}_search_fon_idx ON {table} USING gin (search_fon gin_trgm_ops)")


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_applied_actions_message_id'), table_name='applied_actions')
    op.drop_table('applied_actions')
    op.drop_index(op.f('ix_messages_conversation_id'), table_name='messages')
    op.drop_table('messages')
    op.drop_index(op.f('ix_tasks_done'), table_name='tasks')
    op.drop_table('tasks')
    op.drop_index(op.f('ix_notes_updated_at'), table_name='notes')
    op.drop_table('notes')
    op.drop_index(op.f('ix_conversations_updated_at'), table_name='conversations')
    op.drop_table('conversations')
    op.execute("DROP FUNCTION fon(text)")
    op.execute("DROP FUNCTION norm(text)")
    op.execute("DROP FUNCTION imm_unaccent(text)")
