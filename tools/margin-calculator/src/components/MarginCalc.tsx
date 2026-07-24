
import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_EXCHANGE_RATE_KRW_PER_RMB,
  DEFAULT_TARIFF_RATE,
  calc1688Margin,
  compareWholesaleVsBuy,
  type Margin1688Input,
  type Margin1688Result,
  type CompareResult,
  type Channel,
} from '../lib/margin-1688';
import { parse1688Paste, type Parsed1688 } from '../lib/parse-1688';
import { fetchCnyKrw } from '../lib/fx';
import {
  calcGroceryCost,
  DEFAULT_GROCERY_INPUT,
  ROCKET_SIZES,
  SIZE_CRITERIA,
  CONFIRMED_SIZES,
  type GroceryCostBreakdown,
  type RocketSize,
} from '../lib/grocery-cost';

const DEFAULT_FX_BUFFER_PCT = 3;

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

// groceryRunningCost 는 그로스 운영비 breakdown 에서 자동 산출하므로 폼에서 제외한다.
interface FormState
  extends Omit<Margin1688Input, 'categoryName' | 'channel' | 'groceryRunningCost'> {
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
  wholesaleMarginPerUnitKrw: 0,
  monthlySalesQty: 0,
};

/** 그로스 운영비 breakdown 입력 (channel 은 form.channel 을 따라감) */
interface GroceryState {
  size: RocketSize;
  parcelFee: number;
  storageDays: number;
  returnRatePct: number;
  returnCostPerCase: number;
  packagingCost: number;
  saver: boolean;
}

const INITIAL_GROCERY: GroceryState = {
  size: DEFAULT_GROCERY_INPUT.size,
  parcelFee: DEFAULT_GROCERY_INPUT.parcelFee,
  storageDays: DEFAULT_GROCERY_INPUT.storageDays,
  returnRatePct: DEFAULT_GROCERY_INPUT.returnRatePct,
  returnCostPerCase: DEFAULT_GROCERY_INPUT.returnCostPerCase,
  packagingCost: DEFAULT_GROCERY_INPUT.packagingCost,
  saver: DEFAULT_GROCERY_INPUT.saver,
};

type FxStatus = 'idle' | 'loading' | 'ok' | 'error';

