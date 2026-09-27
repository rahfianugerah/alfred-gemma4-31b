"use client";

import { Check, CheckCircle2, ListTodo, Loader2, NotebookPen } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { type Action, applyAction, describeError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { dueLabel, localDate, plainPreview } from "@/lib/workspace";

const KINDS = {
  create_task: { icon: ListTodo, label: "New Task", save: "Add Task" },
  create_note: { icon: NotebookPen, label: "New Note", save: "Save Note" },
  complete_task: { icon: CheckCircle2, label: "Finish Task", save: "Mark Done" },
} as const;

type ActionCardsProps = {
  messageId: number;
  actions: Action[];
  onApplied: (index: number, targetId: string) => void;
  onOpen: (action: Action) => void;
};

/** The suggestions in a reply. Nothing is saved until the owner confirms a card. */
export function ActionCards({ messageId, actions, onApplied, onOpen }: ActionCardsProps) {
  const [saving, setSaving] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const waiting = actions.filter((action) => !action.applied);
  const today = localDate();

  async function save(action: Action) {
    setSaving((list) => [...list, action.index]);
    setError(null);
    try {
      const { target_id } = await applyAction(messageId, action.index);
      onApplied(action.index, target_id);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving((list) => list.filter((index) => index !== action.index));
    }
  }

  async function saveAll() {
    for (const action of waiting) await save(action);
  }

  return (
    <div role="group" aria-label="Suggestions" className="mt-2 flex w-full flex-col gap-2">
      {actions.map((action) => {
        const kind = KINDS[action.type];
        const Icon = kind.icon;
        const isSaving = saving.includes(action.index);
        return (
          <div
            key={action.index}
            className={cn(
              // On a phone the buttons wrap under the text, lined up with it, so the title keeps the width
              "animate-in fade-in-0 flex flex-wrap items-start gap-x-3 gap-y-2 rounded-xl border p-3 duration-300",
              action.applied && "bg-muted/60 border-transparent",
            )}
          >
            <div className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-lg" aria-hidden="true">
              <Icon className="size-4" />
            </div>
            <div className="min-w-0 flex-1 max-sm:basis-[calc(100%-2.75rem)]">
              <p className="text-muted-foreground text-xs font-medium">
                {kind.label}
                {action.due && ` · Due ${dueLabel(action.due, today)}`}
              </p>
              <p className="font-medium [overflow-wrap:anywhere]">{action.title}</p>
              {action.content && (
                <p className="text-muted-foreground mt-1 line-clamp-2 text-sm [overflow-wrap:anywhere]">
                  {plainPreview(action.content)}
                </p>
              )}
            </div>
            {action.applied ? (
              <div className="flex shrink-0 items-center gap-1 max-sm:ml-11">
                <span className="flex items-center gap-1 text-sm text-green-700">
                  <Check className="size-4" aria-hidden="true" />
                  Saved
                </span>
                <Button variant="ghost" size="sm" onClick={() => onOpen(action)}>
                  Open
                </Button>
              </div>
            ) : (
              <Button size="sm" className="shrink-0 max-sm:ml-11" disabled={isSaving} onClick={() => void save(action)}>
                {isSaving && <Loader2 className="animate-spin" aria-hidden="true" />}
                {kind.save}
              </Button>
            )}
          </div>
        );
      })}
      {waiting.length > 1 && (
        <Button variant="outline" size="sm" className="self-start" disabled={saving.length > 0} onClick={saveAll}>
          Save All {waiting.length}
        </Button>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
