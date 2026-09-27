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

// A calendar date is a day, not an instant, so every date here is built and read in UTC, where no
// time zone can move it to the day before
const utcDay = (iso: string) => new Date(`${iso}T00:00:00Z`);

const DAY_MONTH_YEAR = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" });

/** The format every date is shown in, for a placeholder to say which order the parts come in. */
export const DATE_PLACEHOLDER = "dd mmm yyyy";

/** The one display format for a calendar date, the same for every user: "28 Sep 2026". */
export function formatDate(iso: string): string {
  const parts = Object.fromEntries(DAY_MONTH_YEAR.formatToParts(utcDay(iso)).map((part) => [part.type, part.value]));
  return `${parts.day} ${parts.month} ${parts.year}`;
}

/** The parts of a YYYY-MM-DD date, month from 0, or null when it is not a real date. */
export function parseIsoDate(value: string | null): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? { year, month: month - 1, day } : null;
}

/** YYYY-MM-DD for a year, a month from 0, and a day, rolling over into the next or previous month. */
export function isoDate(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

/** "Today", "Tomorrow", a weekday within the week, or the date. */
export function dueLabel(due: string, today: string): string {
  const days = (utcDay(due).getTime() - utcDay(today).getTime()) / 86_400_000;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return days > 1 && days < 7 ? WEEKDAY.format(utcDay(due)) : formatDate(due);
}
