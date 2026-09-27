import assert from "node:assert/strict";
import { test } from "node:test";
import { dueLabel, formatDate, groupOf, isoDate, parseIsoDate, plainPreview, stripActions } from "./workspace.ts";

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
  assert.equal(dueLabel("2026-10-20", today), "20 Oct 2026");
});

test("a calendar date keeps its day in every time zone", () => {
  assert.equal(formatDate("2027-01-05"), "05 Jan 2027");
  assert.deepEqual(parseIsoDate("2026-02-28"), { year: 2026, month: 1, day: 28 });
  assert.equal(parseIsoDate("2026-02-30"), null);
  assert.equal(parseIsoDate("0000-13-01"), null);
  assert.equal(parseIsoDate("28/02/2026"), null);
  assert.equal(isoDate(2026, 11, 32), "2027-01-01");
  assert.equal(isoDate(2026, 2, 0), "2026-02-28");
});
