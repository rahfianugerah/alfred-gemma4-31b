# The Assistant API

The API behind The Assistant website. It keeps conversations, notes, and tasks in the local PostgreSQL database and streams each reply from Ollama Cloud, **so the Ollama key never reaches the browser**.

## Table of Contents

1. [API Overview](#1-api-overview)
2. [Base Configuration](#2-base-configuration)
3. [Authentication and Authorization](#3-authentication-and-authorization)
4. [Request Standards](#4-request-standards)
5. [Response Standards](#5-response-standards)
6. [Endpoint Reference](#6-endpoint-reference)
7. [Error Handling](#7-error-handling)
8. [Pagination, Filtering, and Sorting](#8-pagination-filtering-and-sorting)
9. [Rate Limiting and Security](#9-rate-limiting-and-security)
10. [Testing and Versioning](#10-testing-and-versioning)
11. [Known Limitations](#known-limitations)

## 1. API Overview

One caller, The Assistant website on the same machine. It manages notes and tasks, keeps saved conversations, and sends a message whose reply streams back while it is written. With every message the model also reads a brief of the owner's open tasks and latest notes. **The model can only suggest a note or a task; the owner saves a suggestion with a separate request.** The model comes from `OLLAMA_MODEL` and the system prompt and sampling from `Modelfile`, never from the request.

## 2. Base Configuration

| Item | Value |
| :- | :- |
| Base URL | `http://127.0.0.1:8200` |
| Base path | `api/v1` |
| Protocol | HTTP, on the loopback interface only |
| Content type | `application/json`, and `application/x-ndjson` for a streamed reply |
| Character encoding | UTF-8 |
| Versioning method | In the path, `api/v1` |

**Every route is `api/v1/<route>`, and `/health` is the only route outside that prefix.** The OpenAPI page is at `api/v1/docs` and the schema at `api/v1/openapi.json`.

### General Request Flow

```text
Website > CORS > Rate limit > Router > Validation > PostgreSQL and Ollama Cloud > Response
```

## 3. Authentication and Authorization

### Authentication Method

<code style="color: red">Not Used</code>

There is one user on one machine, and the API listens on `127.0.0.1` only.

### Public and Protected Endpoints

| Endpoint | Access |
| :- | :- |
| `/health` | Public |
| Everything else | Public on the loopback interface |

## 4. Request Standards

### Request Headers

| Header | Required | Description |
| :- | :- | :- |
| `Content-Type` | Yes, on a body | `application/json` |

### Path Parameters

| Parameter | Type | Required | Description |
| :- | :- | :- | :- |
| `conversation_id` | UUID | Yes | The conversation, as returned when it was created |
| `message_id` | Integer | Yes | A reply, as listed in its conversation |
| `note_id` | UUID | Yes | The note |
| `task_id` | UUID | Yes | The task |

### Query Parameters

| Parameter | Type | Required | Default | Description |
| :- | :- | :- | :- | :- |
| `limit` | Integer | No | `20` | Items per page, 1 to 100 |
| `offset` | Integer | No | `0` | Items to skip |
| `q` | String | No | None | Words to search for, at most 200 characters. Fewer than 2 letters or digits leaves the list unfiltered |
| `status` | String | No | `open` | Tasks only: `open`, `done`, or `all` |

### Request Body Format

```json
{
  "title": "Call the dentist",
  "due_on": "2026-09-28"
}
```

### Data Types

| Type | Format |
| :- | :- |
| String | UTF-8 |
| Number | JSON number, not a quoted string |
| Boolean | JSON `true` or `false` |
| Date | ISO 8601 date, `YYYY-MM-DD` |
| Date and time | ISO 8601 with an explicit offset |
| Identifier | UUID for a conversation, a note, and a task; integer for a message |

### Date and Time Format

```text
2026-09-27T14:30:00.123456+07:00
```

### Validation Rules

A body is checked by a typed model that **rejects an unexpected field**. Titles are trimmed and must not be blank. A validation failure returns `422`.

## 5. Response Standards

### Success Response

The resource is the body, with no envelope.

```json
{
  "id": "5d1f0c2e-8a44-4f5b-9e0c-7b1a2d3c4e5f",
  "title": "Call the dentist",
  "done": false,
  "due_on": "2026-09-28",
  "done_at": null,
  "source": "assistant",
  "created_at": "2026-09-27T14:30:00.123456+07:00",
  "updated_at": "2026-09-27T14:30:00.123456+07:00"
}
```

`source` is `user` for a note or task the owner wrote, and `assistant` for one saved from a suggestion.

### List Response

```json
{
  "items": [],
  "total": 0,
  "limit": 20,
  "offset": 0,
  "match": null
}
```

`match` says which stage of the search answered: `exact`, `prefix`, or `fuzzy`, or `null` when no search ran. A `fuzzy` match may not contain the words searched for, so the website says the results are close matches.

### Error Response

```json
{
  "error": {
    "code": "TASK_NOT_FOUND",
    "message": "Task does not exist",
    "detail": null
  }
}
```

### Standard Status Codes

| Status | Name | Usage |
| :- | :- | :- |
| `200` | OK | Successful read or update, or a reply stream that has started |
| `201` | Created | Conversation, note, or task created, or a suggestion saved |
| `204` | No Content | Conversation, note, or task deleted |
| `404` | Not Found | The resource does not exist, or the route does not |
| `409` | Conflict | The suggestion was already saved |
| `422` | Unprocessable Entity | Validation failure |
| `429` | Too Many Requests | The client passed its rate limit |
| `502` | Bad Gateway | Ollama Cloud refused or failed the request |

### Null and Empty Values

A missing value is `null`, never an empty string. `reasoning` is `null` on every user message and on a reply from a model that returns none. `due_on` is `null` for a task with no date, and `done_at` for an open task. A note with no body has `"content": ""`, and a reply with no suggestions has `"actions": []`.

### Sensitive Data

No response carries the Ollama key, the database URL, or a stack trace.

## 6. Endpoint Reference

| Method | Path | Purpose | Auth |
| :- | :- | :- | :- |
| `GET` | `/health` | Liveness check, and the model in use | No |
| `GET` | `api/v1/conversations` | List conversations, latest first | No |
| `POST` | `api/v1/conversations` | Create an empty conversation | No |
| `GET` | `api/v1/conversations/{conversation_id}` | Read a conversation, its messages, and their suggestions | No |
| `PATCH` | `api/v1/conversations/{conversation_id}` | Rename a conversation | No |
| `DELETE` | `api/v1/conversations/{conversation_id}` | Delete a conversation and its messages | No |
| `POST` | `api/v1/conversations/{conversation_id}/messages` | Send a message and stream the reply | No |
| `POST` | `api/v1/messages/{message_id}/applied-actions` | Save one suggestion from a reply | No |
| `GET` | `api/v1/notes` | List notes, latest edit first | No |
| `POST` | `api/v1/notes` | Create a note | No |
| `GET` | `api/v1/notes/{note_id}` | Read a note | No |
| `PATCH` | `api/v1/notes/{note_id}` | Change a note's title or body | No |
| `DELETE` | `api/v1/notes/{note_id}` | Delete a note | No |
| `GET` | `api/v1/tasks` | List tasks | No |
| `POST` | `api/v1/tasks` | Create a task | No |
| `PATCH` | `api/v1/tasks/{task_id}` | Rename a task, change its date, or check it off | No |
| `DELETE` | `api/v1/tasks/{task_id}` | Delete a task | No |

### Health

#### `GET /health`

Reports that the API is up and which model `OLLAMA_MODEL` names.

```json
{ "status": "ok", "model": "gemma4:31b" }
```

### Conversations

#### `GET api/v1/conversations/{conversation_id}`

Returns the conversation with its messages, oldest first. Each reply carries the suggestions it holds, read from its text:

```json
{
  "id": 42,
  "role": "assistant",
  "content": "```action\n{\"type\": \"create_task\", \"title\": \"Call the dentist\", \"due\": \"2026-09-28\"}\n```\nI suggested a task; it is saved once you confirm.",
  "reasoning": null,
  "created_at": "2026-09-27T14:31:12.004511+07:00",
  "actions": [
    {
      "index": 0,
      "type": "create_task",
      "title": "Call the dentist",
      "due": "2026-09-28",
      "content": null,
      "task_id": null,
      "applied": false,
      "target_id": null
    }
  ]
}
```

| Field | Type | Description |
| :- | :- | :- |
| `index` | integer | The block's place among the reply's suggestion blocks, counting ones that could not be read |
| `type` | string | `create_task`, `create_note`, or `complete_task` |
| `title` | string | The new task or note, or the title of the task to finish |
| `due` | date | The new task's due date, if any |
| `content` | string | The new note's body |
| `task_id` | UUID | The task to finish |
| `applied` | boolean | Whether the owner already saved it |
| `target_id` | UUID | The note or task it created or finished, once saved |

A block that is not valid JSON of one of the three types is left out, and so is a `complete_task` whose task no longer exists; the others keep their `index`.

#### `PATCH api/v1/conversations/{conversation_id}`

Renames a conversation and returns it. The title is trimmed; a conversation renamed before its first question keeps that title instead of taking one from the question.

| Field | Type | Required | Validation | Description |
| :- | :- | :- | :- | :- |
| `title` | string | Yes | 1 to 120 characters after trimming | The new name |

Error responses: `422` `VALIDATION_FAILED` for a blank or over-long title, and `404` `CONVERSATION_NOT_FOUND`.

#### `POST api/v1/conversations/{conversation_id}/messages`

Saves the question, sends it to Ollama Cloud with the conversation's earlier turns and the owner's workspace, and streams the reply. The reply is saved when the stream ends, or when the caller disconnects, keeping whatever had arrived.

| Item | Value |
| :- | :- |
| Authentication | Not required |
| Required role | Not applicable |
| Idempotent | No |

Request body:

| Field | Type | Required | Validation | Description |
| :- | :- | :- | :- | :- |
| `content` | string | Yes | At most 32,000 characters, not blank after the command | The message as typed. A leading `/general`, `/note`, or `/task` says what to send back. Any other leading word is plain text |

Example request:

```bash
curl -N -X POST "http://127.0.0.1:8200/api/v1/conversations/0b7c1e2a-4d1f-4f7e-9a53-2f0c8d1b6e44/messages" \
  -H "Content-Type: application/json" \
  -d '{ "content": "/task Pay the rent on Friday" }'
```

Success response, `200`, one JSON object per line:

```text
{"content": "```action\n{\"type\": \"create_task\", "}
{"content": "\"title\": \"Pay the rent\", \"due\": \"2026-10-02\"}\n```\n"}
{"content": "I suggested a task; it is saved once you confirm."}
```

| Field | Type | Description |
| :- | :- | :- |
| `reasoning` | string | A piece of the model's thinking, for a model that returns it |
| `content` | string | A piece of the answer |
| `error` | object | `{"code": "STREAM_INTERRUPTED", "message": ...}`, sent once if the stream breaks after it started |

Error responses:

| Status | Code | When |
| :- | :- | :- |
| `422` | `VALIDATION_FAILED` | `content` is missing, too long, blank, or only a command |
| `404` | `CONVERSATION_NOT_FOUND` | The conversation does not exist |
| `502` | `MODEL_UNAVAILABLE` | Ollama Cloud refused or failed before the first piece; `detail.upstream_status` carries its status, such as `401` for a wrong key |

Notes:

**Nothing is saved when the request fails with `502`**, so the same question can be sent again. The workspace the model reads holds today's date, up to 40 open tasks with their ids, and the latest 15 notes cut to 160 characters. **A suggestion is only text in the reply until it is saved with the next endpoint.** Read the finished reply again from the conversation to get its `actions`. The conversation's title is set from the first question, without its command, cut at 80 characters.

### Suggestions

#### `POST api/v1/messages/{message_id}/applied-actions`

Saves one suggestion from a reply, because the owner confirmed it. **The suggestion is read again from the stored reply**, so a caller can only save what the model actually wrote. A `create_task` or `create_note` creates it with `source` `assistant`; a `complete_task` checks the task off.

| Field | Type | Required | Validation | Description |
| :- | :- | :- | :- | :- |
| `index` | integer | Yes | 0 to 50 | The suggestion's `index` |

```bash
curl -X POST "http://127.0.0.1:8200/api/v1/messages/42/applied-actions" \
  -H "Content-Type: application/json" \
  -d '{ "index": 0 }'
```

Success response, `201`:

```json
{
  "index": 0,
  "type": "create_task",
  "target_type": "task",
  "target_id": "5d1f0c2e-8a44-4f5b-9e0c-7b1a2d3c4e5f"
}
```

Error responses:

| Status | Code | When |
| :- | :- | :- |
| `404` | `MESSAGE_NOT_FOUND` | The message does not exist or is not a reply |
| `404` | `ACTION_NOT_FOUND` | The reply has no readable suggestion at that index |
| `404` | `TASK_NOT_FOUND` | The task to finish was deleted |
| `409` | `ACTION_ALREADY_APPLIED` | This suggestion was saved before, including by a request racing this one |
| `422` | `VALIDATION_FAILED` | `index` is missing or out of range |

### Notes

#### `GET api/v1/notes`

Lists notes, the latest edited first. Each item carries a `preview`, the start of the body on one line, instead of the whole body.

```json
{
  "items": [
    {
      "id": "8c0e4b1a-2f3d-4e5f-a6b7-c8d9e0f1a2b3",
      "title": "Dentist questions",
      "preview": "## Ask about - The filling on the left side - Whitening options",
      "source": "assistant",
      "updated_at": "2026-09-27T14:40:02.511224+07:00"
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0,
  "match": null
}
```

#### `POST api/v1/notes` and `PATCH api/v1/notes/{note_id}`

| Field | Type | Required | Validation | Description |
| :- | :- | :- | :- | :- |
| `title` | string | Yes to create | 1 to 200 characters after trimming | The note's title |
| `content` | string | No | At most 50,000 characters | The body, in Markdown. Defaults to empty |

A `PATCH` changes only the fields it sends. Both return the whole note, with `201` on create. Error responses: `422` `VALIDATION_FAILED`, and `404` `NOTE_NOT_FOUND` on a note that does not exist.

### Tasks

#### `GET api/v1/tasks`

Lists tasks by `status`. Open tasks come by due date, with undated ones last; done tasks come latest finished first; `all` lists open before done.

#### `POST api/v1/tasks` and `PATCH api/v1/tasks/{task_id}`

| Field | Type | Required | Validation | Description |
| :- | :- | :- | :- | :- |
| `title` | string | Yes to create | 1 to 300 characters after trimming | The task |
| `due_on` | date or `null` | No | `YYYY-MM-DD` | The due date. On a `PATCH`, `null` removes it and leaving it out keeps it |
| `done` | boolean | No, `PATCH` only | | Checks the task off, setting `done_at`, or opens it again, clearing it |

```bash
curl -X PATCH "http://127.0.0.1:8200/api/v1/tasks/5d1f0c2e-8a44-4f5b-9e0c-7b1a2d3c4e5f" \
  -H "Content-Type: application/json" \
  -d '{ "done": true }'
```

Both return the whole task, with `201` on create. Error responses: `422` `VALIDATION_FAILED`, and `404` `TASK_NOT_FOUND` on a task that does not exist.

## 7. Error Handling

### Error Categories

| Category | Status | Description |
| :- | :- | :- |
| Validation | `422` | Invalid input |
| Not found | `404` | The resource or the route does not exist |
| Conflict | `409` | The suggestion was already saved |
| Rate limit | `429` | Too many requests in the last minute |
| Upstream | `502` | Ollama Cloud could not answer |

### Error Code Convention

`[RESOURCE]_[CONDITION]`, in screaming snake case, stable once published.

```text
VALIDATION_FAILED
CONVERSATION_NOT_FOUND
MESSAGE_NOT_FOUND
ACTION_NOT_FOUND
NOTE_NOT_FOUND
TASK_NOT_FOUND
ACTION_ALREADY_APPLIED
MODEL_UNAVAILABLE
RATE_LIMITED
STREAM_INTERRUPTED
HTTP_ERROR
```

`HTTP_ERROR` covers a route or method that does not exist.

### Validation Error Example

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "The request could not be processed",
    "detail": [
      { "type": "value_error", "loc": ["body", "title"], "msg": "Value error, the title is empty" }
    ]
  }
}
```

### Retry Guidance

| Status | Retry |
| :- | :- |
| `429` | Yes, after the seconds in `Retry-After`; nothing was saved |
| `502` | Yes, after a moment; nothing was saved |
| `409` | No; the suggestion is already saved |
| `4xx` | No; the request is wrong and will stay wrong |

## 8. Pagination, Filtering, and Sorting

### Pagination

Conversations, notes, and tasks are listed in pages.

| Parameter | Default | Maximum |
| :- | :- | :- |
| `limit` | 20 | 100 |
| `offset` | 0 | none |

### Search

`q` runs the ladder from the search standard, and the first stage that finds anything answers:

| Stage | Matches | Conversations | Notes | Tasks |
| :- | :- | :- | :- | :- |
| Exact | The whole title, normalized | Title | Title | Title |
| Prefix | The start of the title, normalized | Title | Title | Title |
| Fuzzy | A similar word, with a word similarity of at least 0.3 after the phonetic fold | Title and every message | Title and body | Title |

Normalizing lowercases, strips accents, and turns punctuation into spaces. The query is cut at 100 characters and runs under a 3 second statement timeout. A search sorts by its own stage, latest first for exact and prefix and closest first for fuzzy.

### Filtering

Tasks filter by `status`: `open`, `done`, or `all`. Nothing else filters.

### Sorting

Fixed per list: conversations by latest activity, notes by latest edit, tasks as described under `GET api/v1/tasks`.

## 9. Rate Limiting and Security

### Rate Limit

Each client, by address, has its own sliding one-minute window per group:

| Endpoint group | Limit | Window |
| :- | :- | :- |
| `POST api/v1/conversations/{conversation_id}/messages`, which calls the model | 20 | per minute |
| Every other `api/v1` route | 240 | per minute |
| `/health` | None | |

A request past its limit is refused with `429` `RATE_LIMITED` before anything is saved or sent to the model. The counts live in the API's memory, so they reset when it restarts. Ollama Cloud's own usage limit still applies on top, and a request past it returns `502`.

### Rate Limit Headers

Sent with a `429`:

```http
Retry-After: 53
X-RateLimit-Limit: 20
X-RateLimit-Remaining: 0
```

### Security Controls

| Control | Implementation |
| :- | :- |
| Transport | Loopback only when started with `--host 127.0.0.1`, as the README shows |
| Input validation | Typed model at the boundary, unexpected fields rejected |
| Injection | ORM queries only |
| Model output | A suggestion is saved only on the owner's request, re-read from the stored reply and validated again; the workspace brief is marked as information, never instructions |
| Secrets | Never in a response, a log, or an error; settings errors hide their inputs |
| Database | Refuses to start unless `DATABASE_URL` points at this machine |
| Audit | Every deleted conversation, note, and task, and every saved suggestion, is logged with its id |

### CORS

| Item | Value |
| :- | :- |
| Allowed origins | `CORS_ORIGINS`, by default `http://localhost:3200` and `http://127.0.0.1:3200` |
| Allowed methods | `GET`, `POST`, `PATCH`, `DELETE` |
| Credentials | `false` |

### Request Size Limits

| Item | Limit |
| :- | :- |
| Message content | 32,000 characters |
| Note body | 50,000 characters |
| Note title | 200 characters |
| Task title | 300 characters |

## 10. Testing and Versioning

### Testing

| Item | Value |
| :- | :- |
| Tools | pytest with FastAPI's test client |
| Automated tests | `server/test_main.py` |
| Test environment | The local `assistant` database; the model client is replaced, so Ollama Cloud is never called |

```bash
pytest server
```

### Version History

| Version | Released | Notes |
| :- | :- | :- |
| `v1` | 2026-09-27 | Conversations, streamed replies, notes, tasks, and suggestions saved on confirmation |

### Deprecation Policy

None yet. There is one caller, released together with the API.

### Breaking Changes

**A breaking change ships as `api/v2`, mounted alongside `v1`.**

## Known Limitations

- **Every earlier turn is resent with each message, with the workspace brief.** A long conversation eventually passes the Modelfile's `num_ctx` of 16384 tokens, and the model then loses the oldest turns or the request fails.
- **The workspace brief is bounded.** The model sees at most 40 open tasks and 15 notes, each note cut to 160 characters, so it cannot finish a task or quote a note outside that.
- **A reply cannot be resumed.** If the caller disconnects, the partial reply is saved and the stream is not restarted.
- **Lists are capped at 100 per page.** Page through them with `offset`.
