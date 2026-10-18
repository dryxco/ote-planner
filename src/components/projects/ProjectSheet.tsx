"use client";

import { useState } from "react";
import type { Campaign } from "@/lib/types";
import { useSync } from "@/lib/store";
import { addDays, startOfDay } from "@/lib/time";
import { BigButton, Group, Row, SectionTitle, Sheet, TextField, Toggle, cx } from "../ui";
import { DatePicker } from "../DatePicker";
import { projectColor, useTicketMeta } from "../tickets/ticket-ui";
import { allDone, campaignProgress } from "@/lib/campaigns";

/** Add or edit a project: name, start / due, linked activities and "#" projects, note. */
export function ProjectSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { campaigns, activities, settings, todos, addCampaign, updateCampaign, deleteCampaign } = useSync();
  const tickets = useSync((s) => s.tickets ?? []);
  // its artifacts are deleted with it (its tasks and tickets stay)
  const docs = useSync((s) => (s.artifacts ?? []).filter((a) => a.campaignId === id).length);
  const meta = useTicketMeta();
  const c = id ? campaigns.find((x) => x.id === id) : undefined;
  const [today] = useState(() => startOfDay(Date.now()));
  const [name, setName] = useState(c?.name ?? "");
  const [start, setStart] = useState<number | undefined>(c?.start);
  const [due, setDue] = useState<number | undefined>(c?.due);
  const [acts, setActs] = useState<string[]>(c?.activityIds ?? []);
  const [tags, setTags] = useState<string[]>(c?.tags ?? []);
  const [note, setNote] = useState(c?.note ?? "");
  const [done, setDone] = useState(!!c?.done);
  const [armed, setArmed] = useState(false);
  const toggle = (list: string[], x: string) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);

  function save() {
    const data: Omit<Campaign, "id" | "createdAt"> = { name: name.trim(), start, due, activityIds: acts, tags, note: note.trim() ? note : undefined, done };
    if (c) updateCampaign(c.id, data);
    else addCampaign(data);
    onClose();
  }
  const date = (label: string, value: number | undefined, set: (v: number | undefined) => void, fallback: number) => (
    <Row label={label}>
      {value !== undefined && <DatePicker label={label} value={value} weekStartsOn={settings.weekStartsOn} onChange={(d) => set(startOfDay(d))} />}
      <Toggle checked={value !== undefined} onChange={(v) => set(v ? fallback : undefined)} />
    </Row>
  );
  const tagOptions = (meta?.projects ?? []).filter((p) => !p.noBoard);

  return (
    <Sheet title={c ? "Project" : "New project"} onCancel={onClose} onSave={save} saveDisabled={!name.trim()}>
      <Group className="mb-4">
        <TextField value={name} onChange={setName} placeholder="Name" autoFocus={!c} />
      </Group>
      <Group>
        {date("Start", start, setStart, today)}
        {date("Due", due, setDue, addDays(today, 7))}
        {/* done only once everything in it is (and can always be undone) */}
        {c && (c.done || allDone(campaignProgress(c, todos, tickets))) && (
          <Row label="Done">
            <Toggle checked={done} onChange={setDone} />
          </Row>
        )}
      </Group>

      <SectionTitle>Activities</SectionTitle>
      <div data-project-activities className="flex flex-wrap gap-1.5 px-1">
        {[...activities]
          .filter((a) => !a.archived || acts.includes(a.id))
          .sort((a, b) => a.order - b.order)
          .map((a) => (
            <Chip key={a.id} on={acts.includes(a.id)} onClick={() => setActs((l) => toggle(l, a.id))}>
              <span className="h-[7px] w-[7px] rounded-full" style={{ background: a.color }} />
              {a.name}
            </Chip>
          ))}
      </div>

      {tagOptions.length > 0 && (
        <>
          <SectionTitle># Projects</SectionTitle>
          <div data-project-tags className="flex max-h-[150px] flex-wrap gap-1.5 overflow-y-auto px-1">
            {tagOptions.map((p) => (
              <Chip key={p.id} on={tags.includes(p.id)} onClick={() => setTags((l) => toggle(l, p.id))}>
                <span style={{ color: projectColor(meta, p.id) }}>#</span>
                {p.name}
              </Chip>
            ))}
          </div>
        </>
      )}

      <SectionTitle>Note</SectionTitle>
      <textarea
        aria-label="Project note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note"
        rows={4}
        className="mb-5 w-full resize-y rounded-[14px] bg-surface-2 px-4 py-3 text-[15px] leading-relaxed outline-none placeholder:text-fg/30"
      />

      {c && (
        <BigButton
          tone="danger"
          onClick={() => {
            if (!armed) return setArmed(true);
            deleteCampaign(c.id);
            onClose();
          }}
        >
          {armed ? (docs ? `Delete with ${docs} artifact${docs > 1 ? "s" : ""}` : "Confirm delete") : "Delete project"}
        </BigButton>
      )}
    </Sheet>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      role="checkbox"
      aria-checked={on}
      onClick={onClick}
      className={cx(
        "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px]",
        on ? "border-transparent bg-fg/[0.12] font-medium text-fg" : "border-fg/12 text-fg/60 hover:bg-fg/[0.05]",
      )}
    >
      {children}
    </button>
  );
}
