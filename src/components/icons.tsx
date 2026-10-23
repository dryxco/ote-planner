import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

const base = (size = 22): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
});

/* Navigation set: thin outlines, each with one small solid mark. */

export function HomeIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} strokeWidth={1.6} {...p}>
      <path d="M5 20v-8.5a7 7 0 0 1 14 0V20" />
      <path d="M3 20h18" />
      <circle cx="12" cy="13.5" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Today: the sun on the horizon. */
export function TodayIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} strokeWidth={1.6} {...p}>
      <path d="M3 17.5h18M6.5 20.5h11" />
      <path d="M7 17.5a5 5 0 0 1 10 0" />
      <circle cx="12" cy="6" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PlannerIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} strokeWidth={1.6} {...p}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3.5" />
      <path d="M8 3v3.5M16 3v3.5M3.5 10.5h17" />
      <rect x="13.6" y="13.6" width="3.4" height="3.4" rx="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function StackIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} strokeWidth={1.6} {...p}>
      <path d="M12 3.8 20.5 8 12 12.2 3.5 8z" fill="currentColor" fillOpacity={0.9} />
      <path d="m3.5 12.2 8.5 4.2 8.5-4.2M3.5 16.2l8.5 4.2 8.5-4.2" />
    </svg>
  );
}

export function DiaryIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} strokeWidth={1.6} {...p}>
      <path d="M6 3.8h11a2 2 0 0 1 2 2v14.4H8a2 2 0 0 1-2-2z" />
      <path d="M6 17.8a2 2 0 0 1 2-2h11" />
      <path d="M10 3.8v6.4l1.6-1.2 1.6 1.2V3.8" fill="currentColor" />
    </svg>
  );
}

/** Insights: Review, Activities and Goals live under it. */
export function InsightsIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} strokeWidth={1.6} {...p}>
      <path d="M3.5 19.5h17" />
      <path d="m4.5 15 4.5-5 3.5 3 6.5-7" />
      <circle cx="19" cy="6" r="1.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Review: a ring partly filled, like the scores. */
export function ReviewIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} strokeWidth={1.6} {...p}>
      <circle cx="12" cy="12" r="8" opacity={0.35} />
      <path d="M12 4a8 8 0 0 1 7.6 10.5" strokeWidth={2.4} />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Activities: colour swatches of different lengths. */
export function SwatchIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} strokeWidth={1.6} {...p}>
      <rect x="3.5" y="4.5" width="17" height="4" rx="2" />
      <rect x="3.5" y="10.5" width="12" height="4" rx="2" fill="currentColor" stroke="none" />
      <rect x="3.5" y="16.5" width="7.5" height="4" rx="2" />
    </svg>
  );
}

/** Goals: a target (the flag belongs to one-minute moments on the timeline). */
export function TargetIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} strokeWidth={1.6} {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Settings: two sliders. */
export function SlidersIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} strokeWidth={1.6} {...p}>
      <path d="M4 8h16M4 16h16" />
      <circle cx="9" cy="8" r="2.4" fill="var(--bg)" />
      <circle cx="15" cy="16" r="2.4" fill="currentColor" />
    </svg>
  );
}

export function BranchIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <circle cx="7" cy="5.5" r="2.2" />
      <circle cx="7" cy="18.5" r="2.2" />
      <circle cx="17" cy="8.5" r="2.2" />
      <path d="M7 7.7v8.6M17 10.7c0 3.8-4.6 3.6-8.6 6" />
    </svg>
  );
}

export function CalendarIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <rect x="3" y="4.5" width="18" height="16" rx="3" fill="currentColor" stroke="none" />
      <rect x="5" y="9.5" width="14" height="9" rx="1" fill="var(--bg)" stroke="none" opacity="0.85" />
      {[7, 10.5, 14, 17.5].map((x) =>
        [11.5, 14.5].map((y) => <rect key={`${x}-${y}`} x={x - 0.9} y={y - 0.9} width="1.8" height="1.8" fill="currentColor" stroke="none" />),
      )}
    </svg>
  );
}

export function FolderIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M2.5 6.5a1.5 1.5 0 0 1 1.5-1.5h5.2l2 2.3H20a1.5 1.5 0 0 1 1.5 1.5v9.2a1.5 1.5 0 0 1-1.5 1.5H4a1.5 1.5 0 0 1-1.5-1.5z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PlusIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M12 5v14M5 12h14" strokeWidth={2} />
    </svg>
  );
}

