import uuid
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Computed,
    Date,
    DateTime,
    ForeignKey,
    Identity,
    Integer,
    String,
    Text,
    UniqueConstraint,
    create_engine,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker

from config import settings

engine = create_engine(
    settings.database_url.get_secret_value(), pool_size=5, max_overflow=5, pool_pre_ping=True
)
SessionLocal = sessionmaker(engine, expire_on_commit=False)

# Who wrote a note or a task: the owner, or the assistant with the owner's confirmation
SOURCE_CHECK = "source IN ('user', 'assistant')"


class Base(DeclarativeBase):
    pass


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Moved forward on every new message, so the sidebar lists the latest conversation first
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    messages: Mapped[list["Message"]] = relationship(order_by="Message.id")
    # Search keys the database computes on write, per search.component.md. Deferred, so a normal
    # read never loads them.
    search_norm: Mapped[str | None] = mapped_column(Text, Computed("norm(title)", persisted=True), deferred=True)
    search_fon: Mapped[str | None] = mapped_column(Text, Computed("fon(title)", persisted=True), deferred=True)


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (CheckConstraint("role IN ('user', 'assistant')", name="messages_role_check"),)

    # A sequence rather than a timestamp orders the turns, since two can share a timestamp
    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    conversation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(16))
    content: Mapped[str] = mapped_column(Text)
    # The model's thinking, for a model that returns it apart from the answer
    reasoning: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Only the fuzzy stage of the search reads a message, so it needs the phonetic key alone
    search_fon: Mapped[str | None] = mapped_column(Text, Computed("fon(content)", persisted=True), deferred=True)


class Note(Base):
    __tablename__ = "notes"
    __table_args__ = (CheckConstraint(SOURCE_CHECK, name="notes_source_check"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(200))
    content: Mapped[str] = mapped_column(Text, server_default="")
    source: Mapped[str] = mapped_column(String(16), server_default="user")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    search_norm: Mapped[str | None] = mapped_column(Text, Computed("norm(title)", persisted=True), deferred=True)
    # The fuzzy stage matches words in the body as well as the title
    search_fon: Mapped[str | None] = mapped_column(
        Text, Computed("fon(title || ' ' || content)", persisted=True), deferred=True
    )


class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = (CheckConstraint(SOURCE_CHECK, name="tasks_source_check"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(300))
    done: Mapped[bool] = mapped_column(Boolean, server_default="false", index=True)
    due_on: Mapped[date | None] = mapped_column(Date)
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    source: Mapped[str] = mapped_column(String(16), server_default="user")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    search_norm: Mapped[str | None] = mapped_column(Text, Computed("norm(title)", persisted=True), deferred=True)
    search_fon: Mapped[str | None] = mapped_column(Text, Computed("fon(title)", persisted=True), deferred=True)


class AppliedAction(Base):
    """The record that the owner confirmed one suggestion in one reply: the audit trail for model writes."""

    __tablename__ = "applied_actions"
    # One confirmation per suggestion, so pressing confirm twice cannot save it twice
    __table_args__ = (
        UniqueConstraint("message_id", "action_index", name="applied_actions_once"),
        CheckConstraint("target_type IN ('note', 'task')", name="applied_actions_target_check"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    message_id: Mapped[int] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"), index=True)
    action_index: Mapped[int] = mapped_column(Integer)
    action_type: Mapped[str] = mapped_column(String(32))
    target_type: Mapped[str] = mapped_column(String(16))
    # Not a foreign key: the note or task may be deleted later, and the record of the write stays
    target_id: Mapped[uuid.UUID]
    applied_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
