// Helpers for replies, notes, and tasks, kept free of React so `npm test` can run them in Node

// A suggestion block, finished or still being written, read the way server/actions.py reads it
const ACTION_BLOCK = /```action[ \t]*\r?\n[\s\S]*?(?:```|$)/g;
/** A reply without its suggestion blocks, which are shown as cards instead. */
export function stripActions(reply: string): string {
  let text = reply.replace(ACTION_BLOCK, "");
  // An opening fence whose language is still arriving would flash an empty code block, and may
  // yet turn out to be a suggestion. An odd count means the last fence opens a block.
  if ((text.match(/```/g)?.length ?? 0) % 2) text = text.replace(/`{3}[a-z]*$/, "");
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

/** A note's Markdown as one line of plain text, for a preview: no heading marks, bullets, or emphasis. */
export function plainPreview(markdown: string): string {
  return markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(^|\s)#{1,6}\s+/g, "$1")
    // List items run together on one line, so a dot keeps them apart
    .replace(/(^|\s)(?:[-*+]|\d+\.)\s+/g, "$1· ")
    .replace(/[*`]|~~/g, "")
    .replace(/\s+/g, " ")
    .replace(/^· /, "")
    .trim();
}

/** A date as YYYY-MM-DD in the owner's time zone, the form the server uses for a due date. */
export function localDate(date = new Date()): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export const TASK_GROUPS = ["Overdue", "Today", "Upcoming", "No Date", "Done"] as const;
export type TaskGroup = (typeof TASK_GROUPS)[number];

export function groupOf(task: { done: boolean; due_on: string | null }, today: string): TaskGroup {
  if (task.done) return "Done";
  if (!task.due_on) return "No Date";
  if (task.due_on < today) return "Overdue";
  return task.due_on === today ? "Today" : "Upcoming";
}

/** "Today", "Tomorrow", a weekday within the week, or a short date. */
export function dueLabel(due: string, today: string): string {
  const days = (Date.parse(due) - Date.parse(today)) / 86_400_000;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  const format: Intl.DateTimeFormatOptions =
    days > 1 && days < 7
      ? { weekday: "long" }
      : { month: "short", day: "numeric", ...(due.slice(0, 4) !== today.slice(0, 4) && { year: "numeric" }) };
  return new Date(`${due}T00:00:00Z`).toLocaleDateString("en-US", { ...format, timeZone: "UTC" });
}
