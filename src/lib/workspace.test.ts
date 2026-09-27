import assert from "node:assert/strict";
import { test } from "node:test";
import { dueLabel, groupOf, plainPreview, stripActions } from "./workspace.ts";

test("suggestion blocks are cut out of a reply, finished or not", () => {
  const block = '```action\n{"type": "create_task", "title": "Call Sam"}\n```';
  assert.equal(stripActions(`${block}\n\n\n\nI suggested a task.`), "I suggested a task.");
  assert.equal(stripActions('Sure.\n```action\n{"type": "create_no'), "Sure.");
  assert.equal(stripActions("Sure.\n```"), "Sure.");
  assert.equal(stripActions("```python\nprint(1)\n```"), "```python\nprint(1)\n```");
});

test("a preview reads as plain text", () => {
  assert.equal(
    plainPreview("## Ask about - The **filling** on the left - [Clinic](https://example.com) hours"),
    "Ask about · The filling on the left · Clinic hours",
  );
  assert.equal(plainPreview("1. Eggs\n2. `Rice`"), "Eggs · Rice");
});

test("a task's group and due label follow today's date", () => {
  const today = "2026-09-27";
  assert.equal(groupOf({ done: false, due_on: "2026-09-26" }, today), "Overdue");
  assert.equal(groupOf({ done: false, due_on: today }, today), "Today");
  assert.equal(groupOf({ done: false, due_on: null }, today), "No Date");
  assert.equal(groupOf({ done: true, due_on: "2026-09-01" }, today), "Done");
  assert.equal(dueLabel("2026-09-28", today), "Tomorrow");
  assert.equal(dueLabel("2026-10-01", today), "Thursday");
  assert.equal(dueLabel("2026-10-20", today), "Oct 20");
  assert.equal(dueLabel("2027-01-05", today), "Jan 5, 2027");
});
