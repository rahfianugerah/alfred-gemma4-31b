import itertools
import json
import logging
import math
import re
import sys
import uuid
from datetime import date, datetime
from typing import Literal

import httpx
from fastapi import Depends, FastAPI, Query, Request, Response
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from ollama import Client, ResponseError
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.exceptions import HTTPException

from actions import CompleteTask, CreateNote, CreateTask, parse_actions
from common import RateLimited, error_response, get_session, not_found, rate_limit
from config import ROOT, settings
from db import AppliedAction, Conversation, Message, SessionLocal, Task
from search import page_of
from workspace import create_note, create_task, router as workspace_router, set_done, workspace_brief

# uvicorn configures only its own loggers, so without this the audit lines at INFO are dropped
logging.basicConfig(level=logging.INFO, stream=sys.stdout, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("assistant")


def load_modelfile(text: str) -> tuple[str, dict[str, object]]:
    """Read the system prompt and the sampling options out of an Ollama Modelfile."""
    system = re.search(r'^SYSTEM\s+"""(.*?)"""', text, re.M | re.S).group(1).strip()
    options: dict[str, object] = {}
    for name, raw in re.findall(r"^PARAMETER\s+(\w+)\s+(.+?)\s*$", text, re.M):
        value = json.loads(raw)  # a number and a quoted string both parse as JSON
        if name == "stop":
            options.setdefault("stop", []).append(value)
        else:
            options[name] = value
    return system, options


# The model comes from OLLAMA_MODEL, so each machine picks its own. The Modelfile stays the one
# place the prompt and sampling are tuned; Ollama Cloud accepts every parameter per request.
MODEL = settings.ollama_model
SYSTEM_PROMPT, OPTIONS = load_modelfile((ROOT / "Modelfile").read_text(encoding="utf-8"))

model_client = Client(
    host="https://ollama.com",
    headers={"Authorization": f"Bearer {settings.ollama_api_key.get_secret_value()}"},
    timeout=300,
)

NEW_CHAT_TITLE = "New Chat"

# A message starting with /note or /task asks for that kind of suggestion; the Note and Task
# buttons under the box add the command. Anything else is an ordinary message.
TASK_PROMPTS: dict[str, str] = {
    "general": "",
    "note": "Write what the owner describes up as one clear note, and suggest saving it with a single create_note action block.",
    "task": (
        "Turn what the owner describes into concrete tasks and suggest each with its own create_task action block, "
        "with a due date whenever one is stated or implied."
    ),
}

COMMAND = re.compile(r"^/(\w+)\b\s*")


def split_command(content: str) -> tuple[str, str]:
    """Split a leading slash command off a message. An unknown one, such as /etc/hosts, is text."""
    match = COMMAND.match(content)
    if match and match.group(1) in TASK_PROMPTS:
        return match.group(1), content[match.end() :]
    return "general", content


class MessageIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Stored as typed, command included, so a reopened conversation shows which one was used
    content: str = Field(max_length=32_000)

    @field_validator("content")
    @classmethod
    def not_blank(cls, value: str) -> str:
        if not split_command(value)[1].strip():
            raise ValueError("the message is empty")
        return value


class ActionOut(BaseModel):
    """A suggestion in a reply, as the website shows it on a card."""

    index: int
    type: Literal["create_task", "create_note", "complete_task"]
    title: str
    due: date | None = None
    content: str | None = None
    task_id: uuid.UUID | None = None
    applied: bool
    # The note or task it saved, once the owner confirmed it
    target_id: uuid.UUID | None = None


class MessageOut(BaseModel):
    id: int
    role: str
    content: str
    reasoning: str | None
    created_at: datetime
    actions: list[ActionOut] = []


class ConversationRename(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(max_length=120)

    @field_validator("title")
    @classmethod
    def trimmed_and_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("the title is empty")
        return value


class ConversationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    created_at: datetime
    updated_at: datetime


class ConversationDetail(ConversationOut):
    messages: list[MessageOut]


class ConversationPage(BaseModel):
    items: list[ConversationOut]
    total: int
    limit: int
    offset: int
    # Which stage of the search ladder answered, so the website can say when matches are only close
    match: Literal["exact", "prefix", "fuzzy"] | None = None


class ApplyIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    index: int = Field(ge=0, le=50)


class AppliedOut(BaseModel):
    index: int
    type: str
    target_type: Literal["note", "task"]
    target_id: uuid.UUID


def describe_actions(session: Session, messages: list[Message]) -> dict[int, list[ActionOut]]:
    """The valid suggestions in each reply, marked with whether the owner already saved them."""
    replies = [m for m in messages if m.role == "assistant"]
    if not replies:
        return {}
    applied = {
        (a.message_id, a.action_index): a
        for a in session.scalars(select(AppliedAction).where(AppliedAction.message_id.in_([m.id for m in replies])))
    }
    parsed = {m.id: parse_actions(m.content) for m in replies}
    task_ids = {a.task_id for actions in parsed.values() for a in actions if isinstance(a, CompleteTask)}
    task_titles = dict(session.execute(select(Task.id, Task.title).where(Task.id.in_(task_ids))).all()) if task_ids else {}

    cards: dict[int, list[ActionOut]] = {}
    for message in replies:
        for index, action in enumerate(parsed[message.id]):
            if action is None:
                continue
            if isinstance(action, CompleteTask):
                # A task that no longer exists cannot be marked done, so its card is not shown
                if action.task_id not in task_titles:
                    continue
                title = task_titles[action.task_id]
            else:
                title = action.title
            record = applied.get((message.id, index))
            cards.setdefault(message.id, []).append(
                ActionOut(
                    index=index,
                    type=action.type,
                    title=title,
                    due=getattr(action, "due", None),
                    content=getattr(action, "content", None),
                    task_id=getattr(action, "task_id", None),
                    applied=record is not None,
                    target_id=record.target_id if record else None,
                )
            )
    return cards


def build_messages(session: Session, history: list[Message], content: str) -> list[dict[str, str]]:
    """The system prompt with the owner's workspace, the history, and the new message.

    Earlier messages go without their commands, since only the latest one applies.
    """
    task, question = split_command(content)
    instruction = TASK_PROMPTS[task]
    system = f"{SYSTEM_PROMPT}\n\n<workspace>\n{workspace_brief(session)}\n</workspace>"
    return [
        {"role": "system", "content": system},
        *(
            {"role": m.role, "content": split_command(m.content)[1] if m.role == "user" else m.content}
            for m in history
        ),
        {"role": "user", "content": f"{instruction}\n\n{question}" if instruction else question},
    ]


def save_reply(conversation_id: uuid.UUID, content: str, reasoning: str | None) -> None:
    if not content:
        return
    with SessionLocal() as session:
        session.add(Message(conversation_id=conversation_id, role="assistant", content=content, reasoning=reasoning))
        session.execute(update(Conversation).where(Conversation.id == conversation_id).values(updated_at=func.now()))
        session.commit()


def in_a_message(key):
    """The fuzzy search reaches into a conversation's messages as well as its title."""
    match = (
        select(Message.id).where(Message.conversation_id == Conversation.id, key.op("<%")(Message.search_fon)).exists()
    )
    best = (
        select(func.max(func.word_similarity(key, Message.search_fon)))
        .where(Message.conversation_id == Conversation.id)
        .scalar_subquery()
    )
    return match, best


app = FastAPI(title="Alfred", docs_url="/api/v1/docs", openapi_url="/api/v1/openapi.json", redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.cors_origins.split(",")],
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type"],
)
app.include_router(workspace_router)


@app.exception_handler(RequestValidationError)
async def validation_failed(_: Request, exc: RequestValidationError) -> JSONResponse:
    return error_response(422, "VALIDATION_FAILED", "The request could not be processed", jsonable_encoder(exc.errors()))


@app.exception_handler(RateLimited)
async def rate_limited(_: Request, exc: RateLimited) -> JSONResponse:
    seconds = math.ceil(exc.retry_after)
    response = error_response(
        429,
        "RATE_LIMITED",
        f"Too many requests. Try again in {seconds} seconds",
        {"retry_after": seconds, "limit_per_minute": exc.limit},
    )
    response.headers["Retry-After"] = str(seconds)
    response.headers["X-RateLimit-Limit"] = str(exc.limit)
    response.headers["X-RateLimit-Remaining"] = "0"
    return response


@app.exception_handler(HTTPException)
async def http_failed(_: Request, exc: HTTPException) -> JSONResponse:
    return error_response(exc.status_code, "HTTP_ERROR", str(exc.detail))


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "model": MODEL}


