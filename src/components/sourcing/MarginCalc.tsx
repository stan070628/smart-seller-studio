'use client';

import { useState } from 'react';
import {
  DEFAULT_EXCHANGE_RATE_KRW_PER_RMB,
  DEFAULT_TARIFF_RATE,
  calc1688Margin,
  compareWholesaleVsBuy,
  type Margin1688Input,
  type Margin1688Result,
  type CompareResult,
  type Channel,
} from '@/lib/sourcing/margin-1688';

const CATEGORY_OPTIONS = [
  '생활용품',
  '주방용품',
  '욕실용품',
  '청소/세탁',
  '자동차용품',
  '스포츠/아웃도어',
  '가방/지갑',
  '패션잡화',
  '패션의류',
  '유아/아동',
  '완구/장난감',
  '건강/의료',
  '기타',
] as const;

const CHANNEL_OPTIONS: ReadonlyArray<{ value: Channel; label: string }> = [
  { value: 'coupang', label: '쿠팡 (그로스/일반)' },
  { value: 'naver', label: '네이버 스마트스토어' },
];

const RECO_STYLE: Record<
  CompareResult['recommendation'],
  { bg: string; border: string; emoji: string; label: string }
> = {
  buy_strong:        { bg: 'bg-emerald-50', border: 'border-emerald-400', emoji: '🚀', label: '강력 사입 권장' },
  buy:               { bg: 'bg-green-50',   border: 'border-green-400',   emoji: '✅', label: '사입 권장' },
  hold:              { bg: 'bg-yellow-50',  border: 'border-yellow-400',  emoji: '⏸️', label: '전환 보류' },
  wholesale_only:    { bg: 'bg-orange-50',  border: 'border-orange-400',  emoji: '🛒', label: '위탁 유지' },
  insufficient_data: { bg: 'bg-gray-50',    border: 'border-gray-300',    emoji: '❓', label: '데이터 부족' },
};

interface FormState extends Omit<Margin1688Input, 'categoryName' | 'channel'> {
  categoryName: string;
  channel: Channel;
  wholesaleMarginPerUnitKrw: number;
  monthlySalesQty: number;
}

const INITIAL: FormState = {
  buyPriceRmb: 0,
  exchangeRate: DEFAULT_EXCHANGE_RATE_KRW_PER_RMB,
  tariffRate: DEFAULT_TARIFF_RATE,
  shippingPerUnitKrw: 1000,
  packQty: 1,
  channel: 'coupang',
  categoryName: '생활용품',
  sellPrice: 0,
  groceryRunningCost: 0,
  wholesaleMarginPerUnitKrw: 0,
  monthlySalesQty: 0,
};

