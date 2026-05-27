export function getYearMonths(from: string | null, to: string | null): string[] {
  if (!from || !to) return [];
  const months: string[] = [];
  const end = new Date(to);
  const cur = new Date(from);
  cur.setDate(1);
  while (cur <= end) {
    months.push(
      `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`,
    );
    cur.setMonth(cur.getMonth() + 1);
  }
  return months;
}
