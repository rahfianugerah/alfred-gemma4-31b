import json
import os
import uuid
from types import SimpleNamespace
from typing import ClassVar

import pytest

# Settings are read at import time. The key is a stand-in and the model client is replaced in
# every test that sends a message, so nothing here reaches Ollama Cloud. DATABASE_URL comes from
# the environment, and every test deletes what it creates.
os.environ["OLLAMA_API_KEY"] = "test-key"
os.environ["OLLAMA_MODEL"] = "test-model"

import common
import main
from actions import parse_actions
from config import Settings
from fastapi.testclient import TestClient
from ollama import ResponseError
from pydantic import ValidationError

api = TestClient(main.app)


@pytest.fixture(autouse=True)
def fresh_limits(monkeypatch):
    # Every test starts with empty counts, so the suite never trips its own rate limit
    monkeypatch.setattr(common, "LIMITS", {"model": common.RateLimiter(20), "api": common.RateLimiter(240)})


def chunk(content: str = "", thinking: str | None = None) -> SimpleNamespace:
    return SimpleNamespace(message=SimpleNamespace(content=content, thinking=thinking))


class FakeModel:
    """Stands in for the Ollama client, failing lazily on the first chunk as the real one does."""

    sent: ClassVar[list[dict[str, str]]] = []

    def __init__(self, chunks=(), error: Exception | None = None):
        self.chunks, self.error = chunks, error

    def chat(self, messages, **_):
        FakeModel.sent = messages

        def stream():
            if self.error:
                raise self.error
            yield from self.chunks

        return stream()


@pytest.fixture
def created():
    """Collects what a test creates, and deletes it afterwards."""
    paths: list[str] = []
    yield paths
    for path in paths:
        api.delete(path)


@pytest.fixture
def conversation_id(created):
    response = api.post("/api/v1/conversations")
    assert response.status_code == 201
    created.append(f"/api/v1/conversations/{response.json()['id']}")
    return response.json()["id"]


def send(conversation_id: str, content: str):
    return api.post(f"/api/v1/conversations/{conversation_id}/messages", json={"content": content})


def add_task(created, title: str, due_on: str | None = None) -> dict:
    task = api.post("/api/v1/tasks", json={"title": title, "due_on": due_on}).json()
    created.append(f"/api/v1/tasks/{task['id']}")
    return task


def add_note(created, title: str, content: str = "") -> dict:
    note = api.post("/api/v1/notes", json={"title": title, "content": content}).json()
    created.append(f"/api/v1/notes/{note['id']}")
    return note


def test_the_modelfile_drives_the_persona_and_the_model_comes_from_the_environment():
    assert main.MODEL == "test-model"
    assert "You are The Assistant" in main.SYSTEM_PROMPT
    assert main.OPTIONS["temperature"] == 0.6


def test_a_reply_is_streamed_saved_and_sees_the_workspace(monkeypatch, conversation_id, created):
    add_task(created, "Zqbuy oat milk", "2030-01-02")
    add_note(created, "Zqtrip ideas", "Lombok in May")
    monkeypatch.setattr(main, "model_client", FakeModel([chunk(thinking="Plan"), chunk("Hel"), chunk("lo")]))

    response = send(conversation_id, "What is on my list?")
    assert [json.loads(line) for line in response.text.splitlines()] == [
        {"reasoning": "Plan"},
        {"content": "Hel"},
        {"content": "lo"},
    ]
    system = FakeModel.sent[0]["content"]
    assert "<workspace>" in system and "Zqbuy oat milk (due 2030-01-02)" in system
    assert "Zqtrip ideas: Lombok in May" in system

    saved = api.get(f"/api/v1/conversations/{conversation_id}").json()
    assert saved["title"] == "What is on my list?"
    assert [(m["role"], m["content"]) for m in saved["messages"]] == [
        ("user", "What is on my list?"),
        ("assistant", "Hello"),
    ]


