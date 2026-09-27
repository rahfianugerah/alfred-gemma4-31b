"use client";

import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { DATE_PLACEHOLDER, formatDate, isoDate, localDate, parseIsoDate } from "@/lib/workspace";

// A custom panel rather than <input type="date">, per calendar.component.md: the panel has to
// match the black and white theme, and the date has to read the same for every user, which the
// native control's locale-driven format cannot promise.

type View = "day" | "month" | "year";
type Shown = { year: number; month: number };

const LOCALE = "en-US";
const MONTH_TITLE = new Intl.DateTimeFormat(LOCALE, { month: "long", year: "numeric", timeZone: "UTC" });
const MONTH_NAME = new Intl.DateTimeFormat(LOCALE, { month: "short", timeZone: "UTC" });
const DAY_NAME = new Intl.DateTimeFormat(LOCALE, { weekday: "short", timeZone: "UTC" });
const DAY_NAME_LONG = new Intl.DateTimeFormat(LOCALE, { weekday: "long", timeZone: "UTC" });
const FULL_DATE = new Intl.DateTimeFormat(LOCALE, { dateStyle: "full", timeZone: "UTC" });

// A due date is near: two years back covers an overdue task, ten ahead covers a long plan
const THIS_YEAR = new Date().getFullYear();
const MIN_YEAR = THIS_YEAR - 2;
const MAX_YEAR = THIS_YEAR + 10;
const YEARS_PER_PAGE = 12;
// The room the panel needs under the trigger; with less, it opens upward
const ROOM_BELOW = 320;

const utc = (year: number, month: number, day = 1) => new Date(Date.UTC(year, month, day));
const daysIn = (year: number, month: number) => utc(year, month + 1, 0).getUTCDate();
const inRange = (year: number) => year >= MIN_YEAR && year <= MAX_YEAR;

/** The first day of the week for the browser's locale, 0 for Sunday. Monday where it is unknown. */
function firstDayOfWeek(): number {
  try {
    type WeekInfo = { firstDay: number };
    const locale = new Intl.Locale(navigator.language) as Intl.Locale & {
      getWeekInfo?: () => WeekInfo;
      weekInfo?: WeekInfo;
    };
    return ((locale.getWeekInfo?.() ?? locale.weekInfo)?.firstDay ?? 1) % 7;
  } catch {
    return 1;
  }
}

/** The day the panel opens on: the value, or today when the value is empty, broken, or out of range. */
function startingDay(value: string | null) {
  const parsed = parseIsoDate(value);
  return parsed && inRange(parsed.year) ? parsed : parseIsoDate(localDate())!;
}

type DatePickerProps = {
  // Names the field, such as "Due date"; the trigger and the panel are announced with it
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  className?: string;
  // Opens as soon as it appears, for a field that replaces a chip the owner just clicked
  defaultOpen?: boolean;
  // Called once the panel closes, saying whether focus went back to the trigger
  onClose?: (returnedFocus: boolean) => void;
};

