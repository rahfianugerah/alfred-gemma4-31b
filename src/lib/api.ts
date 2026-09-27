import { PRODUCT_NAME } from "@/lib/product";

export const API_URL = process.env.NEXT_PUBLIC_ASSISTANT_URL ?? "http://127.0.0.1:8000";

type Source = "user" | "assistant";
type Match = "exact" | "prefix" | "fuzzy" | null;

/** A suggestion in a reply, which the owner saves with one click. */
export type Action = {
  index: number;
  type: "create_task" | "create_note" | "complete_task";
  title: string;
  due: string | null;
  content: string | null;
  task_id: string | null;
  applied: boolean;
  target_id: string | null;
};

export type ChatMessage = {
  id: number | string;
  role: "user" | "assistant";
  content: string;
  reasoning: string | null;
  // Only on a reply loaded from the server; a reply still streaming has none yet
  actions?: Action[];
};

export type ConversationSummary = { id: string; title: string; updated_at: string };

export type NoteSummary = { id: string; title: string; preview: string; source: Source; updated_at: string };

export type Note = { id: string; title: string; content: string; source: Source; updated_at: string };

export type Task = {
  id: string;
  title: string;
  done: boolean;
  due_on: string | null;
  source: Source;
  updated_at: string;
};

export type TaskStatus = "open" | "done" | "all";

type Page<T> = { items: T[]; total: number; match: Match };

type ReplyEvent = { reasoning?: string; content?: string; error?: { message: string } };

async function errorMessage(response: Response): Promise<string> {
  try {
    return (await response.json()).error.message;
  } catch {
    return `The server answered with status ${response.status}`;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}/${path}`, init);
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.status === 204 ? (undefined as T) : response.json();
}

const withBody = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const searchFor = (query: string) => (query.trim() ? `&q=${encodeURIComponent(query.trim())}` : "");

export const getModel = () => request<{ model: string }>("health").then((health) => health.model);

// ponytail: every list shows its latest 100 items; page through the rest if one ever fills
export const listConversations = () =>
  request<Page<ConversationSummary>>("api/v1/conversations?limit=100").then((page) => page.items);

export type SearchResult = { query: string; items: ConversationSummary[]; match: Match };

// The server runs the search ladder; match says which stage answered, and "fuzzy" means close matches
export const searchConversations = (query: string) =>
  request<Page<ConversationSummary>>(`api/v1/conversations?limit=100${searchFor(query)}`).then(
    (page): SearchResult => ({ query, ...page }),
  );

export const createConversation = () => request<ConversationSummary>("api/v1/conversations", { method: "POST" });

export const getConversation = (id: string) =>
  request<{ title: string; messages: ChatMessage[] }>(`api/v1/conversations/${id}`);

export const renameConversation = (id: string, title: string) =>
  request<ConversationSummary>(`api/v1/conversations/${id}`, withBody("PATCH", { title }));

export const deleteConversation = (id: string) => request<void>(`api/v1/conversations/${id}`, { method: "DELETE" });

/** Save one suggestion from a reply. The server reads it again from the stored reply. */
export const applyAction = (messageId: number, index: number) =>
  request<{ target_type: "note" | "task"; target_id: string }>(
    `api/v1/messages/${messageId}/applied-actions`,
    withBody("POST", { index }),
  );

export const listNotes = (query = "") => request<Page<NoteSummary>>(`api/v1/notes?limit=100${searchFor(query)}`);

export const getNote = (id: string) => request<Note>(`api/v1/notes/${id}`);

export const createNote = (title: string) => request<Note>("api/v1/notes", withBody("POST", { title }));

export const updateNote = (id: string, changes: { title?: string; content?: string }) =>
  request<Note>(`api/v1/notes/${id}`, withBody("PATCH", changes));

export const deleteNote = (id: string) => request<void>(`api/v1/notes/${id}`, { method: "DELETE" });

export const listTasks = (status: TaskStatus, query = "") =>
  request<Page<Task>>(`api/v1/tasks?status=${status}&limit=100${searchFor(query)}`);

export const createTask = (title: string, due_on: string | null) =>
  request<Task>("api/v1/tasks", withBody("POST", { title, due_on }));

export const updateTask = (id: string, changes: { title?: string; due_on?: string | null; done?: boolean }) =>
  request<Task>(`api/v1/tasks/${id}`, withBody("PATCH", changes));

export const deleteTask = (id: string) => request<void>(`api/v1/tasks/${id}`, { method: "DELETE" });

/** Yield the reply's NDJSON events as they arrive: reasoning, answer text, or an error. */
export async function* streamReply(
  conversationId: string,
  content: string,
  signal: AbortSignal,
): AsyncGenerator<ReplyEvent> {
  const response = await fetch(`${API_URL}/api/v1/conversations/${conversationId}/messages`, {
    ...withBody("POST", { content }),
    signal,
  });
  if (!response.ok || !response.body) throw new Error(await errorMessage(response));

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line) yield JSON.parse(line);
  }
}

/** Turn a failed request into a sentence for the error banner. */
export function describeError(error: unknown): string {
  if (error instanceof TypeError) return `Cannot reach the ${PRODUCT_NAME} server at ${API_URL}. Is it running?`;
  return error instanceof Error ? error.message : String(error);
}