@pytest.mark.parametrize("command", ["note", "task"])
def test_the_note_and_task_commands_carry_their_instruction(monkeypatch, conversation_id, command):
    monkeypatch.setattr(main, "model_client", FakeModel([chunk("ok")]))
    send(conversation_id, f"/{command} Call the dentist tomorrow")
    assert FakeModel.sent[-1]["content"] == f"{main.TASK_PROMPTS[command]}\n\nCall the dentist tomorrow"


def test_a_failed_model_call_saves_nothing(monkeypatch, conversation_id):
    monkeypatch.setattr(main, "model_client", FakeModel(error=ResponseError("unauthorized", 401)))
    response = send(conversation_id, "Hello")
    assert response.status_code == 502
    assert response.json()["error"]["detail"] == {"upstream_status": 401}
    assert api.get(f"/api/v1/conversations/{conversation_id}").json()["messages"] == []


def test_notes_can_be_written_edited_searched_and_deleted(created):
    note = add_note(created, "  Zqgrocery plan  ", "Eggs, spinach, and zqquinoa")
    assert note["title"] == "Zqgrocery plan" and note["source"] == "user"

    edited = api.patch(f"/api/v1/notes/{note['id']}", json={"content": "Eggs and rice"}).json()
    assert edited["content"] == "Eggs and rice" and edited["title"] == "Zqgrocery plan"

    page = api.get("/api/v1/notes", params={"q": "zqgrocery", "limit": 100}).json()
    assert page["match"] == "prefix"
    assert [i["preview"] for i in page["items"] if i["id"] == note["id"]] == ["Eggs and rice"]
    assert note["id"] in [i["id"] for i in api.get("/api/v1/notes", params={"q": "zqgrocary"}).json()["items"]]

    assert api.delete(f"/api/v1/notes/{note['id']}").status_code == 204
    assert api.get(f"/api/v1/notes/{note['id']}").json()["error"]["code"] == "NOTE_NOT_FOUND"


def test_tasks_can_be_checked_off_and_their_due_date_cleared(created):
    task = add_task(created, "Zqrenew passport", "2030-03-01")
    assert task["done"] is False and task["due_on"] == "2030-03-01"

    done = api.patch(f"/api/v1/tasks/{task['id']}", json={"done": True}).json()
    assert done["done"] is True and done["done_at"] is not None
    assert task["id"] in [t["id"] for t in api.get("/api/v1/tasks", params={"status": "done", "limit": 100}).json()["items"]]
    assert task["id"] not in [t["id"] for t in api.get("/api/v1/tasks", params={"limit": 100}).json()["items"]]

    reopened = api.patch(f"/api/v1/tasks/{task['id']}", json={"done": False, "due_on": None}).json()
    assert reopened["done"] is False and reopened["done_at"] is None and reopened["due_on"] is None


@pytest.mark.parametrize(("path", "body"), [("/api/v1/tasks", {"title": "   "}), ("/api/v1/notes", {"title": "x", "extra": 1})])
def test_a_bad_note_or_task_is_rejected(path, body):
    response = api.post(path, json=body)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_FAILED"


def test_an_invalid_action_block_keeps_its_place():
    reply = '```action\n{"type": "create_task", "title": "A"}\n```\n```action\nnot json\n```\n```action\n{"type": "create_note", "title": "B"}\n```'
    actions = parse_actions(reply)
    assert [a.type if a else None for a in actions] == ["create_task", None, "create_note"]


