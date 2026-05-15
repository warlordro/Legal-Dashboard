import { createElement, type HTMLAttributes } from "react";
import DOMPurify from "dompurify";

const AI_ALLOWED_TAGS = ["strong", "em", "b", "i"] as const;
const AI_SANITIZE_CONFIG = {
  ALLOWED_TAGS: [...AI_ALLOWED_TAGS],
  ALLOWED_ATTR: [],
};

type Purifier = {
  sanitize: (html: string, config: typeof AI_SANITIZE_CONFIG) => string;
};

type PurifierFactory = ((window: Window) => Purifier) & Partial<Purifier>;

function getPurifier(): Purifier {
  const purifier = DOMPurify as unknown as PurifierFactory;
  if (typeof purifier.sanitize === "function") return purifier as Purifier;
  return purifier(window);
}

export function sanitizeAiHtml(html: string): string {
  return getPurifier().sanitize(html, AI_SANITIZE_CONFIG);
}

export function formatAiMarkdownLine(line: string): string {
  return line.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
}

interface SanitizedHtmlProps extends HTMLAttributes<HTMLElement> {
  as?: "span" | "p";
  html: string;
}

export function SanitizedHtml({ as = "span", html, ...props }: SanitizedHtmlProps) {
  return createElement(as, {
    ...props,
    dangerouslySetInnerHTML: { __html: sanitizeAiHtml(html) },
  });
}
