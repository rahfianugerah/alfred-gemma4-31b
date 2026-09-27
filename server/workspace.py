"""Notes and tasks: their routes, and the brief of them the assistant reads with every reply."""

import logging
import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Response
from pydantic import AfterValidator, BaseModel, ConfigDict, Field
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from common import get_session, not_found, rate_limit
from db import Note, Task
from search import page_of

logger = logging.getLogger("assistant")
router = APIRouter(prefix="/api/v1", dependencies=[rate_limit("api")])

Source = Literal["user", "assistant"]


def _trimmed(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("the title is empty")
    return value


NoteTitle = Annotated[str, Field(max_length=200), AfterValidator(_trimmed)]
TaskTitle = Annotated[str, Field(max_length=300), AfterValidator(_trimmed)]


class NoteIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: NoteTitle
    content: str = Field("", max_length=50_000)


class NoteUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: NoteTitle | None = None
    content: str | None = Field(None, max_length=50_000)


class NoteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    content: str
    source: Source
    created_at: datetime
    updated_at: datetime


class NoteListItem(BaseModel):
    id: uuid.UUID
    title: str
    # The start of the body, so the list can show it without sending every note in full
    preview: str
    source: Source
    updated_at: datetime


class NotePage(BaseModel):
    items: list[NoteListItem]
    total: int
    limit: int
    offset: int
    match: Literal["exact", "prefix", "fuzzy"] | None = None


class TaskIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: TaskTitle
    due_on: date | None = None


class TaskUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: TaskTitle | None = None
    # Sent as null to clear the due date, or left out to keep it
    due_on: date | None = None
    done: bool | None = None


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    done: bool
    due_on: date | None
    done_at: datetime | None
    source: Source
    created_at: datetime
    updated_at: datetime


class TaskPage(BaseModel):
    items: list[TaskOut]
    total: int
    limit: int
    offset: int
    match: Literal["exact", "prefix", "fuzzy"] | None = None


def preview(content: str, length: int = 160) -> str:
    flat = " ".join(content.split())
    return flat if len(flat) <= length else f"{flat[: length - 3].rstrip()}..."


def create_note(session: Session, title: str, content: str, source: Source) -> Note:
    note = Note(title=title, content=content, source=source)
    session.add(note)
    session.flush()
    return note


def create_task(session: Session, title: str, due_on: date | None, source: Source) -> Task:
    task = Task(title=title, due_on=due_on, source=source)
    session.add(task)
    session.flush()
    return task


def set_done(task: Task, done: bool) -> None:
    task.done = done
    task.done_at = func.now() if done else None
    task.updated_at = func.now()


def workspace_brief(session: Session, today: date | None = None) -> str:
    """Today's date, the open tasks with their ids, and the latest notes, for the assistant to
    read. Bounded, so a long list cannot crowd the conversation out of the model's context."""
    today = today or date.today()
    tasks = session.scalars(
        select(Task).where(Task.done.is_(False)).order_by(Task.due_on.asc().nulls_last(), Task.created_at).limit(40)
    ).all()
    notes = session.scalars(select(Note).order_by(Note.updated_at.desc()).limit(15)).all()
    lines = [f"Today is {today:%A, %d %B %Y} ({today.isoformat()}).", "", "Open tasks:"]
    lines += [f"- [{t.id}] {t.title}" + (f" (due {t.due_on.isoformat()})" if t.due_on else "") for t in tasks] or ["- none"]
    lines += ["", "Recent notes:"]
    lines += [f"- {n.title}: {preview(n.content)}" for n in notes] or ["- none"]
    return "\n".join(lines)


@router.get("/notes", response_model=NotePage)
def list_notes(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    q: str | None = Query(None, max_length=200, description="Words from a title or a note's body"),
    session: Session = Depends(get_session),
):
    page = page_of(session, select(Note), Note, [Note.updated_at.desc()], limit, offset, q)
    page["items"] = [
        NoteListItem(id=n.id, title=n.title, preview=preview(n.content), source=n.source, updated_at=n.updated_at)
        for n in page["items"]
    ]
    return page


@router.post("/notes", response_model=NoteOut, status_code=201)
def add_note(body: NoteIn, session: Session = Depends(get_session)):
    note = create_note(session, body.title, body.content, "user")
    session.commit()
    return note


@router.get("/notes/{note_id}", response_model=NoteOut)
def get_note(note_id: uuid.UUID, session: Session = Depends(get_session)):
    return session.get(Note, note_id) or not_found("note")


@router.patch("/notes/{note_id}", response_model=NoteOut)
def update_note(note_id: uuid.UUID, body: NoteUpdate, session: Session = Depends(get_session)):
    note = session.get(Note, note_id)
    if note is None:
        return not_found("note")
    for field in body.model_fields_set:
        if getattr(body, field) is not None:
            setattr(note, field, getattr(body, field))
    note.updated_at = func.now()
    session.commit()
    session.refresh(note)
    return note


@router.delete("/notes/{note_id}", status_code=204)
def delete_note(note_id: uuid.UUID, session: Session = Depends(get_session)):
    deleted = session.execute(delete(Note).where(Note.id == note_id))
    session.commit()
    if deleted.rowcount == 0:
        return not_found("note")
    logger.info("Deleted note %s", note_id)
    return Response(status_code=204)


@router.get("/tasks", response_model=TaskPage)
def list_tasks(
    status: Literal["open", "done", "all"] = "open",
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    q: str | None = Query(None, max_length=200, description="Words from a task's title"),
    session: Session = Depends(get_session),
):
    base = select(Task)
    if status != "all":
        base = base.where(Task.done.is_(status == "done"))
    # Open tasks by due date with undated ones last, finished ones latest first
    order = {
        "open": [Task.due_on.asc().nulls_last(), Task.created_at],
        "done": [Task.done_at.desc()],
        "all": [Task.done, Task.due_on.asc().nulls_last(), Task.created_at],
    }[status]
    return page_of(session, base, Task, order, limit, offset, q)


@router.post("/tasks", response_model=TaskOut, status_code=201)
def add_task(body: TaskIn, session: Session = Depends(get_session)):
    task = create_task(session, body.title, body.due_on, "user")
    session.commit()
    session.refresh(task)
    return task


@router.patch("/tasks/{task_id}", response_model=TaskOut)
def update_task(task_id: uuid.UUID, body: TaskUpdate, session: Session = Depends(get_session)):
    task = session.get(Task, task_id)
    if task is None:
        return not_found("task")
    if body.title is not None:
        task.title = body.title
    if "due_on" in body.model_fields_set:
        task.due_on = body.due_on
    if body.done is not None and body.done != task.done:
        set_done(task, body.done)
    task.updated_at = func.now()
    session.commit()
    session.refresh(task)
    return task


@router.delete("/tasks/{task_id}", status_code=204)
def delete_task(task_id: uuid.UUID, session: Session = Depends(get_session)):
    deleted = session.execute(delete(Task).where(Task.id == task_id))
    session.commit()
    if deleted.rowcount == 0:
        return not_found("task")
    logger.info("Deleted task %s", task_id)
    return Response(status_code=204)
