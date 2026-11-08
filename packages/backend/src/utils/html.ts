/**
 * HTML escaping for the pages the API renders itself (OAuth callbacks, device verification).
 * Every value interpolated into those templates goes through escapeHtml.
 */
const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escapes a value for HTML text and quoted attribute values; null and undefined print as "". */
export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}
