/**
 * Sanitize HTML for safe display (e.g. content from RichTextEditor).
 * Allows only a whitelist of tags; strips scripts and event handlers.
 */
const ALLOWED_TAGS = new Set([
  "p", "br", "strong", "b", "em", "i", "u", "s", "ul", "ol", "li", "span", "a",
  "h1", "h2", "h3", "blockquote", "body", "div",
]);

function isAllowedTag(tagName: string): boolean {
  return ALLOWED_TAGS.has(tagName.toLowerCase());
}

function isSafeHref(href: string): boolean {
  const t = href.trim().toLowerCase();
  return t.startsWith("http://") || t.startsWith("https://") || t.startsWith("#") || t === "";
}

export function sanitizeHtml(html: string): string {
  try {
    if (html == null || typeof html !== "string") return "";
    const doc = new DOMParser().parseFromString(html, "text/html");
    const body = doc?.body;
    if (!body) return escapeHtml(html);
    const walk = (node: Node): void => {
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node as Element;
      const tag = el.tagName?.toLowerCase?.();
      if (!tag || !isAllowedTag(tag)) {
        const parent = el.parentNode;
        if (parent) {
          while (el.firstChild) parent.insertBefore(el.firstChild, el);
          parent.removeChild(el);
        }
        return;
      }
      if (tag === "a") {
        const href = el.getAttribute("href") ?? "";
        if (!isSafeHref(href)) el.removeAttribute("href");
      }
      const remove: string[] = [];
      for (const a of el.attributes) {
        if (a.name !== "href" && (a.name.startsWith("on") || (a.name === "style" && /javascript|expression/i.test(a.value)))) {
          remove.push(a.name);
        }
      }
      remove.forEach((name) => el.removeAttribute(name));
      const children: Node[] = [];
      for (let c = node.firstChild; c; c = c.nextSibling) children.push(c);
      children.forEach((c) => walk(c));
    };
    // Walk children of body only; do not remove body (so innerHTML is preserved)
    const children: Node[] = [];
    for (let c = body.firstChild; c; c = c.nextSibling) children.push(c);
    children.forEach((c) => walk(c));
    return body.innerHTML;
  } catch {
    return escapeHtml(String(html ?? ""));
  }
}

function escapeHtml(s: string): string {
  if (typeof document !== "undefined" && document.createElement) {
    const el = document.createElement("div");
    el.textContent = s;
    return el.innerHTML;
  }
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Normalize rich text HTML for storage: trim and collapse redundant empty blocks
 * so it displays consistently and stays easy to read.
 */
export function normalizeRichTextHtml(html: string): string {
  try {
    if (html == null || typeof html !== "string") return "";
    let s = String(html).trim();
    s = s.replace(/(<p><\/p>|<p><br\s*\/?><\/p>)\s*(<p><\/p>|<p><br\s*\/?><\/p>)*/gi, "<p><br></p>");
    return s;
  } catch {
    return "";
  }
}