export default function MarginCalc() {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [result, setResult] = useState<Margin1688Result | null>(null);
  const [compare, setCompare] = useState<CompareResult | null>(null);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleCalculate() {
    const r = calc1688Margin({
      buyPriceRmb: form.buyPriceRmb,
      exchangeRate: form.exchangeRate,
      tariffRate: form.tariffRate,
      shippingPerUnitKrw: form.shippingPerUnitKrw,
      packQty: Math.max(form.packQty, 1),
      channel: form.channel,
      categoryName: form.categoryName,
      sellPrice: form.sellPrice,
      groceryRunningCost: form.groceryRunningCost,
    });
    setResult(r);

    if (form.wholesaleMarginPerUnitKrw > 0 && form.monthlySalesQty > 0) {
      const buyCapital = (r.purchaseCostKrw + form.shippingPerUnitKrw) * form.monthlySalesQty;
      const c = compareWholesaleVsBuy({
        wholesaleMarginPerUnitKrw: form.wholesaleMarginPerUnitKrw,
        buyMarginPerUnitKrw: r.netProfit,
        monthlySalesQty: form.monthlySalesQty,
        buyCapitalNeededKrw: buyCapital,
      });
      setCompare(c);
    } else {
      setCompare(null);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded border border-gray-200 p-4">
        <h2 className="mb-3 text-base font-semibold">입력</h2>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <NumField label="1688 박스가 (위안)" value={form.buyPriceRmb} onChange={(v) => update('buyPriceRmb', v)} step={0.01} />
          <NumField label="입수 (개/박스)" value={form.packQty} onChange={(v) => update('packQty', v)} step={1} />
          <NumField label="환율 (원/위안)" value={form.exchangeRate} onChange={(v) => update('exchangeRate', v)} step={0.1} />
          <NumField label="관세율 (0.08 = 8%)" value={form.tariffRate} onChange={(v) => update('tariffRate', v)} step={0.01} />
          <NumField label="개당 국제배송 (원)" value={form.shippingPerUnitKrw} onChange={(v) => update('shippingPerUnitKrw', v)} step={100} />
          <NumField label="개당 그로스 운영비 (원)" value={form.groceryRunningCost} onChange={(v) => update('groceryRunningCost', v)} step={100} hint="입고+보관+출고. 그로스 미사용 0" />
          <SelectField
            label="채널"
            value={form.channel}
            options={CHANNEL_OPTIONS}
            onChange={(v) => update('channel', v as Channel)}
          />
          <SelectField
            label="카테고리"
            value={form.categoryName}
            options={CATEGORY_OPTIONS.map((c) => ({ value: c, label: c }))}
            onChange={(v) => update('categoryName', v)}
          />
          <NumField label="판매가 (원)" value={form.sellPrice} onChange={(v) => update('sellPrice', v)} step={100} />
          <div className="col-span-2 mt-2 border-t border-gray-200 pt-3">
            <h3 className="mb-2 text-sm font-semibold">위탁 비교 (선택)</h3>
            <div className="grid grid-cols-2 gap-3">
              <NumField label="도매꾹 위탁 개당 마진 (원)" value={form.wholesaleMarginPerUnitKrw} onChange={(v) => update('wholesaleMarginPerUnitKrw', v)} step={100} />
              <NumField label="월 판매량 (개)" value={form.monthlySalesQty} onChange={(v) => update('monthlySalesQty', v)} step={1} />
            </div>
          </div>
        </div>
        <button
          onClick={handleCalculate}
          className="mt-4 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          계산
        </button>
      </section>

      <section className="space-y-4">
        {result && <ResultCard r={result} />}
        {compare && <CompareCard c={compare} />}
        {!result && (
          <div className="rounded border border-gray-200 p-6 text-center text-sm text-gray-500">
            입력값을 채우고 계산을 실행하세요.
          </div>
        )}
      </section>
    </div>
  );
}

function NumField({
  label, value, onChange, step, hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step: number;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium">{label}</span>
      <input
        type="number"
        step={step}
        value={value || ''}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
      />
      {hint && <span className="mt-0.5 block text-[10px] text-gray-500">{hint}</span>}
    </label>
  );
}

function SelectField<T extends string>({
  label, value, options, onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

function ResultCard({ r }: { r: Margin1688Result }) {
  const profitColor = r.netProfit > 0 ? 'text-green-700' : 'text-red-700';
  return (
    <div className="rounded border border-blue-200 bg-blue-50 p-4">
      <h2 className="mb-3 text-base font-semibold">실 마진 결과</h2>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <Row label="환율 적용 원가" value={`${r.landedKrw.toLocaleString()} 원`} />
        <Row label="관세" value={`${r.tariffKrw.toLocaleString()} 원`} />
        <Row label="수입 VAT" value={`${r.importVatKrw.toLocaleString()} 원`} />
        <Row label="입고 직전 사입원가" value={`${r.purchaseCostKrw.toLocaleString()} 원`} />
        <Row label="총 원가 (그로스 포함)" value={`${r.totalCostKrw.toLocaleString()} 원`} />
        <Row label="채널 수수료" value={`${r.channelFeeKrw.toLocaleString()} 원 (${(r.channelFeeRate * 100).toFixed(2)}%)`} />
        <Row label="매출 VAT" value={`${r.sellVatKrw.toLocaleString()} 원`} />
        <Row label="순이익" value={`${r.netProfit.toLocaleString()} 원`} valueClass={profitColor} bold />
        <Row label="마진율" value={`${r.marginRatePct}%`} valueClass={profitColor} bold />
      </dl>
    </div>
  );
}

function CompareCard({ c }: { c: CompareResult }) {
  const s = RECO_STYLE[c.recommendation];
  return (
    <div className={`rounded border p-4 ${s.bg} ${s.border}`}>
      <h2 className="mb-1 text-base font-semibold">{s.emoji} {s.label}</h2>
      <p className="text-sm text-gray-700">{c.reason}</p>
      {c.monthlyDiffKrw > 0 && (
        <p className="mt-1 text-xs text-gray-600">월간 마진 차액: {c.monthlyDiffKrw.toLocaleString()} 원</p>
      )}
      {c.paybackMonths !== null && (
        <p className="text-xs text-gray-600">자본 회수 기간: {c.paybackMonths.toFixed(2)} 개월</p>
      )}
    </div>
  );
}

function Row({ label, value, valueClass = '', bold = false }: { label: string; value: string; valueClass?: string; bold?: boolean }) {
  return (
    <>
      <dt className="text-gray-600">{label}</dt>
      <dd className={`text-right ${bold ? 'font-semibold' : ''} ${valueClass}`}>{value}</dd>
    </>
  );
}
