import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea';

/** Esc closes, Tab stays inside, focus goes to the first field and comes back to where it was. */
export function useDialog(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input, textarea, select")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return closeRef.current();
      if (e.key !== "Tab" || !ref.current) return;
      const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previous?.focus?.(); };
  }, []);
  return ref;
}

interface DropdownProps {
  label: ComponentChildren;
  ariaLabel?: string;
  title?: string;
  class?: string;
  align?: "left" | "right";
  children: (close: () => void) => ComponentChildren;
}

/** A button that opens a small floating panel (fixed, so scrolling lists never clip it). Esc or a click outside closes it. */
export function Dropdown({ label, ariaLabel, title, class: cls, align = "right", children }: DropdownProps) {
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number }>();
  const root = useRef<HTMLDivElement>(null);
  const open = !!pos;
  useEffect(() => {
    if (!open) return;
    const close = () => setPos(undefined);
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) close(); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);
  return (
    <div class="dropdown" ref={root} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        class={cls}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={(e) => {
          if (open) return setPos(undefined);
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setPos(align === "left" ? { top: r.bottom + 6, left: r.left } : { top: r.bottom + 6, right: window.innerWidth - r.right });
        }}
      >
        {label}
      </button>
      {pos && <div class="popover" style={pos}>{children(() => setPos(undefined))}</div>}
    </div>
  );
}

export function Logo() {
  return (
    <svg class="logo" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="currentColor" />
      <rect x="6" y="7" width="5" height="14" rx="1.5" fill="#fff" />
      <rect x="13.5" y="7" width="5" height="18" rx="1.5" fill="#fff" />
      <rect x="21" y="7" width="5" height="10" rx="1.5" fill="#fff" />
    </svg>
  );
}
