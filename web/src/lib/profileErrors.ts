export function fieldErrors(detail: unknown): Record<string, string> {
  if (!Array.isArray(detail)) return { '': String(detail) };
  const out: Record<string, string> = {};
  for (const d of detail as { loc: (string | number)[]; msg: string }[]) {
    const path = d.loc.filter((p) => p !== 'body').join('.');
    out[path] = d.msg;
  }
  return out;
}