/** A date field: a trigger showing the date, and a panel with day, month, and year views. */
export function DatePicker({ label, value, onChange, className, defaultOpen = false, onClose }: DatePickerProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [view, setView] = useState<View>("day");
  const [shown, setShown] = useState<Shown>(() => startingDay(value));
  const [focused, setFocused] = useState(() => {
    const start = startingDay(value);
    return isoDate(start.year, start.month, start.day);
  });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const selected = parseIsoDate(value);
  const display = selected ? formatDate(value!) : null;

  /** Puts the panel as wide as the trigger, inside the viewport, below it or pinned above it. It
   * runs as the panel mounts, before the browser paints, so it never shows in the wrong place. */
  function place(panel: HTMLElement | null) {
    const trigger = triggerRef.current;
    if (!panel || !trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.round(Math.min(rect.width, window.innerWidth - 16));
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const below = window.innerHeight - rect.bottom >= ROOM_BELOW;
    // Opening upward pins the bottom edge, so the three views, each a different height, stay put
    Object.assign(panel.style, {
      left: `${left}px`,
      width: `${width}px`,
      top: below ? `${rect.bottom + 4}px` : "",
      bottom: below ? "" : `${window.innerHeight - rect.top + 4}px`,
    });
  }

  function open() {
    const start = startingDay(value);
    setShown({ year: start.year, month: start.month });
    setFocused(isoDate(start.year, start.month, start.day));
    setView("day");
    setIsOpen(true);
  }

  function close(returnFocus: boolean) {
    setIsOpen(false);
    if (returnFocus) triggerRef.current?.focus();
    onClose?.(returnFocus);
  }

  function pick(iso: string | null) {
    onChange(iso);
    close(true);
  }

  // While open, the panel follows the trigger through a scroll of any ancestor or a resize, and a
  // press anywhere but the trigger or the panel closes it. The panel is not inside the trigger's
  // DOM, so both are tested.
  useEffect(() => {
    if (!isOpen) return;
    const follow = () => place(panelRef.current);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) close(false);
    };
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  });

  // The focused day holds real focus, from the moment the panel opens
  useEffect(() => {
    if (isOpen && view === "day") panelRef.current?.querySelector<HTMLElement>(`[data-date="${focused}"]`)?.focus();
  }, [isOpen, view, focused]);

  function focusDay(iso: string) {
    const day = parseIsoDate(iso)!;
    if (!inRange(day.year)) return;
    setFocused(iso);
    setShown({ year: day.year, month: day.month });
  }

  function onGridKeyDown(event: React.KeyboardEvent) {
    // Moves from the day that has focus, which after the arrows changed the month is not the saved one
    const current = parseIsoDate((event.target as HTMLElement).dataset.date ?? focused);
    if (!current) return;
    const { year, month, day } = current;
    const column = (utc(year, month, day).getUTCDay() - firstDayOfWeek() + 7) % 7;
    const sameDayIn = (step: number) => isoDate(year, month + step, Math.min(day, daysIn(year, month + step)));
    const moves: Record<string, () => string> = {
      ArrowLeft: () => isoDate(year, month, day - 1),
      ArrowRight: () => isoDate(year, month, day + 1),
      ArrowUp: () => isoDate(year, month, day - 7),
      ArrowDown: () => isoDate(year, month, day + 7),
      Home: () => isoDate(year, month, day - column),
      End: () => isoDate(year, month, day + 6 - column),
      PageUp: () => sameDayIn(-1),
      PageDown: () => sameDayIn(1),
    };
    if (!moves[event.key]) return;
    event.preventDefault();
    focusDay(moves[event.key]());
  }

  // The arrows move a month, a year, or a page of years, and stop at the edge of the range
  const step = { day: 1, month: 12, year: YEARS_PER_PAGE * 12 }[view];
  const monthIndex = shown.year * 12 + shown.month;
  const pageStart = MIN_YEAR + Math.floor((shown.year - MIN_YEAR) / YEARS_PER_PAGE) * YEARS_PER_PAGE;
  const canGoBack = view === "year" ? pageStart > MIN_YEAR : monthIndex - step >= MIN_YEAR * 12;
  const canGoForward = view === "year" ? pageStart + YEARS_PER_PAGE <= MAX_YEAR : monthIndex + step <= MAX_YEAR * 12 + 11;

  function move(direction: 1 | -1) {
    // Past the edge, only the year moves and the month stays where it was
    const next = Math.min(Math.max(monthIndex + direction * step, MIN_YEAR * 12), MAX_YEAR * 12 + 11);
    setShown({ year: Math.floor(next / 12), month: view === "day" ? next % 12 : shown.month });
  }

  const title =
    view === "day"
      ? MONTH_TITLE.format(utc(shown.year, shown.month))
      : view === "month"
        ? String(shown.year)
        : `${pageStart} – ${Math.min(pageStart + YEARS_PER_PAGE - 1, MAX_YEAR)}`;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={`${label}, ${display ?? "not set"}`}
        onClick={() => (isOpen ? close(false) : open())}
        className={cn(
          "group border-input bg-background flex h-9 min-w-0 items-center gap-2 rounded-lg border px-2.5 text-sm outline-none",
          "focus-visible:border-foreground aria-expanded:border-foreground pointer-coarse:min-h-11",
          className,
        )}
      >
        <CalendarDays className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
        <span className={cn("flex-1 truncate text-left", !display && "text-muted-foreground")}>
          {display ?? DATE_PLACEHOLDER}
        </span>
        <ChevronDown
          className="text-muted-foreground size-4 shrink-0 transition-transform duration-150 group-aria-expanded:rotate-180 motion-reduce:transition-none"
          aria-hidden="true"
        />
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={(node) => {
              panelRef.current = node;
              place(node);
            }}
            role="dialog"
            aria-label={`Choose ${label.toLowerCase()}`}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                close(true);
              }
            }}
            className="bg-popover text-popover-foreground fixed z-80 rounded-lg border p-3 shadow-[0_8px_30px_rgb(0_0_0/0.16)]"
          >
            <div className="mb-2 flex items-center justify-between gap-1.5">
              <NavButton label="Previous" disabled={!canGoBack} onClick={() => move(-1)}>
                <ChevronLeft className="size-4" />
              </NavButton>
              {/* The title walks up from days to months to years, and back to days */}
              <button
                type="button"
                onClick={() => setView({ day: "month", month: "year", year: "day" }[view] as View)}
                aria-label={`${title}, choose a ${view === "day" ? "month" : view === "month" ? "year" : "day"}`}
                className="hover:bg-muted flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-semibold whitespace-nowrap"
              >
                {title}
                <ChevronsUpDown className="text-muted-foreground size-3.5" aria-hidden="true" />
              </button>
              <NavButton label="Next" disabled={!canGoForward} onClick={() => move(1)}>
                <ChevronRight className="size-4" />
              </NavButton>
            </div>

            {view === "day" && (
              <DayGrid
                shown={shown}
                selected={value}
                focused={focused}
                onPick={pick}
                onKeyDown={onGridKeyDown}
              />
            )}

            {view === "month" && (
              <div className="grid grid-cols-3 gap-1">
                {Array.from({ length: 12 }, (_, month) => (
                  <Cell
                    key={month}
                    isSelected={selected?.year === shown.year && selected.month === month}
                    onClick={() => {
                      // Picking a month walks back down to its days
                      const day = parseIsoDate(focused)?.day ?? 1;
                      setShown({ year: shown.year, month });
                      setFocused(isoDate(shown.year, month, Math.min(day, daysIn(shown.year, month))));
                      setView("day");
                    }}
                  >
                    {MONTH_NAME.format(utc(shown.year, month))}
                  </Cell>
                ))}
              </div>
            )}

            {view === "year" && (
              <div className="grid grid-cols-3 gap-1">
                {Array.from({ length: YEARS_PER_PAGE }, (_, index) => pageStart + index).map((year) => (
                  <Cell
                    key={year}
                    disabled={!inRange(year)}
                    isSelected={selected?.year === year}
                    onClick={() => {
                      // Picking a year walks back down to its months
                      setShown({ year, month: shown.month });
                      setView("month");
                    }}
                  >
                    {year}
                  </Cell>
                ))}
              </div>
            )}

            <div className="mt-2 flex justify-between border-t pt-2">
              <button type="button" onClick={() => pick(localDate())} className="hover:bg-muted rounded-lg px-2 py-1 text-xs font-medium">
                Today
              </button>
              {value && (
                <button
                  type="button"
                  onClick={() => pick(null)}
                  className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-lg px-2 py-1 text-xs font-medium"
                >
                  Clear
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function NavButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      // At the edge of the range the arrow visibly cannot be used, rather than doing nothing
      className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-lg p-1.5 disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  );
}

