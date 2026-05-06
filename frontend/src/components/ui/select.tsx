import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type Item = { value: string; label: string; disabled?: boolean };

type SelectCtx = {
  value: string;
  onChange: (v: string) => void;
  open: boolean;
  setOpen: (b: boolean) => void;
  active: number;
  setActive: (i: number) => void;
  items: Item[];
  triggerRef: React.RefObject<HTMLButtonElement>;
  contentId: string;
};
const Ctx = React.createContext<SelectCtx | null>(null);
const useCtx = () => {
  const c = React.useContext(Ctx);
  if (!c) throw new Error("Select.* must be used inside <Select>");
  return c;
};

function collectItems(children: React.ReactNode, out: Item[]): void {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === SelectItem) {
      const props = child.props as SelectItemProps;
      const label = typeof props.children === "string" ? props.children : String(props.children ?? props.value);
      out.push({ value: props.value, label, disabled: props.disabled });
      return;
    }
    const props = child.props as { children?: React.ReactNode } | undefined;
    if (props?.children) collectItems(props.children, out);
  });
}

export interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  children: React.ReactNode;
}

export function Select({ value, onValueChange, children }: SelectProps) {
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const contentId = React.useId();

  const items: Item[] = [];
  collectItems(children, items);

  React.useEffect(() => {
    if (!open) return;
    const i = items.findIndex((it) => it.value === value);
    setActive(i >= 0 ? i : 0);
    // items recomputed each render; intentionally not in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, value]);

  return (
    <Ctx.Provider value={{ value, onChange: onValueChange, open, setOpen, active, setActive, items, triggerRef, contentId }}>
      {children}
    </Ctx.Provider>
  );
}

export interface SelectTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {}

export const SelectTrigger = React.forwardRef<HTMLButtonElement, SelectTriggerProps>(
  ({ className, children, disabled, onClick, onKeyDown, ...rest }, ref) => {
    const { open, setOpen, contentId, triggerRef } = useCtx();
    React.useImperativeHandle(ref, () => triggerRef.current as HTMLButtonElement, [triggerRef]);
    return (
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? contentId : undefined}
        disabled={disabled}
        onClick={(e) => {
          onClick?.(e);
          if (!e.defaultPrevented) setOpen(!open);
        }}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (e.defaultPrevented) return;
          if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...rest}
      >
        {children}
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
    );
  },
);
SelectTrigger.displayName = "SelectTrigger";

export interface SelectValueProps {
  placeholder?: string;
  className?: string;
}

export function SelectValue({ placeholder, className }: SelectValueProps) {
  const { value, items } = useCtx();
  const found = items.find((it) => it.value === value);
  const text = found?.label ?? "";
  return (
    <span className={cn("truncate text-left", !text && "text-muted-foreground", className)}>
      {text || placeholder}
    </span>
  );
}

export interface SelectContentProps {
  children: React.ReactNode;
  className?: string;
}

export function SelectContent({ children, className }: SelectContentProps) {
  const { open, setOpen, triggerRef, items, active, setActive, onChange, contentId } = useCtx();
  const ref = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{ top: number; left: number; width: number; placeAbove: boolean; fontSize: string } | null>(null);

  React.useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const t = triggerRef.current;
    if (!t) return;
    const update = () => {
      const r = t.getBoundingClientRect();
      const spaceBelow = window.innerHeight - r.bottom;
      const placeAbove = spaceBelow < 240 && r.top > spaceBelow;
      const fontSize = window.getComputedStyle(t).fontSize;
      setPos({
        top: placeAbove ? r.top - 4 : r.bottom + 4,
        left: r.left,
        width: r.width,
        placeAbove,
        fontSize,
      });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, triggerRef]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen, triggerRef]);

  React.useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);

  React.useEffect(() => {
    if (!open || !ref.current) return;
    const el = ref.current.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  if (!open || !pos) return null;

  const move = (delta: number) => {
    if (items.length === 0) return;
    let i = active;
    for (let n = 0; n < items.length; n++) {
      i = (i + delta + items.length) % items.length;
      if (!items[i].disabled) break;
    }
    setActive(i);
  };

  const commit = () => {
    const it = items[active];
    if (it && !it.disabled) {
      onChange(it.value);
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  return (
    <div
      ref={ref}
      id={contentId}
      role="listbox"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
        else if (e.key === "Home") { e.preventDefault(); setActive(0); }
        else if (e.key === "End") { e.preventDefault(); setActive(items.length - 1); }
        else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); commit(); }
        else if (e.key === "Tab") { setOpen(false); }
      }}
      style={{
        position: "fixed",
        top: pos.placeAbove ? undefined : pos.top,
        bottom: pos.placeAbove ? window.innerHeight - pos.top : undefined,
        left: pos.left,
        minWidth: pos.width,
        maxWidth: `calc(100vw - ${pos.left + 8}px)`,
        maxHeight: 240,
        fontSize: pos.fontSize,
      }}
      className={cn(
        "z-[100] overflow-y-auto rounded-md border border-border bg-card py-1 text-card-foreground shadow-lg outline-none scrollbar-thin",
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface SelectItemProps {
  value: string;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function SelectItem({ value, disabled, children, className }: SelectItemProps) {
  const ctx = useCtx();
  const index = ctx.items.findIndex((it) => it.value === value);
  const isSelected = ctx.value === value;
  const isActive = ctx.active === index;

  return (
    <div
      role="option"
      aria-selected={isSelected}
      aria-disabled={disabled || undefined}
      data-index={index}
      data-active={isActive || undefined}
      data-disabled={disabled || undefined}
      onMouseEnter={() => !disabled && ctx.setActive(index)}
      onMouseDown={(e) => {
        e.preventDefault();
        if (disabled) return;
        ctx.onChange(value);
        ctx.setOpen(false);
        ctx.triggerRef.current?.focus();
      }}
      className={cn(
        "relative flex cursor-pointer select-none items-center px-3 py-1.5 outline-none",
        "data-[active]:bg-primary data-[active]:text-primary-foreground",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
    >
      <span className="whitespace-nowrap">{children}</span>
    </div>
  );
}