export default function MarginCalc() {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [result, setResult] = useState<Margin1688Result | null>(null);
  const [compare, setCompare] = useState<CompareResult | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [parsed, setParsed] = useState<Parsed1688 | null>(null);

  // 그로스 운영비 breakdown
  const [grocery, setGrocery] = useState<GroceryState>(INITIAL_GROCERY);
  const breakdown: GroceryCostBreakdown = useMemo(
    () => calcGroceryCost({ channel: form.channel, ...grocery }),
    [form.channel, grocery],
  );

  // 실시간 환율
  const [fxBase, setFxBase] = useState<number | null>(null);
  const [fxBufferPct, setFxBufferPct] = useState(DEFAULT_FX_BUFFER_PCT);
  const [fxStatus, setFxStatus] = useState<FxStatus>('idle');
  const [fxInfo, setFxInfo] = useState<{ date: string; source: string } | null>(null);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function updateGrocery<K extends keyof GroceryState>(key: K, value: GroceryState[K]) {
    setGrocery((g) => ({ ...g, [key]: value }));
  }

  /** 기준환율 + 버퍼 → 적용 환율(원/위안) */
  function applyFxRate(base: number, bufferPct: number) {
    const rate = Math.round(base * (1 + bufferPct / 100) * 10) / 10;
    update('exchangeRate', rate);
  }

  async function refreshFx() {
    setFxStatus('loading');
    try {
      const fx = await fetchCnyKrw();
      setFxBase(fx.rate);
      setFxInfo({ date: fx.date, source: fx.source });
      setFxStatus('ok');
      applyFxRate(fx.rate, fxBufferPct);
    } catch {
      setFxStatus('error');
    }
  }

  // 마운트 시 1회 자동 조회
  useEffect(() => {
    void refreshFx();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onBufferChange(v: number) {
    setFxBufferPct(v);
    if (fxBase !== null) applyFxRate(fxBase, v);
  }

  function handlePaste(text: string) {
    setPasteText(text);
    if (!text.trim()) {
      setParsed(null);
      return;
    }
    const p = parse1688Paste(text);
    setParsed(p);
    // 단가를 인식했으면 '1688 박스가'에 자동 입력하고, 입수는 개당 기준(1)으로 맞춘다.
    if (p.unitPrice !== null) {
      setForm((f) => ({ ...f, buyPriceRmb: p.unitPrice as number, packQty: 1 }));
    }
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
      groceryRunningCost: breakdown.total,
    });
    setResult(r);

    if (form.wholesaleMarginPerUnitKrw > 0 && form.monthlySalesQty > 0) {
      const buyCapital = r.purchaseCostKrw * form.monthlySalesQty;
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

        <div className="mb-4 rounded border border-dashed border-blue-300 bg-blue-50/50 p-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold text-blue-800">📋 1688 붙여넣기</span>
            {pasteText && (
              <button
                type="button"
                onClick={() => handlePaste('')}
                className="text-[11px] text-gray-500 hover:text-gray-700"
              >
                지우기
              </button>
            )}
          </div>
          <textarea
            value={pasteText}
            onChange={(e) => handlePaste(e.target.value)}
            rows={2}
            placeholder="1688 주문 화면에서 상품 줄을 드래그해 복사한 뒤 여기에 붙여넣기 (Ctrl+V)"
            className="w-full resize-y rounded border border-gray-300 px-2 py-1 text-xs text-gray-900"
          />
          {parsed && <PasteResult parsed={parsed} />}
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <NumField label="1688 박스가 (위안)" value={form.buyPriceRmb} onChange={(v) => update('buyPriceRmb', v)} step={0.01} />
          <NumField label="입수 (개/박스)" value={form.packQty} onChange={(v) => update('packQty', v)} step={1} />
          <div className="col-span-2">
            <div className="grid grid-cols-2 gap-3">
              <NumField label="환율 (원/위안)" value={form.exchangeRate} onChange={(v) => update('exchangeRate', v)} step={0.1} />
              <NumField label="환율 버퍼 (%)" value={fxBufferPct} onChange={onBufferChange} step={0.5} hint="구매대행 수취/우대환율 근사" />
            </div>
            <FxStatusLine
              status={fxStatus}
              base={fxBase}
              bufferPct={fxBufferPct}
              info={fxInfo}
              onRefresh={() => void refreshFx()}
            />
          </div>
          <NumField label="관세율 (0.08 = 8%)" value={form.tariffRate} onChange={(v) => update('tariffRate', v)} step={0.01} />
          <NumField label="개당 국제배송 (원)" value={form.shippingPerUnitKrw} onChange={(v) => update('shippingPerUnitKrw', v)} step={100} />
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

          <GrocerySection
            channel={form.channel}
            grocery={grocery}
            breakdown={breakdown}
            onChange={updateGrocery}
          />

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

function FxStatusLine({
  status, base, bufferPct, info, onRefresh,
}: {
  status: FxStatus;
  base: number | null;
  bufferPct: number;
  info: { date: string; source: string } | null;
  onRefresh: () => void;
}) {
  const applied =
    base !== null ? Math.round(base * (1 + bufferPct / 100) * 10) / 10 : null;
  return (
    <div className="mt-1 flex items-center gap-2 text-[11px]">
      <button
        type="button"
        onClick={onRefresh}
        disabled={status === 'loading'}
        className="rounded border border-gray-300 px-1.5 py-0.5 text-gray-600 hover:bg-gray-100 disabled:opacity-50"
      >
        🔄 {status === 'loading' ? '조회 중…' : '새로고침'}
      </button>
      {status === 'ok' && base !== null && (
        <span className="text-gray-600">
          기준환율 <b>{base}</b>원 ({info?.source}{info?.date ? ` · ${info.date}` : ''}) · 버퍼 {bufferPct}% → <b className="text-blue-800">{applied}</b>원 적용
        </span>
      )}
      {status === 'error' && (
        <span className="text-orange-600">⚠️ 실시간 조회 실패 — 수동 입력 값 사용</span>
      )}
      {status === 'loading' && <span className="text-gray-500">실시간 환율 불러오는 중…</span>}
    </div>
  );
}

function GrocerySection({
  channel, grocery, breakdown, onChange,
}: {
  channel: Channel;
  grocery: GroceryState;
  breakdown: GroceryCostBreakdown;
  onChange: <K extends keyof GroceryState>(key: K, value: GroceryState[K]) => void;
}) {
  const isCoupang = channel === 'coupang';
  const sizeConfirmed = CONFIRMED_SIZES.includes(grocery.size);
  const freeDays = grocery.saver ? 60 : 30;
  return (
    <div className="col-span-2 mt-2 rounded border border-gray-200 bg-gray-50/60 p-3">
      <h3 className="mb-0.5 text-sm font-semibold">그로스 운영비 (자동 합산)</h3>
      <p className="mb-2 text-[10px] text-gray-500">
        쿠팡 로켓그로스 비용 페이지 기준(2026-07, VAT 별도·프로모션 반영). 극소형/소형/중형은 확인값, 대형1/대형2/특대형은 추정. 판매가·카테고리에 따라 변동.
      </p>
      {isCoupang && (
        <label className="mb-2 flex items-center gap-1.5 text-[11px] text-gray-700">
          <input type="checkbox" checked={grocery.saver} onChange={(e) => onChange('saver', e.target.checked)} />
          로켓그로스 세이버 (보관 60일 무료 + 반품 회수/재입고비 무제한 무료)
        </label>
      )}
      <div className="grid grid-cols-2 gap-3">
        {isCoupang ? (
          <div>
            <SelectField
              label="로켓그로스 사이즈"
              value={grocery.size}
              options={ROCKET_SIZES.map((s) => ({ value: s, label: sizeConfirmed || CONFIRMED_SIZES.includes(s) ? s : `${s} (추정)` }))}
              onChange={(v) => onChange('size', v as RocketSize)}
            />
            <span className="mt-0.5 block text-[10px] text-gray-500">
              {SIZE_CRITERIA[grocery.size]}{sizeConfirmed ? '' : ' · ⚠️ 요율 미확인(추정)'}
            </span>
          </div>
        ) : (
          <NumField label="개당 택배비 (원)" value={grocery.parcelFee} onChange={(v) => onChange('parcelFee', v)} step={100} />
        )}
        {isCoupang && (
          <NumField label={`예상 보관일 (무료 ${freeDays}일)`} value={grocery.storageDays} onChange={(v) => onChange('storageDays', v)} step={1} hint={`${freeDays}일 초과분만 과금`} />
        )}
        <NumField label="반품률 (%)" value={grocery.returnRatePct} onChange={(v) => onChange('returnRatePct', v)} step={0.5} />
        <NumField label="회당 반품처리비 (원)" value={grocery.returnCostPerCase} onChange={(v) => onChange('returnCostPerCase', v)} step={500} hint="월 20건 무료, 초과분만 입력" />
        <NumField label="포장/부자재비 (원)" value={grocery.packagingCost} onChange={(v) => onChange('packagingCost', v)} step={100} />
      </div>
      <div className="mt-2 border-t border-gray-200 pt-2 text-[11px] text-gray-700">
        {isCoupang
          ? <>입출고 {breakdown.inout.toLocaleString()} + 배송 {breakdown.shipping.toLocaleString()} + 보관 {breakdown.storage.toLocaleString()} + 반품 {breakdown.returnCost.toLocaleString()} + 포장 {breakdown.packaging.toLocaleString()}</>
          : <>택배 {breakdown.shipping.toLocaleString()} + 반품 {breakdown.returnCost.toLocaleString()} + 포장 {breakdown.packaging.toLocaleString()}</>
        } = 개당 <b className="text-blue-800">{breakdown.total.toLocaleString()}원</b>
      </div>
    </div>
  );
}

function PasteResult({ parsed }: { parsed: Parsed1688 }) {
  if (parsed.unitPrice === null) {
    return (
      <p className="mt-2 text-[11px] text-red-600">
        단가를 인식하지 못했어요. 상품 줄(수량·단가·합계가 보이는 부분)을 다시 긁어 붙여넣어 주세요.
      </p>
    );
  }
  return (
    <div className="mt-2 space-y-1">
      <p className="text-[11px] text-blue-800">
        인식: 단가 <b>{parsed.unitPrice}</b>
        {parsed.quantity !== null && <> · 수량 <b>{parsed.quantity}</b></>}
        {parsed.total !== null && <> · 합계 <b>{parsed.total}</b></>}
        {' '}→ &lsquo;1688 박스가&rsquo;에 자동 입력됨
      </p>
      {parsed.currency === 'usd' && (
        <p className="text-[11px] font-medium text-orange-600">
          ⚠️ 달러(USD)로 표시된 화면이에요. 계산기는 위안 기준이라, 위안가로 바꿔 넣거나 환율을 달러 기준으로 조정하세요.
        </p>
      )}
      {parsed.currency === 'unknown' && (
        <p className="text-[11px] text-gray-500">
          통화 표기를 못 찾았어요. 단가가 위안(元) 기준이 맞는지 확인하세요.
        </p>
      )}
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
        className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm text-gray-900"
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
        className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm text-gray-900"
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
