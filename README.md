# The Assistant

![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.141-009688?logo=fastapi&logoColor=white)
![Next](https://img.shields.io/badge/Next-16-000000?logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-4169E1?logo=postgresql&logoColor=white)
![Ollama Cloud](https://img.shields.io/badge/Ollama_Cloud-gemma4:31b-000000?logo=ollama&logoColor=white)
![Status](https://img.shields.io/badge/Status-Active-2EA043)
![License](https://img.shields.io/badge/License-MIT-750014)

The Assistant is an everyday assistant in the browser that keeps your notes and tasks. It answers with `gemma4:31b` on Ollama Cloud, and keeps every conversation, note, and task in PostgreSQL on this machine. **No model is downloaded or run locally.**

It exists so planning a day, drafting a message, and keeping a to-do list happen in one place, with an assistant that already knows what is on the list. The assistant suggests notes and tasks; **nothing is saved until you confirm it.** The product intent is in [PRD.md](PRD.md) and the endpoints are in [API.md](API.md).

## Table of Contents

1. [Setup](#setup)
2. [Usage](#usage)
3. [Configuration](#configuration)
4. [Data](#data)
5. [Project Structure](#project-structure)
6. [Development](#development)
7. [Known Limitations](#known-limitations)
8. [License](#license)

## Setup

On the owner's machine the `assistant` database is created and migrated and `npm install` has run, so only steps 1 and 2 remain. A fresh clone runs every step.

**1. Backend environment.** The `ai-project` conda environment, with Python 3.12.

```bash
conda activate ai-project
pip install -r requirements.txt
```

**Run every backend command below inside the activated `ai-project` environment.** Outside it, `pip` installs into a different interpreter and PowerShell answers `The term 'uvicorn' is not recognized`.

**2. Configuration.** Copy the template and fill it in by hand.

```bash
cp .env.example .env
```

Set `OLLAMA_API_KEY` to a key from ollama.com under Settings > Keys, keep `OLLAMA_MODEL` at `gemma4:31b`, and put the local PostgreSQL password into `DATABASE_URL`. **The server refuses to start while `OLLAMA_API_KEY` still holds its placeholder, while `OLLAMA_MODEL` is unset, or while `DATABASE_URL` points anywhere but `127.0.0.1`, `localhost`, or `::1`.** That is deliberate: the model is chosen per machine and never falls back to one written in the code, and your notes may only live in the PostgreSQL server on this machine.

**3. Database.** Create the `assistant` database on the local server, then build the tables.

```bash
psql -h 127.0.0.1 -U postgres -c "CREATE DATABASE assistant"
alembic -c server/alembic.ini upgrade head
```

**The migration reads the same settings as the server, so step 2 has to come first.** With `OLLAMA_API_KEY` unset, it stops with `Field required` before touching the database.

**4. Frontend.**

```bash
npm install
```

## Usage

Start the API, then the website, each in its own terminal from the repository root.

```bash
conda activate ai-project
uvicorn main:app --app-dir server --host 127.0.0.1 --port 8200 --reload
```

```bash
npm run dev
```

Open `http://localhost:3200`. The sidebar switches between **Chat**, **Notes**, and **Tasks**, and lists your past chats below them.

### Chat

Ask anything: plan the day, draft a message, sum up your notes. **With every message the assistant reads today's date, your open tasks, and your latest notes**, so "what is due this week?" gets a real answer. The reply streams in, and the model's reasoning sits behind **Show Reasoning** when the model returns one.

**When a note or a task would help, the reply ends with suggestion cards.** Each card shows what would be saved: a new task with its due date, a new note with its first lines, or an open task to mark done. Press **Add Task**, **Save Note**, or **Mark Done** to save one, or **Save All** for every card in the reply. A saved card says **Saved** and its **Open** button takes you to the note or the task list. A card can be saved once; reopening the chat shows which ones already were.

Start a message with a command to say what you want back. Type `/` in the box, or press the `/` button, to pick one from the menu.

| Command | Does |
| :- | :- |
| `/general` | Just talks, with no suggestion asked for. The default when no command is given |
| `/note` | Turns what you say into one note to save |
| `/task` | Turns what you say into tasks to save, each with a due date when one is stated or implied |

**The Note and Task buttons under the box add the command for you.** Press one, describe the note or the tasks, and send. An unknown command, such as `/etc/hosts`, is sent as plain text. On an empty chat, a suggestion such as **Plan my day** fills the box with a starting question.

**Press the microphone to dictate** instead of typing; pressing it again stops. It appears only in a browser with speech input, such as Chrome, Edge, or Safari.

**Search your chats from the box under New Chat.** It matches the start of a title first, then similar words anywhere in a title or a message, so a misspelled word still finds the chat; results that are only similar are labelled Close Matches. Rename a chat by clicking its name above the chat, by double-clicking it in the sidebar, or from the menu beside it.

### Notes

The list sits beside the open note; on a phone they take turns. Press **+** for a new note and type its title. **A note saves itself a moment after you stop typing**, and the bar above it says Edited, Saving, or Saved. Notes are Markdown: **Preview** shows it formatted, and **Edit** or a double click goes back to typing. The bar also copies the note or deletes it after asking. A note saved from the chat says **From chat**. The search box finds a note by its title, or by similar words in its title or body.

### Tasks

Type a task, optionally pick a due date, and press **+**. Open tasks are grouped into **Overdue**, **Today**, **Upcoming**, and **No Date**, and the filter switches between Open, Done, and All. **Click the circle to check a task off**, click its title to rename it, and click its date, or **Add date** on hover, to pick one in the browser's date picker, whose Clear button removes it. The bin deletes a task at once.

## Configuration

Every variable the project reads. Names only; see `.env.example`.

| Variable | Required | Description |
| :- | :- | :- |
| `OLLAMA_API_KEY` | Yes | The Ollama Cloud key the API sends with every model request. Never reaches the browser |
| `OLLAMA_MODEL` | Yes | The model Ollama Cloud runs. This project uses `gemma4:31b`. No default |
| `DATABASE_URL` | Yes | The local PostgreSQL connection, `postgresql+psycopg://...@127.0.0.1:5432/assistant` |
| `CORS_ORIGINS` | No | Comma-separated browser origins allowed to call the API. Defaults to the website on port 3200 |
| `NEXT_PUBLIC_ASSISTANT_URL` | No | The API origin the website calls, built into the page. Defaults to `http://127.0.0.1:8200` |

**The model is chosen in `.env`; the system prompt and sampling live in `Modelfile`.** To switch model, set `OLLAMA_MODEL` to another model Ollama Cloud serves and restart the API; the list is at `https://ollama.com/search?c=cloud`. The API reads `SYSTEM` and every `PARAMETER` from the Modelfile at startup and sends them with each request.

## Data

**Conversations, notes, and tasks are stored in PostgreSQL on this machine and are never committed.**

| Item | Location | Notes |
| :- | :- | :- |
| Conversations and messages | Local PostgreSQL, database `assistant` | Deleting a chat in the sidebar removes its messages too |
| Notes and tasks | Local PostgreSQL, database `assistant` | Each records whether you wrote it or saved it from the chat |
| Saved suggestions | Local PostgreSQL, database `assistant` | Which card of which reply was saved, and what it created |
| Secrets | `.env` | Gitignored. Only `.env.example` is committed |
| Python environment | The `ai-project` conda environment | Outside the repository. Managed with conda by the owner |
| Frontend build | `.next/`, `out/` | Gitignored. Produced by `npm run dev` and `npm run build` |

**Every message is sent to Ollama Cloud together with the earlier turns, your open tasks, and the start of your latest notes.** Dictation goes through the browser's own speech service, which in Chrome and Edge sends the audio to Google or Microsoft; The Assistant keeps no audio. Keep passwords and card numbers out of notes and messages.

## Project Structure

```text
Modelfile                 the system prompt, the suggestion format, and the sampling, read by the API
server/
  main.py                 chat routes, commands, the Ollama Cloud stream, and saving a suggestion
  workspace.py            the notes and tasks routes, and the brief of them the model reads
  actions.py              reads the suggestion blocks out of a reply
  search.py               the exact, prefix, and fuzzy search shared by every list
  common.py               the database session, the error shape, and the rate limits
  config.py               settings, with the local-only database check
  db.py                   the tables
  migrations/             Alembic migrations
  test_main.py            the API tests
public/
  the-assistant-logo.png  the logo
src/
  app/                    the one page, its layout, the favicon, and the black and white theme
  components/             the chat, the sidebar, the suggestion cards, the notes and tasks views, and the title editor
  components/ui/          shadcn and prompt-kit components, owned and edited here
  lib/                    the API client, the product name and commands, and the date and preview helpers
```

## Development

```bash
pytest server        # in ai-project; needs the local assistant database, and each test deletes what it creates
npm test             # the reply, preview, and due date helpers, with Node's built-in test runner
npm run lint
npm run build        # static site in out/
```

The branch shape is trunk: `main` only. The browser tab shows the product name alone on every view.

## Known Limitations

- **The assistant sees a summary, not everything.** Each message carries up to 40 open tasks and the latest 15 notes, each note cut to its first 160 characters. Ask about an older note, or open it, to work with its full text.
- **Long conversations run into the model's context window.** Every earlier turn and the summary are sent again with each message, and `num_ctx` in the Modelfile is 16384 tokens. Start a new chat for a new topic.
- **A suggestion depends on the model writing it correctly.** A block the API cannot read shows no card, and a card to finish a task that has since been deleted is not shown.
- **Lists show their latest 100 items.** That covers the chats in the sidebar, the notes list, and each task filter. Older ones stay in the database.
- **A note saves 0.6 seconds after typing stops.** Switching notes or views saves at once, but closing the tab in that moment loses the last keystrokes.
- **Deleting a task has no undo.** A note asks before it is deleted; a task does not.
- **There are no reminders.** A due date sorts and labels a task; nothing notifies you.
- **A stopped reply keeps what had arrived.** Pressing stop saves the partial answer, and a reply stopped before any text arrived saves nothing.
- **Reasoning appears only for a model that returns it.** A model without thinking shows no Show Reasoning block.
- **The Assistant limits how fast it can be asked.** Sending a message is limited to 20 a minute and everything else to 240, so a stuck loop cannot spend the Ollama usage limit. Past it, a banner says how many seconds to wait. The counts live in the API's memory and reset when it restarts.
- **Ollama Cloud usage limits apply.** A request past the limit, or with a wrong key, fails with a "model could not answer" banner, and the question goes back into the box.
- **There is no sign-in.** Anyone who can reach port 8200 can read and change your notes and tasks and spend the Ollama quota. The API is bound to `127.0.0.1` for that reason.
- **The tests use the real local database.** They create and delete their own records and leave the rest alone.
- **There are no scrollbars.** Everything still scrolls by wheel, touch, and keyboard, but nothing shows that it can.

## License

MIT. See [LICENSE](LICENSE).
