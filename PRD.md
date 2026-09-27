# PRD: The Assistant

**Owner:** Naufal Rahfi Anugerah
**Date:** 2026-09-27
**Status:** Draft

## Problem

Everyday notes and to-dos end up scattered: a thought in a chat, a reminder in a message to oneself, a plan in a text file. Finding them again takes longer than writing them, so tasks slip and notes go unread. A chat assistant can help think things through, but it forgets what was said and knows nothing about what is already on the list.

The earlier version of The Assistant also ran its model on the owner's machine, which is too heavy to keep loaded while working.

## Users

One person: the owner, daily, for personal notes, tasks, and everyday questions.

## What Is Built

- Chat with an everyday assistant that plans, drafts, summarizes, and answers questions, and that knows the owner's open tasks and recent notes.
- Keep notes: write, edit, search, and delete them.
- Keep tasks: add them with an optional due date, check them off, and delete them.
- Ask the assistant to turn a message into a note or into tasks. It suggests them, and nothing is saved until the owner confirms each one.
- Come back to earlier conversations from a sidebar, rename them, search them, and delete them.
- Dictate a message by voice in a browser that supports speech input.
- Run it from a fresh clone without downloading a model. The model runs in the cloud and the owner supplies one access key.

## What Is Not Built

- **Not a coding tutor.** The assistant helps with everyday work; there are no coding commands, study material, or flashcards.
- **No saving without confirmation.** The assistant never writes a note or a task on its own.
- **No reminders or notifications.** A due date is shown on a task; nothing alerts the owner when it arrives.
- **No sharing, accounts, or sync between machines.** Everything lives in the database on the owner's machine.
- **No attachments.** Notes are text.
- **No local or offline model.**

## Success Measure

- A task asked for in chat is on the task list after one confirmation.
- Asking what is on the list gets the real open tasks back.
- A note or a task written a week ago is found by searching a word in it, even misspelled.
- The first words of a reply appear within a few seconds.

## Constraints

- The model is `gemma4:31b` on Ollama Cloud, chosen in configuration.
- Notes, tasks, and conversations are stored only in the PostgreSQL server on the owner's machine, in a database named `assistant`.
- The access key never reaches the browser.
- The keys and the database password are supplied by the owner by hand and are never read, printed, or committed by anyone else.
- Every write the model suggests needs the owner's confirmation, and each confirmation is recorded.

## Data

- **Read:** the messages, notes, and tasks the owner writes.
- **Sent:** each message, the earlier turns of its conversation, and a summary of open tasks and recent notes go to Ollama Cloud, which runs the model. Dictated audio goes through the browser's own speech service.
- **Written:** conversations, notes, tasks, and a record of each suggestion the owner confirmed, in the local `assistant` database.
- **Personal data:** notes and tasks can hold it, since they are the owner's own. They leave the machine only as context for the model.

## Open Questions

- Should due tasks raise a reminder? Owner to decide.
- Should notes carry tags or folders? Owner to decide after using search for a while.
