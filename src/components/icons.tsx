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

export function SunIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <circle cx="12" cy="12" r="4.2" fill="currentColor" stroke="none" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <line key={a} x1="12" y1="2.6" x2="12" y2="5" transform={`rotate(${a} 12 12)`} strokeWidth={2} />
      ))}
    </svg>
  );
}

export function HomeIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M3.5 10.5 12 3.8l8.5 6.7" strokeLinejoin="round" />
      <path d="M5.8 9v10.2h4.4v-5.4h3.6v5.4h4.4V9" strokeLinejoin="round" />
    </svg>
  );
}

export function BookIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M5 4.5h10.5A3.5 3.5 0 0 1 19 8v11.5H8.5A3.5 3.5 0 0 1 5 16z" strokeLinejoin="round" />
      <path d="M5 16a3.5 3.5 0 0 1 3.5-3.5H19M9 8h6" />
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

export function ChartIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <rect x="3" y="11" width="4.5" height="9" rx="1" fill="currentColor" stroke="none" />
      <rect x="9.75" y="6" width="4.5" height="14" rx="1" fill="currentColor" stroke="none" />
      <rect x="16.5" y="3" width="4.5" height="17" rx="1" fill="currentColor" stroke="none" />
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

export function GridIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      {[3.5, 13].map((x) =>
        [3.5, 13].map((y) => <rect key={`${x}-${y}`} x={x} y={y} width="7.5" height="7.5" rx="1.6" fill="currentColor" stroke="none" />),
      )}
    </svg>
  );
}

export function FlagIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M5 21V4" strokeWidth={2.2} />
      <path d="M5 4h12.5l-2.5 4.5 2.5 4.5H5z" fill="currentColor" />
    </svg>
  );
}

export function GearIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
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
