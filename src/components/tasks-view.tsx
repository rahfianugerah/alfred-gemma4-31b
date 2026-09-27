"use client";

import { CalendarPlus, CheckCircle2, Circle, Loader2, Plus, Search, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DatePicker } from "@/components/date-picker";
import { TitleEditor } from "@/components/title-editor";
import { Button } from "@/components/ui/button";
import { SystemMessage } from "@/components/ui/system-message";
import { deleteTask, describeError, createTask, listTasks, type Task, type TaskStatus, updateTask } from "@/lib/api";
import { cn } from "@/lib/utils";
import { dueLabel, groupOf, localDate, TASK_GROUPS } from "@/lib/workspace";

type TaskChange = Partial<Pick<Task, "title" | "due_on" | "done">>;

const FILTERS: { status: TaskStatus; label: string }[] = [
  { status: "open", label: "Open" },
  { status: "done", label: "Done" },
  { status: "all", label: "All" },
];

export function TasksView() {
  const [status, setStatus] = useState<TaskStatus>("open");
  const [query, setQuery] = useState("");
  // Tagged with the filter and search they answer, so a slow older answer never shows
  const [loaded, setLoaded] = useState<{ key: string; tasks: Task[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const key = `${status}:${query.trim()}`;
  const tasks = loaded?.key === key ? loaded.tasks : null;
  const today = localDate();

  // A search waits for a pause in typing; a filter change loads at once
  useEffect(() => {
    let ignore = false;
    const timer = setTimeout(
      () => {
        listTasks(status, query).then(
          (page) => !ignore && setLoaded({ key: `${status}:${query.trim()}`, tasks: page.items }),
          (err) => !ignore && setError(describeError(err)),
        );
      },
      query.trim() ? 250 : 0,
    );
    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [status, query]);

  const setTasks = (change: (tasks: Task[]) => Task[]) =>
    setLoaded((current) => current && { ...current, tasks: change(current.tasks) });

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    try {
      const task = await createTask(title.trim(), due);
      if (status !== "done") setTasks((list) => [...list, task]);
      setTitle("");
      setDue(null);
    } catch (err) {
      setError(describeError(err));
    }
  }

  // Shown at once, and put back if the server refuses it
  async function change(task: Task, changes: TaskChange) {
    const show = (next: Task) => setTasks((list) => list.map((t) => (t.id === next.id ? next : t)));
    show({ ...task, ...changes });
    try {
      show(await updateTask(task.id, changes));
    } catch (err) {
      show(task);
      setError(describeError(err));
    }
  }

  async function remove(task: Task) {
    setTasks((list) => list.filter((t) => t.id !== task.id));
    try {
      await deleteTask(task.id);
    } catch (err) {
      setTasks((list) => [...list, task]);
      setError(describeError(err));
    }
  }

  const groups = TASK_GROUPS.map((group) => ({
    group,
    // The server sorts by due date, and a task added here since joins its group in date order
    items: (tasks ?? [])
      .filter((task) => groupOf(task, today) === group)
      .sort((a, b) => (a.due_on ?? "").localeCompare(b.due_on ?? "")),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-8 md:px-6">
        {error && (
          <SystemMessage variant="error" fill cta={{ label: "Dismiss", onClick: () => setError(null) }}>
            {error}
          </SystemMessage>
        )}

        {/* On a phone the date takes its own full-width row, so its calendar gets the full width too */}
        <form
          onSubmit={add}
          className="border-input bg-popover flex flex-wrap items-center gap-2 rounded-2xl border p-2 shadow-xs"
        >
          <input
            aria-label="New Task"
            value={title}
            maxLength={300}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Add a task"
            className="min-w-0 flex-1 basis-full bg-transparent px-2 py-1.5 text-base outline-none sm:basis-0"
          />
          <DatePicker label="Due date" value={due} onChange={setDue} className="flex-1 sm:w-64 sm:flex-none" />
          <Button type="submit" size="icon" aria-label="Add Task" className="shrink-0 rounded-full" disabled={!title.trim()}>
            <Plus />
          </Button>
        </form>

        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Show" className="bg-muted flex rounded-lg p-0.5">
            {FILTERS.map((filter) => (
              <button
                key={filter.status}
                type="button"
                aria-pressed={status === filter.status}
                onClick={() => setStatus(filter.status)}
                className={cn(
                  "rounded-md px-3 py-1 text-sm",
                  status === filter.status ? "bg-background font-medium shadow-xs" : "text-muted-foreground",
                )}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <div className="relative min-w-40 flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <input
              type="search"
              aria-label="Search Tasks"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.key === "Escape" && setQuery("")}
              placeholder="Search tasks"
              className="bg-background h-9 w-full rounded-lg border pr-8 pl-8 text-sm outline-none focus-visible:ring-2 [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Clear Search"
                className="absolute top-1/2 right-1.5 -translate-y-1/2"
                onClick={() => setQuery("")}
              >
                <X />
              </Button>
            )}
          </div>
        </div>

        {tasks === null ? (
          !error && (
            <p role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Loading tasks...
            </p>
          )
        ) : groups.length === 0 ? (
          <p className="text-muted-foreground py-10 text-center text-sm">
            {query.trim()
              ? `No tasks match "${query.trim()}".`
              : status === "done"
                ? "Nothing finished yet."
                : "Nothing to do. Add a task above, or ask in the chat."}
          </p>
        ) : (
          groups.map(({ group, items }) => (
            <section key={group} aria-label={group}>
              <h2 className="text-muted-foreground mb-1 px-2 text-xs font-semibold tracking-wide uppercase">
                {group} <span className="font-normal">{items.length}</span>
              </h2>
              <ul>
                {items.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    today={today}
                    isEditing={editingId === task.id}
                    onEdit={setEditingId}
                    onChange={(changes) => void change(task, changes)}
                    onDelete={() => void remove(task)}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

type TaskRowProps = {
  task: Task;
  today: string;
  isEditing: boolean;
  onEdit: (id: string | null) => void;
  onChange: (changes: TaskChange) => void;
  onDelete: () => void;
};

function TaskRow({ task, today, isEditing, onEdit, onChange, onDelete }: TaskRowProps) {
  // The date chip turns into a date field with its calendar open, and back once a date is picked
  const [isPickingDate, setIsPickingDate] = useState(false);
  const chipRef = useRef<HTMLButtonElement>(null);
  const isOverdue = !task.done && task.due_on !== null && task.due_on < today;

  return (
    <li className="group hover:bg-muted/60 flex items-start gap-3 rounded-lg px-2 py-2">
      <button
        type="button"
        role="checkbox"
        aria-checked={task.done}
        aria-label={task.title}
        onClick={() => onChange({ done: !task.done })}
        className="mt-0.5 shrink-0 rounded-full"
      >
        {task.done ? <CheckCircle2 className="size-5" /> : <Circle className="text-muted-foreground size-5" />}
      </button>

      <div className="min-w-0 flex-1">
        {isEditing ? (
          <TitleEditor
            title={task.title}
            label="Task Title"
            maxLength={300}
            onSave={(title) => {
              onEdit(null);
              onChange({ title });
            }}
            onCancel={() => onEdit(null)}
          />
        ) : (
          <button
            type="button"
            title="Rename task"
            onClick={() => onEdit(task.id)}
            className={cn(
              "w-full text-left [overflow-wrap:anywhere]",
              task.done && "text-muted-foreground line-through",
            )}
          >
            {task.title}
          </button>
        )}

        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
          {isPickingDate ? (
            <DatePicker
              label={`Due date for ${task.title}`}
              value={task.due_on}
              onChange={(due_on) => onChange({ due_on })}
              defaultOpen
              onClose={(returnedFocus) => {
                setIsPickingDate(false);
                // Focus goes back to the chip that stands in for the field again
                if (returnedFocus) requestAnimationFrame(() => chipRef.current?.focus());
              }}
              className="w-64 max-w-full"
            />
          ) : (
            <button
              ref={chipRef}
              type="button"
              aria-label={task.due_on ? `Due ${dueLabel(task.due_on, today)}, change the date` : "Add a due date"}
              onClick={() => setIsPickingDate(true)}
              className={cn(
                "flex items-center gap-1 rounded-md px-1.5 py-0.5",
                task.due_on
                  ? isOverdue
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                  : "text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100",
              )}
            >
              {task.due_on ? (
                <>
                  {isOverdue && "Overdue · "}
                  {dueLabel(task.due_on, today)}
                </>
              ) : (
                <>
                  <CalendarPlus className="size-3" aria-hidden="true" />
                  Add date
                </>
              )}
            </button>
          )}
          {task.source === "assistant" && (
            <span className="text-muted-foreground flex items-center gap-1">
              <Sparkles className="size-3" aria-hidden="true" />
              From chat
            </span>
          )}
        </div>
      </div>

      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Delete ${task.title}`}
        onClick={onDelete}
        className="shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
      >
        <Trash2 />
      </Button>
    </li>
  );
}
