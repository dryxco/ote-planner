"use client";

import { useState } from "react";
import { OTHER_ID, PALETTE, useSync } from "@/lib/store";
import { useUI } from "@/lib/ui";
import { useNow } from "@/lib/hooks";
import { DAY, fmtDuration, fmtTime, logicalDate, relativeDayLabel, startOfMonth } from "@/lib/time";
import { actualTime, periodEnd, periodRange, periodStart } from "@/lib/stats";
import type { Activity } from "@/lib/types";
import { ChevronRight, PlusIcon } from "@/components/icons";
import { TabHeader } from "@/components/period";
import { BigButton, ColorDots, Footnote, Group, PopupSelect, Row, SectionTitle, Sheet, TextField, Toggle, cx } from "@/components/ui";
import { REMINDER_OPTIONS } from "@/components/EntrySheet";

/** Row height (px) — drag distance per position when reordering. */
const ROW = 50;

type Target = { mode: "new" } | { mode: "edit"; id: string };

export function ActivitiesView() {
  const now = useNow();
  const { activities, actuals, updateActivity, deleteActivity, reorderActivities } = useSync();
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState<Target | null>(null);

  const ordered = [...activities].sort((a, b) => a.order - b.order);
  // drag to reorder: grab a row's handle; the list shows the new order live, "Other" stays last
  const [drag, setDrag] = useState<{ id: string; from: number; dy: number } | null>(null);
  const movable = ordered.filter((a) => a.id !== OTHER_ID).length;
  const dragTo = drag ? Math.max(0, Math.min(movable - 1, drag.from + Math.round(drag.dy / ROW))) : -1;
  // Rows never change DOM order while dragging (moving the grabbed node drops the pointer stream):
  // the grabbed row follows the pointer and the rows it passes slide one row up / down.
  const shiftOf = (id: string, k: number) => {
    if (!drag) return 0;
    if (id === drag.id) return drag.dy;
    if (drag.from < dragTo && k > drag.from && k <= dragTo) return -ROW;
    if (dragTo < drag.from && k >= dragTo && k < drag.from) return ROW;
    return 0;
  };
  const sorted = ordered;
  const ids = sorted.map((a) => a.id);
  const grab = (id: string) => (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const from = ordered.findIndex((a) => a.id === id); // by id, never by a rendered index
    if (from < 0) return;
    const y0 = e.clientY;
    let dy = 0;
    setDrag({ id, from, dy });
    // listen on the window: the stream survives re-renders and pointers leaving the handle
    const move = (ev: PointerEvent) => {
      dy = ev.clientY - y0;
      setDrag({ id, from, dy });
    };
    const end = (commit: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      setDrag(null);
      const to = Math.max(0, Math.min(movable - 1, from + Math.round(dy / ROW)));
      if (commit && to !== from) {
        const next = ordered.map((a) => a.id).filter((x) => x !== id);
        next.splice(to, 0, id);
        reorderActivities(next);
      }
    };
    const onUp = () => end(true);
    const onCancel = () => end(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  };
  const move = (i: number, d: -1 | 1) => {
    const next = [...ids];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    reorderActivities(next);
  };

  return (
    <div className="flex h-full flex-col pt-[max(8px,env(safe-area-inset-top))]">
      <TabHeader
        title="Activities"
        right={
          <button
            onClick={() => setEditing((e) => !e)}
            className="rounded-full border border-fg/10 bg-fg/[0.06] px-3.5 py-1.5 text-[15px] underline underline-offset-2"
          >
            {editing ? "Done" : "Edit"}
          </button>
        }
      />
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(var(--tabbar-h)+48px)] pt-6">
        <div className="overflow-hidden rounded-[18px] bg-surface">
          {sorted.map((a, i) => {
            const isOther = a.id === OTHER_ID;
            const lifted = drag?.id === a.id;
            const shift = shiftOf(a.id, i);
            const liftStyle: React.CSSProperties | undefined = drag
              ? { transform: `translateY(${shift}px)`, zIndex: lifted ? 10 : undefined, transition: lifted ? "none" : "transform 150ms ease" }
              : undefined;
            const handle = !isOther && (
              <span
                data-reorder={a.id}
                role="button"
                aria-label={`Reorder ${a.name}`}
                onPointerDown={grab(a.id)}
                onClick={(e) => e.stopPropagation()}
                className="flex h-[50px] w-8 shrink-0 cursor-grab touch-none items-center justify-center text-fg/30 active:cursor-grabbing"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M5 8h14M5 12h14M5 16h14" />
                </svg>
              </span>
            );
            const recent = actualTime(actuals, now - 7 * DAY, now, a.id);
            const before = actualTime(actuals, now - 14 * DAY, now - 7 * DAY, a.id);
            if (editing)
              return (
                <EditRow
                  key={a.id}
                  style={liftStyle}
                  lifted={lifted}
                  handle={handle}
                  activity={a}
                  canUp={!isOther && i > 0}
                  canDown={!isOther && i < sorted.length - 1 && sorted[i + 1].id !== OTHER_ID}
                  onUp={() => move(i, -1)}
                  onDown={() => move(i, 1)}
                  onRename={(name) => updateActivity(a.id, { name })}
                  onDelete={isOther ? undefined : () => deleteActivity(a.id)}
                />
              );
            return (
              <div
                key={a.id}
                data-activity-row={a.id}
                role="button"
                tabIndex={0}
                onClick={() => setTarget({ mode: "edit", id: a.id })}
                onKeyDown={(e) => e.key === "Enter" && setTarget({ mode: "edit", id: a.id })}
                style={liftStyle}
                className={cx("relative flex min-h-[50px] w-full cursor-pointer items-center gap-2 pl-1 pr-4 text-left", lifted && "bg-surface-2 shadow-xl")}
              >
                {handle || <span className="w-8 shrink-0" />}
                <span className="h-[9px] w-[9px] shrink-0 rounded-full" style={{ background: a.color }} />
                <span
                  className={cx(
                    "flex min-h-[50px] flex-1 items-center gap-2 border-b border-fg/[0.08] text-[15.5px]",
                    isOther && "text-fg/60",
                  )}
                >
                  <span className="flex-1 truncate">{a.name}</span>
                  {recent > 0 && (
                    <span className="flex flex-col items-end leading-tight">
                      <span className="text-[11.5px] text-fg/60 tabular">{fmtDuration(recent)}</span>
                      {before > 0 && <span className="text-[9.5px] text-fg/35 tabular">Last week {fmtDuration(before)}</span>}
                    </span>
                  )}
                  <ChevronRight size={14} className="text-fg/35" />
                </span>
              </div>
            );
          })}
          <button onClick={() => setTarget({ mode: "new" })} className="flex h-[50px] w-full items-center gap-3 px-4 text-[15px] text-link">
            <PlusIcon size={18} className="-ml-0.5" />
            Add activity
          </button>
        </div>
        <p className="mt-2 px-1 text-[11.5px] text-fg/50">Time is from the last 7 days of actuals.</p>
      </div>

      {target && <ActivitySheet key={target.mode === "edit" ? target.id : "new"} target={target} onClose={() => setTarget(null)} />}
    </div>
  );
}