export function PlayIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PauseIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <rect x="6.5" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none" />
      <rect x="13.9" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function StopIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ChevronLeft({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M15 5l-7 7 7 7" strokeWidth={2.2} />
    </svg>
  );
}

export function ChevronRight({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M9 5l7 7-7 7" strokeWidth={2.2} />
    </svg>
  );
}

export function ChevronUpDown({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M8 9l4-4 4 4M8 15l4 4 4-4" strokeWidth={2} />
    </svg>
  );
}

export function CheckIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M5 12.5l4.5 4.5L19 7" strokeWidth={2.4} />
    </svg>
  );
}

export function XIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M6 6l12 12M18 6L6 18" strokeWidth={2.2} />
    </svg>
  );
}

export function ExpandIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M14 4h6v6M10 20H4v-6M20 4l-6.5 6.5M4 20l6.5-6.5" strokeWidth={2} />
    </svg>
  );
}

export function CollapseIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M20 10h-6V4M4 14h6v6M14 10l6.5-6.5M10 14l-6.5 6.5" strokeWidth={2} />
    </svg>
  );
}

export function SearchIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <circle cx="11" cy="11" r="6.5" strokeWidth={2} />
      <path d="M16 16l4.5 4.5" strokeWidth={2.2} />
    </svg>
  );
}

export function FilterIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M7.5 9h9M9 12h6M10.5 15h3" />
    </svg>
  );
}

export function SmallCalIcon({ size = 11, ...p }: P) {
  return (
    <svg {...base(size)} {...p} strokeWidth={2.2}>
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 10h17" />
    </svg>
  );
}

export function HistoryIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
      <path d="M3.5 4v4h4" />
      <path d="M12 8v4l3 2" />
    </svg>
  );
}

export function CopyIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2.2" />
      <path d="M15.5 8.5V6.2a1.7 1.7 0 0 0-1.7-1.7H6.2a1.7 1.7 0 0 0-1.7 1.7v7.6a1.7 1.7 0 0 0 1.7 1.7h2.3" />
    </svg>
  );
}

export function TrashIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M4.5 7h15M9.5 7V5.2c0-.7.5-1.2 1.2-1.2h2.6c.7 0 1.2.5 1.2 1.2V7M6.5 7l.9 11.6c.1 1 .9 1.9 2 1.9h5.2c1.1 0 1.9-.9 2-1.9L17.5 7M10.2 10.5v6M13.8 10.5v6" />
    </svg>
  );
}

export function StatusIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <circle cx="12" cy="12" r="8" strokeDasharray="3.2 2.6" />
      <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PersonIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <circle cx="12" cy="8.2" r="3.7" />
      <path d="M4.8 20c.6-3.6 3.6-6 7.2-6s6.6 2.4 7.2 6" />
    </svg>
  );
}

export function PenIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M15.2 4.8l4 4L8.5 19.5 4 20l.5-4.5L15.2 4.8z" />
      <path d="M13 7l4 4" />
    </svg>
  );
}

export function BarsIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M6 19v-5M12 19V9M18 19V5" strokeWidth={2.2} />
    </svg>
  );
}

export function HourglassIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M7 3.5h10M7 20.5h10M8 3.5c0 4 4 5.5 4 8.5s-4 4.5-4 8.5M16 3.5c0 4-4 5.5-4 8.5s4 4.5 4 8.5" />
    </svg>
  );
}

export function PaperclipIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M19 11.5l-6.8 6.8a4.5 4.5 0 0 1-6.4-6.4l7.2-7.2a3 3 0 0 1 4.2 4.2l-7.1 7.1a1.5 1.5 0 0 1-2.1-2.1l6.4-6.4" />
    </svg>
  );
}

export function ClockIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

export function CheckCircleIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.2 12.3l2.6 2.6 5-5.4" />
    </svg>
  );
}

export function DocIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M7 3.5h7l4.5 4.5v11a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5z" />
      <path d="M14 3.5V8h4.5M8.5 12.5h7M8.5 16h5" />
    </svg>
  );
}

export function ChevronUpIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M6 15l6-6 6 6" strokeWidth={2.2} />
    </svg>
  );
}

export function ChevronDownIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M6 9l6 6 6-6" strokeWidth={2.2} />
    </svg>
  );
}
