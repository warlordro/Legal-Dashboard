import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

export type JobKindFilter = "all" | "dosar_soap" | "name_soap" | "iccj";

const TABS: ReadonlyArray<{ key: JobKindFilter; label: string }> = [
  { key: "all", label: "Toate" },
  { key: "dosar_soap", label: "Dosare" },
  { key: "name_soap", label: "Nume" },
  { key: "iccj", label: "ICCJ" },
];

export function JobKindTabs({
  value,
  onChange,
  ariaLabel,
}: {
  value: JobKindFilter;
  onChange: (k: JobKindFilter) => void;
  ariaLabel: string;
}) {
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([]);

  // ArrowLeft / ArrowRight navigation per WAI-ARIA Authoring Practices Guide
  // for `role="tablist"`. Wraps around at the ends; Home/End jump to the first
  // and last tab. Switching the active tab via arrow keys also fires onChange
  // so the underlying state stays in sync with the focused tab (manual
  // activation pattern would be one Tab-then-Enter step longer for keyboard
  // users with a 3-item list — direct activation is fine here).
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, currentIdx: number) {
    let nextIdx: number | null = null;
    if (event.key === "ArrowRight") nextIdx = (currentIdx + 1) % TABS.length;
    else if (event.key === "ArrowLeft") nextIdx = (currentIdx - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") nextIdx = 0;
    else if (event.key === "End") nextIdx = TABS.length - 1;
    if (nextIdx === null) return;
    event.preventDefault();
    const next = TABS[nextIdx];
    if (next) {
      onChange(next.key);
      buttonsRef.current[nextIdx]?.focus();
    }
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex rounded-md border border-input bg-background p-0.5"
    >
      {TABS.map(({ key, label }, idx) => {
        const active = value === key;
        return (
          <button
            key={key}
            ref={(el) => {
              buttonsRef.current[idx] = el;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(key)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            className={cn(
              "rounded px-3 py-1 text-xs font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
