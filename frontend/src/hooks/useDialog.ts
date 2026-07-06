import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Minimal a11y modal hook: closes on Escape, prevents body scroll, traps Tab/
// Shift+Tab inside the dialog, restores focus on unmount. Returns the container
// ref so the caller can attach it to the dialog root.
export function useDialog<T extends HTMLElement = HTMLDivElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T | null>(null);

  // v2.42.0 (6.4/10.4a): onClose sta intr-un ref actualizat la fiecare render,
  // iar efectul depinde DOAR de [open]. Altfel o closure recreata la render
  // demonta/remonta efectul la fiecare apasare si muta focusul din inputuri.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    const previousFocus = document.activeElement as HTMLElement | null;

    const getFocusable = (): HTMLElement[] => {
      const node = ref.current;
      if (!node) return [];
      const all = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      return all.filter((el) => !el.hasAttribute("disabled") && el.tabIndex !== -1);
    };

    // Move focus into the dialog so screen readers and keyboard users land here.
    queueMicrotask(() => {
      const focusables = getFocusable();
      (focusables[0] ?? ref.current)?.focus();
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const node = ref.current;
      if (!node) return;
      const focusables = getFocusable();
      if (focusables.length === 0) {
        // Fara elemente focusabile: tine focusul pe container ca focusul sa nu
        // scape inapoi pe pagina (aria-modal ar fi minciuna altfel).
        e.preventDefault();
        node.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      // Daca focusul a iesit din dialog (ex. user a click-uit fundalul), readu-l
      // inauntru pe primul element focusabil.
      if (active && !node.contains(active)) {
        e.preventDefault();
        first.focus();
        return;
      }
      if (e.shiftKey) {
        if (active === first || active === node) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.();
    };
  }, [open]);

  return ref;
}