@app.get("/api/v1/conversations", response_model=ConversationPage, dependencies=[rate_limit("api")])
def list_conversations(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    q: str | None = Query(None, max_length=200, description="Words from a title or a message"),
    session: Session = Depends(get_session),
):
    order = [Conversation.updated_at.desc()]
    return page_of(session, select(Conversation), Conversation, order, limit, offset, q, also_fuzzy=in_a_message)


@app.post("/api/v1/conversations", response_model=ConversationOut, status_code=201, dependencies=[rate_limit("api")])
def create_conversation(session: Session = Depends(get_session)):
    conversation = Conversation(title=NEW_CHAT_TITLE)
    session.add(conversation)
    session.commit()
    return conversation


@app.get("/api/v1/conversations/{conversation_id}", response_model=ConversationDetail, dependencies=[rate_limit("api")])
def get_conversation(conversation_id: uuid.UUID, session: Session = Depends(get_session)):
    conversation = session.get(Conversation, conversation_id)
    if conversation is None:
        return not_found("conversation")
    cards = describe_actions(session, conversation.messages)
    return {
        **ConversationOut.model_validate(conversation).model_dump(),
        "messages": [
            {
                "id": m.id,
                "role": m.role,
                "content": m.content,
                "reasoning": m.reasoning,
                "created_at": m.created_at,
                "actions": cards.get(m.id, []),
            }
            for m in conversation.messages
        ],
    }