def test_a_suggestion_is_saved_once_and_only_when_confirmed(monkeypatch, conversation_id, created):
    task = add_task(created, "Zqpay the electricity bill")
    reply = (
        '```action\n{"type": "create_task", "title": "Zqcall the dentist", "due": "2030-01-05"}\n```\n'
        "```action\nbroken\n```\n"
        '```action\n{"type": "create_note", "title": "Zqdentist", "content": "Ask about the filling"}\n```\n'
        f'```action\n{{"type": "complete_task", "task_id": "{task["id"]}"}}\n```\n'
        f'```action\n{{"type": "complete_task", "task_id": "{uuid.uuid4()}"}}\n```\n'
        "I suggested a task and a note; they are saved once you confirm."
    )
    monkeypatch.setattr(main, "model_client", FakeModel([chunk(reply)]))
    send(conversation_id, "Remind me about the dentist")

    message = api.get(f"/api/v1/conversations/{conversation_id}").json()["messages"][-1]
    cards = message["actions"]
    # The broken block and the task that does not exist show no card, and the rest keep their index
    assert [(c["index"], c["type"], c["title"], c["applied"]) for c in cards] == [
        (0, "create_task", "Zqcall the dentist", False),
        (2, "create_note", "Zqdentist", False),
        (3, "complete_task", "Zqpay the electricity bill", False),
    ]
    assert [t for t in api.get("/api/v1/tasks", params={"q": "zqcall the dentist"}).json()["items"]] == []

    applied = api.post(f"/api/v1/messages/{message['id']}/applied-actions", json={"index": 0})
    assert applied.status_code == 201
    new_task = api.get("/api/v1/tasks", params={"q": "zqcall the dentist"}).json()["items"][0]
    created.append(f"/api/v1/tasks/{new_task['id']}")
    assert new_task["source"] == "assistant" and new_task["due_on"] == "2030-01-05"
    assert applied.json()["target_id"] == new_task["id"]

    again = api.post(f"/api/v1/messages/{message['id']}/applied-actions", json={"index": 0})
    assert again.status_code == 409 and again.json()["error"]["code"] == "ACTION_ALREADY_APPLIED"
    assert api.post(f"/api/v1/messages/{message['id']}/applied-actions", json={"index": 1}).status_code == 404

    note = api.post(f"/api/v1/messages/{message['id']}/applied-actions", json={"index": 2}).json()
    created.append(f"/api/v1/notes/{note['target_id']}")
    assert api.get(f"/api/v1/notes/{note['target_id']}").json()["content"] == "Ask about the filling"

    api.post(f"/api/v1/messages/{message['id']}/applied-actions", json={"index": 3})
    assert api.get("/api/v1/tasks", params={"q": "zqpay the electricity bill", "status": "done"}).json()["items"][0]["done"]

    cards = api.get(f"/api/v1/conversations/{conversation_id}").json()["messages"][-1]["actions"]
    assert [c["applied"] for c in cards] == [True, True, True]


def test_conversations_are_searched_through_their_messages(monkeypatch, conversation_id):
    monkeypatch.setattr(main, "model_client", FakeModel([chunk("Zqphotosynthesis turns light into sugar")]))
    send(conversation_id, "Tell me something")
    page = api.get("/api/v1/conversations", params={"q": "zqfotosynthesis", "limit": 100}).json()
    assert page["match"] == "fuzzy"
    assert conversation_id in [c["id"] for c in page["items"]]


def test_replies_are_rate_limited(monkeypatch, conversation_id):
    monkeypatch.setattr(main, "model_client", FakeModel([chunk("Hi")]))
    monkeypatch.setattr(common, "LIMITS", {"model": common.RateLimiter(1), "api": common.RateLimiter(240)})
    assert send(conversation_id, "First").status_code == 200
    response = send(conversation_id, "Second")
    assert response.status_code == 429 and int(response.headers["Retry-After"]) > 0


@pytest.mark.parametrize(
    "overrides",
    [
        {"database_url": "postgresql+psycopg://user:secret@db.example.com:5432/assistant"},
        {"ollama_api_key": "your_ollama_api_key_here"},
        {"ollama_model": ""},
    ],
)
def test_settings_refuse_a_remote_database_a_placeholder_key_and_no_model(overrides):
    with pytest.raises(ValidationError):
        Settings(**overrides)
