"use client";

import { useEffect, type ReactNode } from "react";
import { ChevronUpDown } from "./icons";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

/** iOS-style modal sheet with Cancel / Title / Save header. */
export function Sheet({
  title,
  onCancel,
  onSave,
  saveLabel = "Save",
  saveDisabled,
  cancelLabel = "Cancel",
  children,
  compact,
}: {
  title: ReactNode;
  onCancel: () => void;
  onSave?: () => void;
  saveLabel?: string;
  saveDisabled?: boolean;
  cancelLabel?: string;
  children: ReactNode;
  /** Half-height sheet (e.g. Add goal). */
  compact?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      // ⌘↵ (Ctrl↵): the same as the Save button, from anywhere in the sheet (not mid-IME-composition)
      else if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && !e.isComposing && onSave && !saveDisabled) {
        e.preventDefault();
        onSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, onSave, saveDisabled]);

  return (
    <div className="fixed inset-0 z-50 flex justify-center">
      <div className="animate-fade absolute inset-0 bg-black/55" onClick={onCancel} />
      <div
        className={cx(
          "animate-sheet absolute bottom-0 flex w-full max-w-[440px] flex-col rounded-t-[22px] bg-surface shadow-2xl",
          compact ? "h-[52%]" : "h-[calc(100%_-_max(12px,_env(safe-area-inset-top)_+_6px))]",
        )}
        role="dialog"
        aria-modal="true"
      >
        <div className="mx-auto mt-2 h-[5px] w-9 rounded-full bg-fg/25" />
        <header className="relative flex items-center justify-between px-4 pb-2 pt-2">
          <HeaderButton onClick={onCancel}>{cancelLabel}</HeaderButton>
          <h2 className="pointer-events-none absolute inset-x-0 text-center text-[16px] font-semibold">{title}</h2>
          {onSave ? (
            <HeaderButton onClick={onSave} disabled={saveDisabled} strong>
              {saveLabel}
            </HeaderButton>
          ) : (
            <span className="w-14" />
          )}
        </header>
        <div className="no-scrollbar flex-1 overflow-y-auto px-4 pb-[max(40px,env(safe-area-inset-bottom))] pt-3">{children}</div>
      </div>
    </div>
  );
}

function HeaderButton({
  children,
  onClick,
  disabled,
  strong,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  strong?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "relative z-10 min-w-14 rounded-full border border-fg/10 bg-fg/[0.06] px-3 py-1.5 text-[15px] underline-offset-2 disabled:opacity-35",
        strong ? "font-semibold underline" : "underline",
      )}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
  size = "md",
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div className={cx("flex rounded-full bg-surface-2 p-[3px]", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "flex-1 rounded-full transition-colors",
            size === "sm" ? "py-1 text-[12px]" : "py-1.5 text-[13px]",
            value === o.value ? "bg-seg-active font-medium text-fg" : "text-fg/80",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Group({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("overflow-hidden rounded-[14px] bg-surface-2", className)}>{children}</div>;
}

export function Row({
  label,
  children,
  onClick,
  className,
}: {
  label: ReactNode;
  children?: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={cx(
        "flex min-h-[46px] w-full items-center justify-between gap-3 border-b border-fg/[0.08] px-4 text-left text-[15px] last:border-b-0",
        className,
      )}
    >
      <span className="shrink-0">{label}</span>
      <div className="flex min-w-0 items-center justify-end gap-2">{children}</div>
    </Comp>
  );
}

export function Footnote({ children }: { children: ReactNode }) {
  return <p className="mb-5 mt-1.5 px-4 text-[12px] leading-snug text-fg/45">{children}</p>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-1.5 mt-5 px-4 text-[14px] font-medium text-fg/50">{children}</h3>;
}

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative h-[30px] w-[51px] shrink-0 rounded-full transition-colors disabled:opacity-40",
        checked ? "bg-[#30d158]" : "bg-toggle-off",
      )}
    >
      <span
        className={cx(
          "absolute left-0 top-[2px] h-[26px] w-[26px] rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-[23px]" : "translate-x-[2px]",
        )}
      />
    </button>
  );
}

/** Native <select> styled as an iOS pop-up button ("Other ⌃⌄"). */
export function PopupSelect<T extends string | number>({
  value,
  options,
  onChange,
  tone = "accent",
  disabled,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  tone?: "accent" | "plain";
  disabled?: boolean;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <label
      className={cx(
        "relative flex items-center gap-1 rounded-full px-2.5 py-1 text-[15px]",
        tone === "accent" ? "bg-[#0a84ff]/15 text-link" : "bg-surface-3 text-fg/85",
        disabled && "opacity-40",
      )}
    >
      <span className="truncate">{current?.label ?? ""}</span>
      <ChevronUpDown size={13} />
      <select
        className="absolute inset-0 cursor-pointer opacity-0"
        value={String(value)}
        disabled={disabled}
        onChange={(e) => {
          const o = options.find((x) => String(x.value) === e.target.value);
          if (o) onChange(o.value);
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ColorDots({
  colors,
  value,
  onChange,
}: {
  colors: string[];
  value: string;
  onChange: (c: string) => void;
}) {
  const custom = !colors.some((c) => c.toLowerCase() === value.toLowerCase());
  const check = (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-[14px] gap-y-3 px-4 py-3">
      {colors.map((c) => (
        <button
          key={c}
          aria-label={`color ${c}`}
          onClick={() => onChange(c)}
          className={cx(
            "flex h-[26px] w-[26px] items-center justify-center rounded-full",
            value === c && "ring-2 ring-fg ring-offset-2 ring-offset-surface-2",
          )}
          style={{ background: c }}
        >
          {value === c && check}
        </button>
      ))}
      {/* any color: the system color picker behind a rainbow dot (shows the custom color once chosen) */}
      <label
        aria-label="Custom color"
        title="Custom color"
        className={cx(
          "relative flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-full",
          custom && "ring-2 ring-fg ring-offset-2 ring-offset-surface-2",
        )}
        style={{ background: custom ? value : "conic-gradient(#ff453a, #ff9f0a, #ffd60a, #30d158, #64d2ff, #0a84ff, #bf5af2, #ff453a)" }}
      >
        {custom ? check : <span className="h-[10px] w-[10px] rounded-full bg-surface" />}
        <input
          type="color"
          data-custom-color
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#2f7fd8"}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>
    </div>
  );
}

export function TextField({
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  return (
    <input
      value={value}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="h-[46px] w-full border-b border-fg/[0.08] bg-transparent px-4 text-[15px] outline-none placeholder:text-fg/30"
    />
  );
}

export function BigButton({
  children,
  onClick,
  tone = "accent",
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  tone?: "accent" | "danger";
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "flex h-[46px] w-full items-center justify-center gap-2 rounded-[14px] bg-surface-2 text-[15px] disabled:opacity-40",
        tone === "danger" ? "text-[#ff453a]" : "text-link",
      )}
    >
      {children}
    </button>
  );
}
