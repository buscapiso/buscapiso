export function popupContent(p: { label: string; sub?: string; href?: string }): HTMLElement {
  const box = document.createElement('div');
  const title = document.createElement(p.href?.startsWith('#/') ? 'a' : 'strong');
  title.textContent = p.label;
  if (title instanceof HTMLAnchorElement) title.href = p.href!;
  box.append(title);
  if (p.sub) {
    const sub = document.createElement('div');
    sub.textContent = p.sub;
    box.append(sub);
  }
  return box;
}