@app.patch("/api/v1/conversations/{conversation_id}", response_model=ConversationOut, dependencies=[rate_limit("api")])
def rename_conversation(conversation_id: uuid.UUID, body: ConversationRename, session: Session = Depends(get_session)):
    conversation = session.get(Conversation, conversation_id)
    if conversation is None:
        return not_found("conversation")
    conversation.title = body.title
    session.commit()
    return conversation


@app.delete("/api/v1/conversations/{conversation_id}", status_code=204, dependencies=[rate_limit("api")])
def delete_conversation(conversation_id: uuid.UUID, session: Session = Depends(get_session)):
    deleted = session.execute(delete(Conversation).where(Conversation.id == conversation_id))
    session.commit()
    if deleted.rowcount == 0:
        return not_found("conversation")
    logger.info("Deleted conversation %s and its messages", conversation_id)
    return Response(status_code=204)


@app.post("/api/v1/conversations/{conversation_id}/messages", dependencies=[rate_limit("model")])
def create_message(conversation_id: uuid.UUID, body: MessageIn, session: Session = Depends(get_session)):
    """Stream the reply as NDJSON, one {"reasoning"}, {"content"}, or {"error"} object per line."""
    conversation = session.get(Conversation, conversation_id)
    if conversation is None:
        return not_found("conversation")

    prompt = build_messages(session, conversation.messages, body.content)
    stream = model_client.chat(model=MODEL, messages=prompt, options=OPTIONS, stream=True)
    try:
        # The client sends the request lazily, so the first chunk is read here, where a failure
        # can still be answered with a real status instead of a broken stream
        first = next(stream)
    except (ResponseError, httpx.HTTPError, StopIteration) as error:
        logger.warning("Model request failed: %s", error)
        return error_response(
            502,
            "MODEL_UNAVAILABLE",
            "The model could not answer. Try again shortly",
            {"upstream_status": getattr(error, "status_code", None)},
        )

    # The question is saved only once the model has started answering, so a failed request
    # leaves nothing behind. A title the owner already set is kept.
    if not conversation.messages and conversation.title == NEW_CHAT_TITLE:
        conversation.title = split_command(body.content)[1].strip().splitlines()[0][:80]
    conversation.updated_at = func.now()
    session.add(Message(conversation_id=conversation.id, role="user", content=body.content))
    session.commit()

    def events():
        content: list[str] = []
        reasoning: list[str] = []
        try:
            for chunk in itertools.chain([first], stream):
                if chunk.message.thinking:
                    reasoning.append(chunk.message.thinking)
                    yield json.dumps({"reasoning": chunk.message.thinking}) + "\n"
                if chunk.message.content:
                    content.append(chunk.message.content)
                    yield json.dumps({"content": chunk.message.content}) + "\n"
        except Exception:
            logger.exception("Model stream was interrupted")
            error = {"code": "STREAM_INTERRUPTED", "message": "The reply was interrupted. Try again"}
            yield json.dumps({"error": error}) + "\n"
        finally:
            # Also runs when the owner stops the reply, so a partial answer is kept, not lost
            save_reply(conversation_id, "".join(content), "".join(reasoning) or None)

    return StreamingResponse(events(), media_type="application/x-ndjson")


@app.post(
    "/api/v1/messages/{message_id}/applied-actions",
    response_model=AppliedOut,
    status_code=201,
    dependencies=[rate_limit("api")],
)
def apply_action(message_id: int, body: ApplyIn, session: Session = Depends(get_session)):
    """Save one suggestion from a reply, because the owner confirmed it. The suggestion is read
    again from the stored reply, so the website can only confirm what the model actually wrote."""
    message = session.get(Message, message_id)
    if message is None or message.role != "assistant":
        return not_found("message")
    actions = parse_actions(message.content)
    action = actions[body.index] if body.index < len(actions) else None
    if action is None:
        return not_found("action")
    already = select(AppliedAction.id).where(
        AppliedAction.message_id == message_id, AppliedAction.action_index == body.index
    )
    if session.scalar(already):
        return error_response(409, "ACTION_ALREADY_APPLIED", "This suggestion was already saved")

    if isinstance(action, CreateTask):
        target, target_type = create_task(session, action.title, action.due, "assistant"), "task"
    elif isinstance(action, CreateNote):
        target, target_type = create_note(session, action.title, action.content, "assistant"), "note"
    else:
        target, target_type = session.get(Task, action.task_id), "task"
        if target is None:
            return not_found("task")
        set_done(target, True)

    session.add(
        AppliedAction(
            message_id=message_id,
            action_index=body.index,
            action_type=action.type,
            target_type=target_type,
            target_id=target.id,
        )
    )
    try:
        session.commit()
    except IntegrityError:
        # Two confirmations raced; the unique constraint let exactly one through
        session.rollback()
        return error_response(409, "ACTION_ALREADY_APPLIED", "This suggestion was already saved")
    logger.info("Owner confirmed %s %d of message %d: %s %s", action.type, body.index, message_id, target_type, target.id)
    return {"index": body.index, "type": action.type, "target_type": target_type, "target_id": target.id}
