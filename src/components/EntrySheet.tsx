"use client";

import { TimePicker } from "./TimePicker";
import { DatePicker } from "./DatePicker";
import { loadWritableCalendars, useCalendarLabel } from "@/lib/writable-calendars";
import { useFinePointer, useIsDesktop } from "@/lib/media";

import { useEffect, useMemo, useState } from "react";
import type { CalendarInfo, Plan, ReminderOption, EndConfirmOption, Repeat, Todo } from "@/lib/types";
import { OTHER_ID, activityOf, branchSort, useSync } from "@/lib/store";
import { useUI, type EntryKind, type EntryTarget } from "@/lib/ui";
import { expandPlans, isOccurrenceKept, parseOccurrenceKey } from "@/lib/plans";
import {
  HOUR,
  MIN,
  addDays,
  floorTo,
  fmtDuration,
  fmtMinutesOfDay,
  fmtTime,
  fromInputs,
  logicalDate,
  logicalDayRange,
  relativeDayLabel,
  startOfDay,
  toDateInput,
  toTimeInput,
} from "@/lib/time";
import {
  BigButton,
  ColorDots,
  Footnote,
  Group,
  PopupSelect,
  Row,
  SectionTitle,
  Segmented,
  Sheet,
  TextField,
  Toggle,
  cx,
} from "./ui";
import { BranchIcon, CheckIcon, ChevronDownIcon, ChevronUpIcon, PauseIcon, PlayIcon, SmallCalIcon, XIcon } from "./icons";

