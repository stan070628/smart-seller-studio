export function parseSpecText(text?: string): Array<{ label: string; value: string }> | undefined {
  if (!text?.trim()) return undefined;
  const items = text.split('\n').flatMap((line) => {
    const idx = line.indexOf(': ');
    if (idx === -1) return [];
    const label = line.slice(0, idx).trim();
    const value = line.slice(idx + 2).trim();
    return label && value ? [{ label, value }] : [];
  });
  return items.length > 0 ? items : undefined;
}