function EditRow({
  style,
  lifted,
  handle,
  activity,
  canUp,
  canDown,
  onUp,
  onDown,
  onRename,
  onDelete,
}: {
  style?: React.CSSProperties;
  lifted?: boolean;
  handle?: React.ReactNode;
  activity: Activity;
  canUp: boolean;
  canDown: boolean;
  onUp: () => void;
  onDown: () => void;
  onRename: (name: string) => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(activity.name);
  // deleting takes two taps (the drag handle sits right next to this button)
  const [arm, setArm] = useState(false);
  const commit = () => {
    const n = name.trim();
    if (n && n !== activity.name) onRename(n);
    else setName(activity.name);
  };
  return (
    <div style={style} className={cx("relative flex min-h-[50px] items-center gap-2 pl-1 pr-4", lifted && "bg-surface-2 shadow-xl")}>
      {handle || <span className="w-8 shrink-0" />}
      {onDelete ? (
        arm ? (
          <button
            aria-label={`Confirm delete ${activity.name}`}
            onClick={onDelete}
            onBlur={() => setArm(false)}
            autoFocus
            className="h-[24px] shrink-0 rounded-full bg-[#ff453a] px-2.5 text-[12px] font-semibold text-white"
          >
            Delete
          </button>
        ) : (
          <button
            aria-label={`Delete ${activity.name}`}
            onClick={() => setArm(true)}
            className="ml-1 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[#ff453a]"
          >
            <span className="h-[2px] w-[10px] rounded bg-white" />
          </button>
        )
      ) : (
        <span className="w-[22px] shrink-0" />
      )}
      <span className="h-[9px] w-[9px] shrink-0 rounded-full" style={{ background: activity.color }} />
      <div className="flex min-h-[50px] flex-1 items-center gap-1 border-b border-fg/[0.08]">
        <input
          aria-label="Activity name"
          value={name}
          disabled={activity.id === OTHER_ID}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className="min-w-0 flex-1 bg-transparent text-[15.5px] outline-none disabled:text-fg/60"
        />
        <ArrowButton label="Move up" disabled={!canUp} onClick={onUp} d="M6 15l6-6 6 6" />
        <ArrowButton label="Move down" disabled={!canDown} onClick={onDown} d="M6 9l6 6 6-6" />
      </div>
    </div>
  );
}

function ArrowButton({ label, disabled, onClick, d }: { label: string; disabled: boolean; onClick: () => void; d: string }) {
  return (
    <button aria-label={label} disabled={disabled} onClick={onClick} className="flex h-8 w-8 items-center justify-center text-fg/70 disabled:opacity-20">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
      </svg>
    </button>
  );
}

const ACTIVITY_REMINDERS = REMINDER_OPTIONS.filter((o) => o.value !== "activity") as { value: Activity["reminder"]; label: string }[];

function ActivitySheet({ target, onClose }: { target: Target; onClose: () => void }) {
  const now = useNow();
  const { activities, actuals, settings, addActivity, updateActivity, deleteActivity } = useSync();
  const openEntry = useUI((s) => s.openEntry);
  const existing = target.mode === "edit" ? activities.find((a) => a.id === target.id) : undefined;
  const [name, setName] = useState(existing?.name ?? "");
  const [color, setColor] = useState(existing?.color ?? PALETTE[2]);
  const [reminder, setReminder] = useState<Activity["reminder"]>(existing?.reminder ?? settings.defaultReminder);
  const [endConfirmation, setEndConfirmation] = useState(existing?.endConfirmation ?? settings.defaultEndConfirmation);

  const save = () => {
    const patch = { name: name.trim(), color, reminder, endConfirmation };
    if (existing) updateActivity(existing.id, patch);
    else addActivity(patch);
    onClose();
  };

  const today = logicalDate(now, settings.dayStart);
  const total = (kind: "week" | "month") => {
    const s = kind === "week" ? periodStart("week", today, settings.weekStartsOn) : startOfMonth(today);
    const [from, to] = periodRange(s, periodEnd(kind, s), settings.dayStart);
    return existing ? actualTime(actuals, from, to, existing.id) : 0;
  };
  const recent = existing
    ? actuals
        .filter((a) => a.activityId === existing.id && a.start < now)
        .sort((a, b) => b.start - a.start)
        .slice(0, 20)
    : [];

  return (
    <Sheet
      title={existing ? existing.name : "New activity"}
      onCancel={onClose}
      onSave={save}
      saveLabel={existing ? "Save" : "Add"}
      saveDisabled={!name.trim()}
    >
      <Group>
        <TextField value={name} onChange={setName} placeholder="Name" autoFocus={!existing} />
        {/* free palette colors (not worn by another activity), plus this activity's own */}
        <ColorDots
          colors={[
            ...new Set([
              ...(existing ? [existing.color.toLowerCase()] : []),
              ...PALETTE.filter((c) => !activities.some((a) => a.id !== existing?.id && a.color.toLowerCase() === c.toLowerCase())),
            ]),
          ]}
          value={color}
          onChange={setColor}
        />
      </Group>

      <SectionTitle>Defaults for its plans</SectionTitle>
      <Group>
        <Row label="Reminder">
          <PopupSelect tone="plain" value={reminder} options={ACTIVITY_REMINDERS} onChange={setReminder} />
        </Row>
        <Row label="End confirmation">
          <Toggle checked={endConfirmation} onChange={setEndConfirmation} />
        </Row>
      </Group>
      <Footnote>Plans set to “Activity default” use these.</Footnote>

      {existing && (
        <>
          <SectionTitle>Time</SectionTitle>
          <Group>
            <Row label="This week">
              <span className="text-fg/60 tabular">{fmtDuration(total("week"))}</span>
            </Row>
            <Row label="This month">
              <span className="text-fg/60 tabular">{fmtDuration(total("month"))}</span>
            </Row>
          </Group>

          <SectionTitle>Recent actuals</SectionTitle>
          {recent.length === 0 ? (
            <Footnote>No actuals yet.</Footnote>
          ) : (
            <Group>
              {recent.map((a) => (
                <Row key={a.id} label={<span className="block max-w-[150px] truncate">{a.name || existing.name}</span>} onClick={() => openEntry({ mode: "edit", kind: "actual", id: a.id })}>
                  <span className="truncate text-[13px] text-fg/50 tabular">
                    {relativeDayLabel(a.start, now)} · {fmtTime(a.start)} · {fmtDuration(a.end - a.start)}
                  </span>
                  <ChevronRight size={13} className="shrink-0 text-fg/35" />
                </Row>
              ))}
            </Group>
          )}

          {existing.id !== OTHER_ID && (
            <div className="mt-6">
              <BigButton
                tone="danger"
                onClick={() => {
                  deleteActivity(existing.id);
                  onClose();
                }}
              >
                Delete activity
              </BigButton>
              <Footnote>Its plans and actuals are kept and move to “Other”.</Footnote>
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}
