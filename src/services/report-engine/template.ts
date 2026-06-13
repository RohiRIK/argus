export type TemplateVars = Record<string, string | number | boolean | null | undefined>;

const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape a value for safe HTML interpolation (prevents injection in reports). */
export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);
}

/**
 * Render a template by replacing {{key}} tokens with escaped variable values.
 * Unknown tokens render empty. Whitespace inside braces is tolerated.
 */
export function render(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => {
    const value = vars[key];
    return value === undefined || value === null ? "" : escapeHtml(value);
  });
}

/** Extract the {{variable}} names referenced by a template (editor/validation). */
export function extractVariables(template: string): string[] {
  const found = new Set<string>();
  for (const m of template.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) found.add(m[1]);
  return [...found];
}