const REPEAT_OPTIONS: { value: Repeat; label: string }[] = [
  { value: "never", label: "Never" },
  { value: "daily", label: "Every day" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly", label: "Every week" },
  { value: "monthly", label: "Every month" },
];

export const REMINDER_OPTIONS: { value: ReminderOption; label: string }[] = [
  { value: "activity", label: "Activity default" },
  { value: "none", label: "None" },
  { value: "atStart", label: "At start" },
  { value: "5m", label: "5 min before" },
  { value: "10m", label: "10 min before" },
  { value: "30m", label: "30 min before" },
  { value: "1h", label: "1 hour before" },
];

const END_CONFIRM_OPTIONS: { value: EndConfirmOption; label: string }[] = [
  { value: "activity", label: "Activity default" },
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];

const DURATIONS = [1, 15, 30, 45, 60, 90, 120, 180, 240, 360, 480].map((m) => ({ value: m, label: fmtDuration(m * MIN) }));

interface Form {
  kind: EntryKind;
  name: string;
  activityId: string;
  color: string;
  place: string;
  allDay: boolean;
  start: number;
  end: number;
  repeat: Repeat;
  reminder: ReminderOption;
  endConfirmation: EndConfirmOption;
  planKey?: string;
  sourceEventId?: string;
  /** plan saved to a real calendar ("" = Ote only) */
  calendarId: string;
  // todo
  hasDate: boolean;
  todoDate: number;
  hasTime: boolean;
  todoTime: number;
  hasEnd: boolean;
  todoEnd: number;
  hasDeadline: boolean;
  deadline: number;
  /** project ("" = none) */
  campaignId: string;
  note: string;
}

export function EntrySheet({ target }: { target: EntryTarget }) {
  const store = useSync();
  const customPickers = useCustomPickers();
  const { plans, actuals, todos, activities, settings } = store;
  const close = useUI((s) => s.closeEntry);
  const [now] = useState(() => Date.now());

  const initial = useMemo<Form>(() => {
    const other = activityOf(activities, OTHER_ID);
    const base: Form = {
      kind: "plan",
      name: "",
      activityId: other.id,
      color: other.color,
      place: "",
      allDay: false,
      start: floorTo(now, 30) + 30 * MIN,
      end: floorTo(now, 30) + 90 * MIN,
      repeat: "never",
      reminder: "activity",
      endConfirmation: "activity",
      hasDate: true,
      todoDate: startOfDay(now),
      hasTime: false,
      todoTime: 9 * 60,
      hasEnd: false,
      todoEnd: 10 * 60,
      calendarId: "",
      hasDeadline: false,
      deadline: addDays(startOfDay(now), 1),
      campaignId: "",
      note: "",
    };
    if (target.mode === "new") {
      const f: Form = { ...base, kind: target.kind };
      if (target.start !== undefined) f.start = target.start;
      if (target.end !== undefined) f.end = target.end;
      // a range picked on the timeline carries over if you switch to To-dos: same day, time and end
      if (target.start !== undefined) {
        const day = startOfDay(target.start);
        const t = Math.round((target.start - day) / MIN);
        Object.assign(f, { hasDate: true, todoDate: day, hasTime: true, todoTime: t });
        if (target.end !== undefined && target.end - target.start > MIN) {
          Object.assign(f, { hasEnd: true, todoEnd: (t + Math.round((target.end - target.start) / MIN)) % (24 * 60) });
        }
      }
      if (target.fromEvent) {
        const e = target.fromEvent;
        f.name = e.title;
        f.place = e.location ?? "";
        f.allDay = e.allDay;
        f.start = e.start;
        f.end = e.end;
        f.sourceEventId = e.id;
        if (e.color) f.color = e.color; // start with the calendar's own color
      }
      if (target.fromPlan) {
        const p = plans.find((x) => x.id === parseOccurrenceKey(target.fromPlan!).planId);
        if (p) Object.assign(f, { planKey: target.fromPlan, name: p.name, activityId: p.activityId, color: p.color });
      }
      if (target.kind === "todo" && target.date !== undefined) f.todoDate = target.date;
      return f;
    }
    if (target.kind === "plan") {
      const p = plans.find((x) => x.id === target.id);
      if (!p) return base;
      const dur = p.end - p.start;
      return {
        ...base,
        kind: "plan",
        name: p.name,
        activityId: p.activityId,
        color: p.color,
        place: p.place ?? "",
        allDay: p.allDay,
        start: target.occurrenceStart,
        end: target.occurrenceStart + dur,
        repeat: p.repeat,
        reminder: p.reminder,
        endConfirmation: p.endConfirmation,
        sourceEventId: p.sourceEventId,
        calendarId: p.calendar?.calendarId ?? "",
      };
    }
    if (target.kind === "actual") {
      const a = actuals.find((x) => x.id === target.id);
      if (!a) return base;
      return { ...base, kind: "actual", name: a.name, activityId: a.activityId, color: a.color, start: a.start, end: a.end, planKey: a.planKey, sourceEventId: a.sourceEventId };
    }
    const t = todos.find((x) => x.id === target.id);
    if (!t) return base;
    return {
      ...base,
      kind: "todo",
      name: t.name,
      activityId: t.activityId,
      color: t.color,
      hasDate: t.date !== undefined,
      todoDate: t.date ?? startOfDay(now),
      hasTime: t.time !== undefined,
      todoTime: t.time ?? 9 * 60,
      hasEnd: t.time !== undefined && !!t.duration,
      todoEnd: ((t.time ?? 9 * 60) + (t.duration || 60)) % (24 * 60),
      hasDeadline: t.deadline !== undefined,
      deadline: t.deadline ?? addDays(startOfDay(now), 1),
      campaignId: t.campaignId ?? "",
      note: t.note ?? "",
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [f, setF] = useState<Form>(initial);
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const set = (patch: Partial<Form>) => {
    setError(null);
    setF((x) => ({ ...x, ...patch }));
  };

  const isNew = target.mode === "new";
  const editingPlan = target.mode === "edit" && target.kind === "plan" ? plans.find((p) => p.id === target.id) : undefined;
  const act = activityOf(activities, f.activityId);
  const kind = f.kind;

  const title = isNew
    ? kind === "plan"
      ? "Add plan"
      : kind === "actual"
        ? "Add actual"
        : "Add to-do"
    : kind === "todo"
      ? "To-do"
      : `${kind === "plan" ? "Plan" : "Actual"} · ${act.name}`;

  const duration = f.end - f.start;

  function setStart(t: number) {
    set({ start: t, end: t + Math.max(duration, MIN) });
  }

  function save() {
    const name = f.name.trim();
    if (kind === "plan") {
      if (!f.allDay && f.end <= f.start) return setError("End must be after start.");
      let start = f.start;
      let end = f.end;
      if (f.allDay) {
        start = startOfDay(f.start);
        end = Math.max(addDays(startOfDay(f.end - 1), 1), addDays(start, 1));
      }
      const data: Omit<Plan, "id" | "createdAt"> = {
        name,
        activityId: f.activityId,
        color: f.color,
        place: f.place.trim() || undefined,
        allDay: f.allDay,
        start,
        end,
        repeat: f.repeat,
        reminder: f.reminder,
        endConfirmation: f.endConfirmation,
        sourceEventId: f.sourceEventId,
        // keep the event id while it stays on the same calendar (the server moves it otherwise)
        calendar: f.calendarId
          ? { calendarId: f.calendarId, ...(editingPlan?.calendar?.eventId ? { eventId: editingPlan.calendar.eventId } : {}) }
          : undefined,
      };
      if (editingPlan && target.mode === "edit" && target.kind === "plan") {
        // For a repeating series the edited occurrence shifts the whole series by the same delta.
        const delta = start - target.occurrenceStart;
        const patch: Partial<Plan> =
          editingPlan.repeat !== "never" && f.repeat !== "never"
            ? { ...data, start: editingPlan.start + delta, end: editingPlan.start + delta + (end - start) }
            : data;
        store.updatePlan(editingPlan.id, patch);
      } else {
        const id = store.addPlan(data);
        for (const t of pendingTodos) store.addTodo({ name: t, activityId: f.activityId, color: f.color, planId: id, date: startOfDay(start) });
      }
    } else if (kind === "actual") {
      if (f.end <= f.start) return setError("End must be after start.");
      const todayEnd = logicalDayRange(logicalDate(now, settings.dayStart), settings.dayStart)[1];
      if (f.start >= todayEnd) return setError("Actuals can only be recorded for past days and today.");
      const data = { name, activityId: f.activityId, color: f.color, start: f.start, end: f.end, planKey: f.planKey, sourceEventId: f.sourceEventId };
      if (target.mode === "edit") {
        store.updateActual(target.id, data);
        // a pomodoro session's to-do follows its name
        const linked = store.actuals.find((x) => x.id === target.id)?.todoId;
        if (linked && data.name) store.updateTodo(linked, { name: data.name });
      }
      else store.addActual(data);
    } else {
      if (!name) return setError("Name your to-do.");
      const data = {
        name,
        activityId: f.activityId,
        color: f.color,
        date: f.hasDate ? startOfDay(f.todoDate) : undefined,
        time: f.hasDate && f.hasTime ? f.todoTime : undefined,
        duration: f.hasDate && f.hasTime && f.hasEnd ? (f.todoEnd - f.todoTime + 24 * 60) % (24 * 60) || undefined : undefined,
        deadline: f.hasDeadline ? f.deadline : undefined,
        campaignId: f.campaignId || undefined,
        note: f.note.trim() ? f.note : undefined,
      };
      if (target.mode === "edit") store.updateTodo(target.id, data);
      else store.addTodo(data);
    }
    close();
  }

  // to-dos typed while creating a new plan are attached after it is saved
  const [pendingTodos, setPendingTodos] = useState<string[]>([]);
  const [todoDraft, setTodoDraft] = useState("");
  const planTodos = editingPlan ? todos.filter((t) => t.planId === editingPlan.id) : [];

  function addPlanTodo() {
    const n = todoDraft.trim();
    if (!n) return;
    if (editingPlan) store.addTodo({ name: n, activityId: editingPlan.activityId, color: editingPlan.color, planId: editingPlan.id, date: startOfDay(f.start) });
    else setPendingTodos((x) => [...x, n]);
    setTodoDraft("");
  }

  const canSave = kind !== "todo" || f.name.trim().length > 0;

  return (
    <Sheet title={title} onCancel={close} onSave={save} saveDisabled={!canSave}>
      {target.mode === "new" && target.fromEvent && <FromCalendar event={target.fromEvent} />}
      {isNew && (
        <Group className="mb-5 bg-transparent">
          <Segmented
            value={kind}
            onChange={(k) => set({ kind: k })}
            options={[
              { value: "plan", label: "Plan" },
              { value: "actual", label: "Actual" },
              { value: "todo", label: "To-dos" },
            ]}
          />
        </Group>
      )}

      {kind === "actual" && (
        <>
          <Group>
            <Row label={<span className="text-link">Record from a plan</span>} onClick={() => setChoosing(true)}>
              <span className="truncate text-link/80">{f.planKey ? planLabel(f.planKey) : "Choose"}</span>
            </Row>
          </Group>
          <Footnote>Records a plan you scheduled for another time at this hour. That plan is closed as kept.</Footnote>
        </>
      )}

      <Group className="mb-5">
        <div className="relative">
          <TextField value={f.name} onChange={(v) => set({ name: v })} placeholder="Name" autoFocus={isNew && kind === "todo"} />
            </div>
        {/* the activity picker itself is the row (no "Activity" caption), on the left */}
        <Row label={
          <PopupSelect
            value={f.activityId}
            options={activities.filter((a) => !a.archived).map((a) => ({ value: a.id, label: a.name }))}
            onChange={(id) => set({ activityId: id, color: activityOf(activities, id).color })}
          />
        } />
        <ColorDots
          // only the activities' current colors (a recolored activity's old color is gone); any other via the custom dot
          colors={[...new Set(activities.filter((a) => !a.archived).map((a) => a.color.toLowerCase()))]}
          value={f.color}
          onChange={(c) => {
            // colors and activities are linked both ways: a color owned by an activity selects it
            const match = activities.find((x) => !x.archived && x.color.toLowerCase() === c.toLowerCase());
            set(match ? { color: c, activityId: match.id } : { color: c });
          }}
        />
        {kind === "plan" && (
          <input
            value={f.place}
            onChange={(e) => set({ place: e.target.value })}
            placeholder="Place"
            className="h-[46px] w-full border-t border-fg/[0.08] bg-transparent px-4 text-[15px] outline-none placeholder:text-fg/30"
          />
        )}
        {/* a plan made from an existing calendar event is already on that calendar */}
        {kind === "plan" && !(f.sourceEventId && !f.calendarId) && (
          <CalendarRow value={f.calendarId} onChange={(calendarId) => set({ calendarId })} repeating={f.repeat !== "never"} />
        )}
      </Group>

      {kind !== "todo" ? (
        <>
          <Group>
            {kind === "plan" && (
              <Row label="All day">
                <Toggle checked={f.allDay} onChange={(v) => set({ allDay: v })} />
              </Row>
            )}
            <Row label="Start">
              <DateTimePill value={f.start} allDay={f.allDay} now={now} onChange={setStart} />
            </Row>
            <Row label="End">
              <DateTimePill value={f.end} allDay={f.allDay} now={now} onChange={(t) => set({ end: t })} />
              {!f.allDay && (
                <PopupSelect
                  tone="plain"
                  value={DURATIONS.some((d) => d.value * MIN === duration) ? duration / MIN : -1}
                  options={[
                    ...(DURATIONS.some((d) => d.value * MIN === duration) ? [] : [{ value: -1, label: duration > 0 ? fmtDuration(duration) : "—" }]),
                    ...DURATIONS,
                  ]}
                  onChange={(m) => m > 0 && set({ end: f.start + m * MIN })}
                />
              )}
            </Row>
          </Group>
          <Footnote>
            {kind === "plan"
              ? "Moving the end two or more days out makes it a multi-day event."
              : "Actuals can only be recorded for past days and today."}
          </Footnote>
        </>
      ) : (
        <>
          <Group>
            <Row label="Date">
              {f.hasDate && customPickers && (
                <DatePicker label="Date" value={f.todoDate} weekStartsOn={settings.weekStartsOn} onChange={(d) => set({ todoDate: d })} />
              )}
              {f.hasDate && !customPickers && (
                <input
                  type="date"
                  onClick={openPicker}
                  className="pill-input"
                  value={toDateInput(f.todoDate)}
                  onChange={(e) => e.target.value && set({ todoDate: fromInputs(e.target.value, "00:00") })}
                />
              )}
              <Toggle checked={f.hasDate} onChange={(v) => set({ hasDate: v, hasTime: v && f.hasTime })} />
            </Row>
            <Row label="Time">
              {f.hasTime && customPickers ? (
                <TimePicker
                  label="Time"
                  value={f.todoTime}
                  onChange={(t) => {
                    const len = (f.todoEnd - f.todoTime + 24 * 60) % (24 * 60) || 60;
                    set({ todoTime: t, todoEnd: (t + len) % (24 * 60) });
                  }}
                />
              ) : f.hasTime ? (
                <input
                  type="time"
                  onClick={openPicker}
                  className="pill-input"
                  value={`${String(Math.floor(f.todoTime / 60)).padStart(2, "0")}:${String(f.todoTime % 60).padStart(2, "0")}`}
                  onChange={(e) => {
                    const [h, m] = e.target.value.split(":").map(Number);
                    if (Number.isNaN(h)) return;
                    const t = h * 60 + (m || 0);
                    // moving the start keeps the length, like a plan
                    const len = (f.todoEnd - f.todoTime + 24 * 60) % (24 * 60) || 60;
                    set({ todoTime: t, todoEnd: (t + len) % (24 * 60) });
                  }}
                />
              ) : (
                <span className="pill-input text-fg/80">None</span>
              )}
              <Toggle checked={f.hasTime} disabled={!f.hasDate} onChange={(v) => set({ hasTime: v, hasEnd: v && f.hasEnd })} />
            </Row>
            {f.hasTime && (
              <Row label="End">
                {f.hasEnd && customPickers ? (
                  <TimePicker label="End time" value={f.todoEnd} onChange={(t) => set({ todoEnd: t })} />
                ) : f.hasEnd ? (
                  <input
                    type="time"
                    onClick={openPicker}
                    aria-label="End time"
                    className="pill-input"
                    value={`${String(Math.floor(f.todoEnd / 60)).padStart(2, "0")}:${String(f.todoEnd % 60).padStart(2, "0")}`}
                    onChange={(e) => {
                      const [h, m] = e.target.value.split(":").map(Number);
                      if (!Number.isNaN(h)) set({ todoEnd: h * 60 + (m || 0) });
                    }}
                  />
                ) : (
                  <span className="pill-input text-fg/80">None</span>
                )}
                <Toggle
                  checked={f.hasEnd}
                  onChange={(v) => set(v ? { hasEnd: true, todoEnd: (f.todoTime + 60) % (24 * 60) } : { hasEnd: false })}
                />
              </Row>
            )}
            <Row label="Deadline">
              {f.hasDeadline && customPickers && (
                <DatePicker label="Deadline" value={f.deadline} weekStartsOn={settings.weekStartsOn} onChange={(d) => set({ deadline: d })} />
              )}
              {f.hasDeadline && !customPickers && (
                <input
                  type="date"
                  onClick={openPicker}
                  className="pill-input"
                  value={toDateInput(f.deadline)}
                  onChange={(e) => e.target.value && set({ deadline: fromInputs(e.target.value, "00:00") })}
                />
              )}
              <Toggle checked={f.hasDeadline} onChange={(v) => set({ hasDeadline: v })} />
            </Row>
          </Group>
          <Footnote>
            {f.hasDate
              ? f.hasTime
                ? f.hasEnd
                  ? "Shows as a block on the timeline but stays a to-do. Reminds you when it starts."
                  : "Reminds you at that time."
                : "Reminds you at 9 AM that day."
              : "No date: it stays in the To-dos list until you finish it."}
          </Footnote>
          <TodoProjectAndNote f={f} set={set} />
          {target.mode === "edit" && target.kind === "todo" && <Branches id={target.id} />}
        </>
      )}

      {kind === "plan" && (
        <>
          <Group className="mb-4">
            <Row label="Repeat">
              <PopupSelect tone="plain" value={f.repeat} options={REPEAT_OPTIONS} onChange={(v) => set({ repeat: v })} />
            </Row>
          </Group>
          <Group>
            <Row label="Reminder">
              <PopupSelect value={f.reminder} options={REMINDER_OPTIONS} onChange={(v) => set({ reminder: v })} />
            </Row>
            <Row label="End confirmation">
              <PopupSelect value={f.endConfirmation} options={END_CONFIRM_OPTIONS} onChange={(v) => set({ endConfirmation: v })} />
            </Row>
          </Group>

          <h4 className="mb-1.5 mt-6 px-4 text-[14px] font-medium text-fg/50">To-dos</h4>
          <Group>
            {planTodos.map((t) => (
              <div key={t.id} className="flex items-center gap-3 border-b border-fg/[0.08] px-4 py-2.5 text-[15px]">
                <button
                  onClick={() => store.toggleTodo(t.id)}
                  className={cx(
                    "flex h-[20px] w-[20px] items-center justify-center rounded-full border",
                    t.done ? "border-[#30d158] bg-[#30d158] text-bg" : "border-fg/40",
                  )}
                >
                  {t.done && <CheckIcon size={12} />}
                </button>
                <span className={cx("flex-1", t.done && "text-fg/40 line-through")}>{t.name}</span>
                <button onClick={() => store.deleteTodo(t.id)} className="text-[13px] text-fg/40">
                  Remove
                </button>
              </div>
            ))}
            {pendingTodos.map((t, i) => (
              <div key={i} className="flex items-center gap-3 border-b border-fg/[0.08] px-4 py-2.5 text-[15px]">
                <span className="h-[20px] w-[20px] rounded-full border border-fg/40" />
                <span className="flex-1">{t}</span>
              </div>
            ))}
            <input
              value={todoDraft}
              onChange={(e) => setTodoDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addPlanTodo()}
              onBlur={addPlanTodo}
              placeholder="Add to-do"
              className="h-[46px] w-full bg-transparent px-4 text-[15px] outline-none placeholder:text-fg/30"
            />
          </Group>
          <Footnote>Due before this plan.</Footnote>
        </>
      )}

      {error && <p className="mb-4 rounded-lg bg-[#ff453a]/15 px-4 py-2 text-[13px] text-danger-soft">{error}</p>}

      {target.mode === "new" && target.fromEvent && (
        <>
          <BigButton
            tone="danger"
            onClick={() => {
              store.hideEvent(target.fromEvent!.id);
              close();
            }}
          >
            Hide this event
          </BigButton>
          <Footnote>Hides this calendar event from Ote&apos;s timeline. The event in your calendar is not changed.</Footnote>
        </>
      )}
      {!isNew && kind === "plan" && editingPlan && target.mode === "edit" && target.kind === "plan" && (
        <PlanActions plan={editingPlan} occurrenceStart={target.occurrenceStart} />
      )}
      {!isNew && kind === "actual" && target.mode === "edit" && <PauseActual id={target.id} now={now} />}
      {!isNew && kind === "actual" && target.mode === "edit" && (
        <BigButton
          tone="danger"
          onClick={() => {
            store.deleteActual(target.id);
            close();
          }}
        >
          Delete
        </BigButton>
      )}
      {!isNew && kind === "todo" && target.mode === "edit" && (
        <BigButton
          tone="danger"
          onClick={() => {
            store.deleteTodo(target.id);
            close();
          }}
        >
          Delete
        </BigButton>
      )}

      {choosing && (
        <ChoosePlan
          around={f.start}
          onPick={(key) => {
            const { planId } = parseOccurrenceKey(key);
            const p = plans.find((x) => x.id === planId);
            if (p) set({ planKey: key, name: p.name, activityId: p.activityId, color: p.color });
            setChoosing(false);
          }}
          onClose={() => setChoosing(false)}
        />
      )}
    </Sheet>
  );

  function planLabel(key: string) {
    const { planId, start } = parseOccurrenceKey(key);
    const p = plans.find((x) => x.id === planId);
    if (!p) return "Choose";
    return `${p.name || activityOf(activities, p.activityId).name} · ${fmtTime(start)}`;
  }
}

/**
 * The pills are invisible native inputs: phones open their picker on tap, but desktop browsers only
 * focus the (hidden) field — so open the picker explicitly.
 */
function openPicker(e: React.MouseEvent<HTMLInputElement>) {
  try {
    e.currentTarget.showPicker?.();
  } catch {
    // not allowed here (e.g. inside a cross-origin frame): the field still takes keyboard input
  }
}

/** A to-do's project (its folder in Tasks) and its note. */
function TodoProjectAndNote({ f, set }: { f: Form; set: (patch: Partial<Form>) => void }) {
  const campaigns = useSync((st) => st.campaigns) ?? [];
  const options = [
    { value: "", label: "None" },
    ...campaigns.filter((c) => !c.done || c.id === f.campaignId).map((c) => ({ value: c.id, label: c.name })),
  ];
  return (
    <>
      {campaigns.length > 0 && (
        <Group className="mb-4">
          <Row label="Project">
            <PopupSelect tone="plain" value={f.campaignId} options={options} onChange={(v) => set({ campaignId: v })} />
          </Row>
        </Group>
      )}
      <textarea
        aria-label="Note"
        value={f.note}
        onChange={(e) => set({ note: e.target.value })}
        placeholder="Add note"
        rows={3}
        className="mb-4 w-full resize-y rounded-[14px] bg-surface-2 px-4 py-3 text-[15px] leading-relaxed outline-none placeholder:text-fg/30"
      />
    </>
  );
}

/**
 * A to-do's branches (main + its direct children — no deeper): same details, each with its own
 * date and time. Open one to set its time, add another, or delete one.
 */
function Branches({ id }: { id: string }) {
  const todos = useSync((st) => st.todos);
  const { branchTodo, deleteTodo, moveBranch } = useSync.getState();
  const openEntry = useUI((st) => st.openEntry);
  const [armed, setArmed] = useState<string | null>(null);
  const me = todos.find((t) => t.id === id);
  if (!me) return null;
  const root = me.branchOf ?? me.id;
  const group = todos
    .filter((t) => t.id === root || t.branchOf === root)
    .sort((a, b) => (a.id === root ? -1 : b.id === root ? 1 : branchSort(a, b)));
  const when = (t: Todo) => {
    if (t.date === undefined) return "No date";
    const d = new Date(t.date);
    const day = `${d.getMonth() + 1}/${d.getDate()}`;
    if (t.time === undefined) return `${day} · no time`;
    return `${day} · ${fmtMinutesOfDay(t.time)}${t.duration ? `–${fmtMinutesOfDay((t.time + t.duration) % 1440)}` : ""}`;
  };
  return (
    <div data-branches>
      <SectionTitle>Branches</SectionTitle>
      <Group>
        {group.length > 1 &&
          group.map((t, i) => (
            <div key={t.id} data-branch-row={t.id} className="flex min-h-[46px] items-center gap-3 border-b border-fg/[0.08] px-4 text-[15px] last:border-b-0">
              <button
                onClick={() => t.id !== id && openEntry({ mode: "edit", kind: "todo", id: t.id })}
                className={cx("flex min-w-0 flex-1 items-center gap-2 text-left", t.id === id && "cursor-default")}
              >
                <span className="w-[40px] shrink-0 text-[13px] text-fg/50 tabular">
                  {i + 1}/{group.length}
                </span>
                <span className={cx("min-w-0 flex-1 truncate text-[14px]", t.done && "text-fg/40 line-through")}>
                  {i === 0 ? "Main" : `Branch ${i + 1}`}
                  {t.id === id && <span className="text-fg/45"> · this</span>}
                </span>
                <span className="shrink-0 text-[12.5px] text-fg/55 tabular">{when(t)}</span>
              </button>
              {i > 0 && (
                // the branches' order (the main stays first)
                <span className="flex shrink-0 items-center">
                  <button
                    aria-label={`Move branch ${i + 1} up`}
                    disabled={i === 1}
                    onClick={() => moveBranch(t.id, i - 2)}
                    className="flex h-[24px] w-[22px] items-center justify-center rounded-full text-fg/45 hover:bg-fg/[0.06] disabled:opacity-25"
                  >
                    <ChevronUpIcon size={13} />
                  </button>
                  <button
                    aria-label={`Move branch ${i + 1} down`}
                    disabled={i === group.length - 1}
                    onClick={() => moveBranch(t.id, i)}
                    className="flex h-[24px] w-[22px] items-center justify-center rounded-full text-fg/45 hover:bg-fg/[0.06] disabled:opacity-25"
                  >
                    <ChevronDownIcon size={13} />
                  </button>
                </span>
              )}
              {armed === t.id ? (
                <button
                  aria-label={`Confirm delete branch ${i + 1}`}
                  onClick={() => {
                    setArmed(null);
                    deleteTodo(t.id);
                    if (t.id === id) useUI.getState().closeEntry();
                  }}
                  className="h-[24px] shrink-0 rounded-full bg-[#ff453a] px-2.5 text-[12px] font-semibold text-white"
                >
                  Delete
                </button>
              ) : (
                <button
                  aria-label={`Delete branch ${i + 1}`}
                  onClick={() => setArmed(t.id)}
                  className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-fg/40 hover:bg-fg/[0.06] hover:text-danger-soft"
                >
                  <XIcon size={12} />
                </button>
              )}
            </div>
          ))}
        <button onClick={() => branchTodo(id)} className="flex h-[46px] w-full items-center gap-2 px-4 text-[15px] text-link">
          <BranchIcon size={16} />
          Add branch
        </button>
      </Group>
      <Footnote>Branches share this to-do&apos;s activity, color and deadline; each has its own name, date and time.</Footnote>
    </div>
  );
}

/**
 * An actual still running past now (you're doing it, and it's not what the dashed plan says): pause
 * it here — it ends now, and the rest of its time turns dashed, to resume or finish later.
 */
function PauseActual({ id, now }: { id: string; now: number }) {
  const a = useSync((st) => st.actuals.find((x) => x.id === id));
  const close = useUI((st) => st.closeEntry);
  if (!a) return null;
  const at = Math.round(now / MIN) * MIN;
  const running = !a.rest && a.start < now && now < a.end;
  const paused = !!a.rest?.paused;
  if (!running && !paused) return null;
  return (
    <button
      aria-label={running ? "Pause" : "Resume"}
      title={running ? "Pause here — the rest turns dashed" : "Resume the rest from now"}
      onClick={() => {
        const st = useSync.getState();
        if (running) st.updateActual(a.id, { end: Math.max(a.start + MIN, at), rest: { from: at, end: a.end, paused: true } });
        else st.updateActual(a.id, { rest: { ...a.rest!, from: at, paused: false } });
        close();
      }}
      className="absolute right-2 top-1/2 flex h-[30px] w-[30px] -translate-y-1/2 items-center justify-center rounded-full bg-fg/[0.08] text-fg/80 hover:bg-fg/[0.14]"
    >
      {running ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
    </button>
  );
}

/** "Add to calendar": Ote only, or one of this Mac's calendars (iCloud, Google, …). */
function CalendarRow({ value, onChange, repeating }: { value: string; onChange: (id: string) => void; repeating: boolean }) {
  const [all, setCals] = useState<CalendarInfo[] | null>(null);
  // only calendars ticked in Settings → Calendars shown (plus the one already chosen)
  const hidden = useSync((s) => s.settings.hiddenCalendarIds);
  const cals = all && all.filter((c) => !hidden.includes(c.id) || c.id === value);
  useEffect(() => {
    let live = true;
    void loadWritableCalendars().then((c) => live && setCals(c));
    return () => {
      live = false;
    };
  }, []);
  const options = [
    { value: "", label: "Ote only" },
    ...(cals ?? []).map((c) => ({ value: c.id, label: `${c.name} · ${c.accountId}` })),
    ...(value && cals && !cals.some((c) => c.id === value) ? [{ value, label: "(calendar unavailable)" }] : []),
  ];
  const cur = cals?.find((c) => c.id === value);
  return (
    <div className="flex min-h-[46px] items-center justify-between gap-3 border-t border-fg/[0.08] px-4 text-[15px]">
      <span className="flex items-center gap-2">
        {cur && <span className="h-[8px] w-[8px] rounded-full" style={{ background: cur.color }} />}
        Calendar
      </span>
      <span className="flex min-w-0 items-center gap-2">
        {repeating && value && <span className="text-[11px] text-fg/45">repeating plans stay in Ote</span>}
        <PopupSelect tone="plain" value={value} options={options} onChange={onChange} />
      </span>
    </div>
  );
}

/** Computers with a mouse get the app's own pickers; phones/tablets keep the native wheels. */
function useCustomPickers() {
  const fine = useFinePointer();
  const wide = useIsDesktop();
  return fine && wide;
}

function DateTimePill({ value, onChange, allDay, now }: { value: number; onChange: (t: number) => void; allDay: boolean; now: number }) {
  const fine = useCustomPickers();
  return (
    <div className="flex items-center gap-1.5">
      {fine ? (
        <DatePicker
          label="Day"
          value={startOfDay(value)}
          text={relativeDayLabel(value, now)}
          onChange={(d) => onChange(d + (value - startOfDay(value)))}
        />
      ) : (
      <label className="pill-input relative">
        {relativeDayLabel(value, now)}
        <input
          type="date"
          className="absolute inset-0 cursor-pointer opacity-0"
          onClick={openPicker}
          value={toDateInput(value)}
          onChange={(e) => e.target.value && onChange(fromInputs(e.target.value, toTimeInput(value)))}
        />
      </label>
      )}
      {!allDay && fine && (
        <TimePicker
          label="Time"
          value={Math.round((value - startOfDay(value)) / MIN)}
          onChange={(m) => onChange(startOfDay(value) + m * MIN)}
        />
      )}
      {!allDay && !fine && (
        <label className="pill-input relative tabular">
          {fmtTime(value)}
          <input
            type="time"
            step={300}
            className="absolute inset-0 cursor-pointer opacity-0"
            onClick={openPicker}
            value={toTimeInput(value)}
            onChange={(e) => e.target.value && onChange(fromInputs(toDateInput(value), e.target.value))}
          />
        </label>
      )}
    </div>
  );
}

function PlanActions({ plan, occurrenceStart }: { plan: Plan; occurrenceStart: number }) {
  const store = useSync();
  const close = useUI((s) => s.closeEntry);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const occKey = `${plan.id}@${occurrenceStart}`;
  const dur = plan.end - plan.start;

  return (
    <div className="mt-2 flex flex-col">
      <BigButton
        onClick={() => {
          store.startTimer({ activityId: plan.activityId, name: plan.name, color: plan.color, planKey: occKey });
          close();
        }}
      >
        <PlayIcon size={14} /> Start now
      </BigButton>
      <Footnote>Starts a timer for this activity. When stopped, it&apos;s recorded as an actual.</Footnote>
      <BigButton
        onClick={() => {
          const start = occurrenceStart + dur;
          store.addPlan({ ...plan, repeat: "never", start, end: start + dur, exceptions: undefined, dismissed: undefined, sourceEventId: undefined });
          close();
        }}
      >
        Duplicate
      </BigButton>
      <Footnote>Keeps the original and creates the same plan right after it.</Footnote>
      {!confirmDelete ? (
        <BigButton tone="danger" onClick={() => setConfirmDelete(true)}>
          Delete
        </BigButton>
      ) : plan.repeat === "never" ? (
        <BigButton
          tone="danger"
          onClick={() => {
            store.deletePlan(plan.id);
            close();
          }}
        >
          Tap again to delete
        </BigButton>
      ) : (
        <div className="flex flex-col gap-2">
          <BigButton
            tone="danger"
            onClick={() => {
              store.skipOccurrence(plan.id, occurrenceStart);
              close();
            }}
          >
            Delete this plan only
          </BigButton>
          <BigButton
            tone="danger"
            onClick={() => {
              store.deletePlan(plan.id);
              close();
            }}
          >
            Delete all repeats
          </BigButton>
        </div>
      )}
    </div>
  );
}

/** Lists not-yet-kept plan occurrences near a time (±3 days) for "Record from a plan". */
function ChoosePlan({ around, onPick, onClose }: { around: number; onPick: (key: string) => void; onClose: () => void }) {
  const { plans, actuals, activities } = useSync();
  const [now] = useState(() => Date.now());
  const occ = expandPlans(plans, around - 3 * 24 * HOUR, around + 3 * 24 * HOUR)
    .filter((o) => !o.plan.allDay && !isOccurrenceKept(o, actuals))
    .sort((a, b) => Math.abs(a.start - around) - Math.abs(b.start - around))
    .slice(0, 30);
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center">
      <div className="animate-fade absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="animate-sheet relative max-h-[70%] w-full max-w-[440px] overflow-y-auto rounded-t-[22px] bg-surface-2 pb-8">
        <p className="sticky top-0 bg-surface-2 px-4 pb-2 pt-4 text-center text-[15px] font-semibold">Choose a plan</p>
        {occ.length === 0 && <p className="px-4 py-8 text-center text-[14px] text-fg/50">No open plans nearby.</p>}
        {occ.map((o) => (
          <button
            key={o.key}
            onClick={() => onPick(o.key)}
            className="flex w-full items-center gap-3 border-t border-fg/[0.07] px-4 py-3 text-left"
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: o.plan.color }} />
            <span className="flex-1 truncate text-[15px]">{o.plan.name || activityOf(activities, o.plan.activityId).name}</span>
            <span className="text-[12px] text-fg/50 tabular">
              {relativeDayLabel(o.start, now)} {fmtTime(o.start)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Which calendar an event (that this entry is made from) belongs to. */
function FromCalendar({ event }: { event: { calendarId: string; color?: string } }) {
  const label = useCalendarLabel(event.calendarId);
  return (
    <p data-from-calendar className="mb-4 flex items-center gap-1.5 px-1 text-[13px] text-fg/55">
      <SmallCalIcon size={12} className="shrink-0" style={{ color: event.color }} />
      <span className="truncate">From {label ?? "calendar"}</span>
    </p>
  );
}
