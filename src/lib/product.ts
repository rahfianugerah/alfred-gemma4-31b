export const PRODUCT_NAME = "Alfred";

export const LOGO_SRC = "/the-assistant-logo.png";

// What the main area shows, kept in the URL as ?view=notes or ?view=tasks; chat is the default
export type View = "chat" | "notes" | "tasks";

// The same names the server reads as slash commands, in server/main.py TASK_PROMPTS
export const COMMANDS = [
  { name: "general", description: "Just talk, with no suggestion asked for" },
  { name: "note", description: "Turn what you say into a note to save" },
  { name: "task", description: "Turn what you say into tasks to save" },
] as const;

// The Note and Task buttons put the box in a mode. The command is added on send
export const MODES = [
  { command: "note", label: "Note", placeholder: "What should the note say? For example, ideas for the weekend trip" },
  { command: "task", label: "Task", placeholder: "What needs doing? For example, pay the rent on Friday" },
] as const;

export type Mode = (typeof MODES)[number]["command"];

// Shown on an empty chat. A few start with a command, which teaches it
export const SUGGESTIONS = [
  { label: "Plan my day", prompt: "Look at my open tasks and help me plan today, most important first." },
  { label: "What is due this week?", prompt: "Which of my tasks are due this week, and are any overdue?" },
  { label: "Add a few tasks", prompt: "/task Pay the electricity bill by Friday and renew my passport next month." },
  { label: "Take a note", prompt: "/note Gift ideas for Mom: a cooking class, a photo book, dinner at her favorite place." },
  { label: "Summarize my notes", prompt: "Summarize my recent notes in a few bullet points." },
  { label: "Draft a message", prompt: "Draft a short, friendly message asking my landlord to fix the kitchen tap." },
  { label: "Weekly dinner plan", prompt: "Make a simple dinner plan for this week for two people, with a shopping list." },
  { label: "Break down a chore", prompt: "/task Break cleaning out the garage into small tasks I can do this weekend." },
] as const;

/** Split a leading known command off a message, mirroring split_command on the server. */
export function splitCommand(content: string): [string | null, string] {
  const match = /^\/(\w+)\b\s*/.exec(content);
  if (match && COMMANDS.some((command) => command.name === match[1])) {
    return [match[1], content.slice(match[0].length)];
  }
  return [null, content];
}
