export interface SalesUnitInfo {
  count: number;
  countUnit: string;
  totalAmount: number;
  totalUnit: string;
  perUnitAmount: number;
  perUnitUnit: string;
  display: string;
}

const COUNT_RE = /(\d+(?:\.\d+)?)\s*(개입|개|pcs|PCS|매|봉|팩|포|입)/;
const AMOUNT_RE = /(\d+(?:\.\d+)?)\s*(kg|g|KG|G|l|L|ml|ML)/;

function normalizeUnit(unit: string): string {
  const lower = unit.toLowerCase();
  if (lower === 'kg') return 'kg';
  if (lower === 'g') return 'g';
  if (lower === 'l') return 'L';
  if (lower === 'ml') return 'ml';
  return unit;
}

function toBaseAmount(amount: number, unit: string): { amount: number; unit: string } {
  const normalized = normalizeUnit(unit);
  if (normalized === 'kg') return { amount: amount * 1000, unit: 'g' };
  if (normalized === 'L') return { amount: amount * 1000, unit: 'ml' };
  return { amount, unit: normalized };
}

function formatNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatTotal(amount: number, unit: string): string {
  return `${formatNumber(amount)}${normalizeUnit(unit)}`;
}

function findCount(specs: Array<{ label: string; value: string }>): { count: number; unit: string } | null {
  const preferred = specs.find((spec) => /수량|구성|입수|판매\s*단위|소분|포장|개입/i.test(`${spec.label} ${spec.value}`));
  const candidates = preferred ? [preferred, ...specs.filter((spec) => spec !== preferred)] : specs;

  for (const spec of candidates) {
    const match = `${spec.label} ${spec.value}`.match(COUNT_RE);
    if (!match) continue;
    const count = Number(match[1]);
    if (Number.isFinite(count) && count > 1) {
      return { count, unit: match[2] === '입' ? '개입' : match[2] };
    }
  }
  return null;
}

function findTotalAmount(specs: Array<{ label: string; value: string }>): { amount: number; unit: string } | null {
  const preferred = specs.filter((spec) => /총|중량|무게|용량|내용량|함량|규격/i.test(`${spec.label} ${spec.value}`));
  const candidates = [...preferred, ...specs.filter((spec) => !preferred.includes(spec))];

  for (const spec of candidates) {
    const match = `${spec.label} ${spec.value}`.match(AMOUNT_RE);
    if (!match) continue;
    const amount = Number(match[1]);
    if (Number.isFinite(amount) && amount > 0) {
      return { amount, unit: match[2] };
    }
  }
  return null;
}

export function extractSalesUnitInfo(specs: Array<{ label: string; value: string }>): SalesUnitInfo | null {
  const count = findCount(specs);
  const total = findTotalAmount(specs);
  if (!count || !total) return null;

  const base = toBaseAmount(total.amount, total.unit);
  const perUnitAmount = base.amount / count.count;
  if (!Number.isFinite(perUnitAmount) || perUnitAmount <= 0) return null;

  return {
    count: count.count,
    countUnit: count.unit,
    totalAmount: total.amount,
    totalUnit: normalizeUnit(total.unit),
    perUnitAmount,
    perUnitUnit: base.unit,
    display: `${formatNumber(count.count)}${count.unit} (총 ${formatTotal(total.amount, total.unit)}) / 개당 ${formatNumber(perUnitAmount)}${base.unit}`,
  };
}

export function normalizeSalesUnitSpecs(
  specs: Array<{ label: string; value: string }>,
): Array<{ label: string; value: string }> {
  const info = extractSalesUnitInfo(specs);
  if (!info) return specs;

  const withoutSalesUnit = specs.filter((spec) => !/판매\s*단위|소분\s*단위/i.test(spec.label));
  const normalized = [{ label: '판매 단위', value: info.display }, ...withoutSalesUnit];

  return normalized.map((spec) => {
    if (/원재료|함량|성분|내용량|용량|중량|무게/i.test(spec.label) && !spec.value.includes(info.display)) {
      return { ...spec, value: `${info.display} 기준 · ${spec.value}` };
    }
    return spec;
  });
}