/** A month or a year. Cells are marks, not surfaces, so they take a 4px corner. */
function Cell({
  isSelected,
  disabled,
  onClick,
  children,
}: {
  isSelected: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={isSelected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-[4px] py-2 text-[0.8rem] disabled:text-muted-foreground disabled:pointer-events-none pointer-coarse:py-3",
        isSelected ? "bg-primary text-primary-foreground font-bold" : "hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

type DayGridProps = {
  shown: Shown;
  selected: string | null;
  focused: string;
  onPick: (iso: string) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
};

/** The days of one month, starting on the locale's first day of the week. */
function DayGrid({ shown, selected, focused, onPick, onKeyDown }: DayGridProps) {
  const firstDay = firstDayOfWeek();
  const today = localDate();
  const lead = (utc(shown.year, shown.month).getUTCDay() - firstDay + 7) % 7;
  const days: (number | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: daysIn(shown.year, shown.month) }, (_, index) => index + 1),
  ];
  const rows = Array.from({ length: Math.ceil(days.length / 7) }, (_, row) => days.slice(row * 7, row * 7 + 7));
  // The focused day takes Tab into the grid; once the arrows show another month, its first day does
  const focusedDay = parseIsoDate(focused);
  const tabbable =
    focusedDay?.year === shown.year && focusedDay.month === shown.month ? focused : isoDate(shown.year, shown.month, 1);
  // 1 January 2023 was a Sunday, so it and the days after it name every column
  const columns = Array.from({ length: 7 }, (_, index) => utc(2023, 0, 1 + ((firstDay + index) % 7)));

  return (
    <div role="grid" aria-label={MONTH_TITLE.format(utc(shown.year, shown.month))} onKeyDown={onKeyDown}>
      <div role="row" className="grid grid-cols-7 gap-0.5">
        {columns.map((date) => (
          <div
            key={date.getTime()}
            role="columnheader"
            aria-label={DAY_NAME_LONG.format(date)}
            className="text-muted-foreground py-1 text-center text-[0.66rem] font-semibold"
          >
            {DAY_NAME.format(date)}
          </div>
        ))}
      </div>
      {rows.map((week, row) => (
        <div key={row} role="row" className="grid grid-cols-7 gap-0.5">
          {week.map((day, column) => {
            if (day === null) return <div key={column} role="gridcell" />;
            const iso = isoDate(shown.year, shown.month, day);
            return (
              <button
                key={column}
                type="button"
                role="gridcell"
                data-date={iso}
                tabIndex={iso === tabbable ? 0 : -1}
                aria-selected={iso === selected}
                aria-current={iso === today ? "date" : undefined}
                aria-label={FULL_DATE.format(utc(shown.year, shown.month, day))}
                onClick={() => onPick(iso)}
                className={cn(
                  "rounded-[4px] py-1.5 text-center text-[0.8rem] outline-none pointer-coarse:py-2.5",
                  "focus-visible:outline-foreground focus-visible:outline-2 focus-visible:-outline-offset-2",
                  iso === selected
                    ? "bg-primary text-primary-foreground font-bold"
                    : cn("hover:bg-muted", iso === today && "ring-foreground/40 font-semibold ring-1 ring-inset"),
                )}
              >
                {day}
              </button>
            );
          })}
          {Array.from({ length: 7 - week.length }, (_, index) => (
            <div key={`pad-${index}`} role="gridcell" />
          ))}
        </div>
      ))}
    </div>
  );
}
