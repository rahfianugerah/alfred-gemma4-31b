"use client";

import { ArrowLeft, Eye, Loader2, NotebookPen, Pencil, Plus, Search, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CopyButton } from "@/components/copy-button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { SystemMessage } from "@/components/ui/system-message";
import {
  createNote,
  deleteNote,
  describeError,
  getNote,
  listNotes,
  type Note,
  type NoteSummary,
  updateNote,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { plainPreview } from "@/lib/workspace";

const NEW_NOTE_TITLE = "Untitled Note";

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

type NotesViewProps = { noteId: string | null; onOpenNote: (id: string | null) => void };

/** The notes list beside the open note. On a phone they take turns filling the screen. */
export function NotesView({ noteId, onOpenNote }: NotesViewProps) {
  const [query, setQuery] = useState("");
  const [loaded, setLoaded] = useState<{ query: string; notes: NoteSummary[]; isClose: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const searched = query.trim();
  const current = loaded?.query === searched ? loaded : null;

  useEffect(() => {
    let ignore = false;
    const timer = setTimeout(
      () => {
        listNotes(searched).then(
          (page) => !ignore && setLoaded({ query: searched, notes: page.items, isClose: page.match === "fuzzy" }),
          (err) => !ignore && setError(describeError(err)),
        );
      },
      searched ? 250 : 0,
    );
    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [searched]);

  // A saved note moves to the top of the list with its new title and preview
  function showSaved(note: Note) {
    const item: NoteSummary = {
      id: note.id,
      title: note.title,
      preview: note.content.replace(/\s+/g, " ").trim().slice(0, 160),
      source: note.source,
      updated_at: note.updated_at,
    };
    setLoaded((list) => list && { ...list, notes: [item, ...list.notes.filter((n) => n.id !== note.id)] });
  }

  async function newNote() {
    try {
      const note = await createNote(NEW_NOTE_TITLE);
      setQuery("");
      showSaved(note);
      setCreatedId(note.id);
      onOpenNote(note.id);
    } catch (err) {
      setError(describeError(err));
    }
  }

  function removed(id: string) {
    setLoaded((list) => list && { ...list, notes: list.notes.filter((n) => n.id !== id) });
    onOpenNote(null);
  }

  return (
    <div className="flex h-full min-h-0">
      <section
        aria-label="All Notes"
        className={cn("flex min-h-0 w-full flex-col md:w-80 md:shrink-0 md:border-r", noteId && "max-md:hidden")}
      >
        <div className="flex items-center gap-2 border-b p-3">
          <div className="relative flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <input
              type="search"
              aria-label="Search Notes"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.key === "Escape" && setQuery("")}
              placeholder="Search notes"
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
          <Button size="icon" aria-label="New Note" title="New note" className="rounded-full" onClick={newNote}>
            <Plus />
          </Button>
        </div>

        {error && (
          <SystemMessage variant="error" fill className="m-3" cta={{ label: "Dismiss", onClick: () => setError(null) }}>
            {error}
          </SystemMessage>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {!current ? (
            !error && (
              <p role="status" className="text-muted-foreground flex items-center gap-2 p-2 text-sm">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                {searched ? "Searching..." : "Loading notes..."}
              </p>
            )
          ) : current.notes.length === 0 ? (
            <p className="text-muted-foreground p-2 text-sm">
              {searched ? `No notes match "${searched}".` : "No notes yet. Write one, or ask in the chat."}
            </p>
          ) : (
            <>
              {/* A close match may not contain the words typed, so the list says why it is here */}
              {current.isClose && (
                <p className="text-muted-foreground px-2 pb-2 text-xs">
                  No title starts with &quot;{searched}&quot;. These notes have similar words.
                </p>
              )}
              <ul className="flex flex-col gap-0.5">
                {current.notes.map((note) => (
                  <li key={note.id}>
                    <button
                      type="button"
                      aria-current={note.id === noteId}
                      onClick={() => onOpenNote(note.id)}
                      className={cn(
                        "hover:bg-muted flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left",
                        note.id === noteId && "bg-muted",
                      )}
                    >
                      <span className="truncate text-sm font-medium">{note.title}</span>
                      {note.preview && (
                        <span className="text-muted-foreground line-clamp-2 text-xs">{plainPreview(note.preview)}</span>
                      )}
                      <span className="text-muted-foreground flex items-center gap-1 text-xs">
                        {shortDate(note.updated_at)}
                        {note.source === "assistant" && (
                          <>
                            {" · "}
                            <Sparkles className="size-3" aria-hidden="true" />
                            From chat
                          </>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>

      <section aria-label="Note" className={cn("min-h-0 min-w-0 flex-1", !noteId && "max-md:hidden")}>
        {noteId ? (
          <NoteEditor
            key={noteId}
            id={noteId}
            isNew={noteId === createdId}
            onSaved={showSaved}
            onDeleted={() => removed(noteId)}
            onBack={() => onOpenNote(null)}
          />
        ) : (
          <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm">
            <NotebookPen className="size-8" aria-hidden="true" />
            Pick a note, or start a new one.
          </div>
        )}
      </section>
    </div>
  );
}

type Changes = { title?: string; content?: string };
type SaveState = "saved" | "edited" | "saving" | "failed";

const SAVE_LABELS: Record<SaveState, string> = {
  saved: "Saved",
  edited: "Edited",
  saving: "Saving...",
  failed: "Not saved",
};

type NoteEditorProps = {
  id: string;
  isNew: boolean;
  onSaved: (note: Note) => void;
  onDeleted: () => void;
  onBack: () => void;
};

/** One note, saved a moment after each change, the way a notes app keeps what you type. */
function NoteEditor({ id, isNew, onSaved, onDeleted, onBack }: NoteEditorProps) {
  const [note, setNote] = useState<Note | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [isPreview, setIsPreview] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  // The changes not sent yet, and the timer that sends them
  const pending = useRef<Changes>({});
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    let ignore = false;
    getNote(id).then(
      (loaded) => {
        if (ignore) return;
        setNote(loaded);
        // A note with something in it opens as it reads; an empty one opens ready to type
        setIsPreview(loaded.content.trim().length > 0);
      },
      (err) => !ignore && setError(describeError(err)),
    );
    return () => {
      ignore = true;
    };
  }, [id]);

  /** Take the waiting changes, leaving out a blank title, which the server refuses. */
  function takePending(): Changes | null {
    const { title, content } = pending.current;
    pending.current = {};
    const changes: Changes = {
      ...(title?.trim() && { title: title.trim() }),
      ...(content !== undefined && { content }),
    };
    return Object.keys(changes).length ? changes : null;
  }

  // A change still waiting when the note closes is saved on the way out
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      const changes = takePending();
      if (changes) updateNote(id, changes).then(onSaved, () => {});
    },
    // Runs once, when the editor closes: it is keyed by the note, so id never changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  async function save() {
    const changes = takePending();
    if (!changes) return setSaveState("saved");
    setSaveState("saving");
    try {
      const saved = await updateNote(id, changes);
      onSaved(saved);
      // Only the time comes back from the server, so the text being typed is never replaced
      setNote((current) => current && { ...current, updated_at: saved.updated_at });
      // A change typed while this one was on its way keeps the state it set
      setSaveState((state) => (state === "saving" ? "saved" : state));
    } catch (err) {
      // Kept, so the next save sends it again
      pending.current = { ...changes, ...pending.current };
      setSaveState("failed");
      setError(describeError(err));
    }
  }

  function edit(changes: Changes) {
    setNote((current) => current && { ...current, ...changes });
    Object.assign(pending.current, changes);
    setSaveState("edited");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 600);
  }

  async function remove() {
    clearTimeout(timer.current);
    pending.current = {};
    try {
      await deleteNote(id);
      onDeleted();
    } catch (err) {
      setError(describeError(err));
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b px-2">
        <Button variant="ghost" size="icon" aria-label="All Notes" className="md:hidden" onClick={onBack}>
          <ArrowLeft />
        </Button>
        <span aria-live="polite" className={cn("text-muted-foreground px-2 text-xs", saveState === "failed" && "text-destructive")}>
          {note && SAVE_LABELS[saveState]}
        </span>
        <div className="flex-1" />
        {note && (
          <>
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={isPreview}
              onClick={() => setIsPreview(!isPreview)}
              title={isPreview ? "Edit the note" : "See the note formatted"}
            >
              {isPreview ? <Pencil /> : <Eye />}
              {isPreview ? "Edit" : "Preview"}
            </Button>
            <CopyButton text={note.content} label="Copy Note" />
            <Button variant="ghost" size="icon-sm" aria-label="Delete Note" onClick={() => setIsConfirmingDelete(true)}>
              <Trash2 />
            </Button>
          </>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-5 py-8 md:px-8">
          {error && (
            <SystemMessage variant="error" fill cta={{ label: "Dismiss", onClick: () => setError(null) }}>
              {error}
            </SystemMessage>
          )}
          {!note ? (
            !error && (
              <p role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Opening note...
              </p>
            )
          ) : (
            <>
              <input
                aria-label="Note Title"
                value={note.title}
                maxLength={200}
                autoFocus={isNew}
                onFocus={(event) => isNew && event.target.select()}
                onChange={(event) => edit({ title: event.target.value })}
                placeholder="Title"
                className="w-full bg-transparent text-2xl font-bold outline-none"
              />
              <p className="text-muted-foreground flex items-center gap-1 text-xs">
                Edited {new Date(note.updated_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                {note.source === "assistant" && (
                  <>
                    {" · "}
                    <Sparkles className="size-3" aria-hidden="true" />
                    Saved from chat
                  </>
                )}
              </p>
              {isPreview ? (
                // A double click is the quick way back to typing
                <div onDoubleClick={() => setIsPreview(false)} className="min-h-[50dvh]">
                  {note.content.trim() ? (
                    <Markdown className="prose max-w-none">{note.content}</Markdown>
                  ) : (
                    <p className="text-muted-foreground text-sm">This note is empty.</p>
                  )}
                </div>
              ) : (
                <textarea
                  aria-label="Note"
                  value={note.content}
                  maxLength={50_000}
                  autoFocus={!isNew}
                  onChange={(event) => edit({ content: event.target.value })}
                  placeholder="Start writing. Markdown works here: # headings, - lists, **bold**."
                  className="field-sizing-content min-h-[50dvh] w-full resize-none bg-transparent text-base leading-7 outline-none"
                />
              )}
            </>
          )}
        </div>
      </div>

      <AlertDialog open={isConfirmingDelete} onOpenChange={setIsConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Note?</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{note?.title}&quot; will be removed from this machine. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void remove()}>
              Delete Note
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
