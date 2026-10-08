import en from './locales/en.json';

const strings: Record<string, string> = en;

export function t(key: string, vars: Record<string, string | number> = {}): string {
  const text = strings[key];
  if (text === undefined) return key;
  return text.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
}
