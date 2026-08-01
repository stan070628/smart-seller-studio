'use client';

/**
 * SupplierCompare.tsx
 * 소싱리스트 행을 펼치면 나오는 두 공급처(도매꾹·1688) 비교 패널.
 *
 * 존재 이유: 도매꾹에서 미달인 상품이 1688에서는 통과하는 일이 흔하다.
 * 같은 상품을 두 공급처 원가로 나란히 세워야 그 역전이 눈에 보인다.
 *
 * 리드타임을 각 줄에 적는 이유: 1688이 거의 항상 싸다. 원가만 나란히 두면
 * "1688이 답"이라는 결론밖에 안 나오는데, 실제로는 해운 30일 + 통관을
 * 감당할 수 있는 상품이냐가 같이 걸린다. 그 조건을 숫자 옆에 붙여 둔다.
 *
 * 원가는 저장하지 않는다. 저장하는 것은 붙여넣기에서 뽑은 입력값
 * (원화 합계·위안 합계·수량·환율)과 사용자가 적는 개당 국제배송비뿐이고,
 * 실효원가·손익분기는 볼 때마다 cost-1688.ts가 다시 계산한다.
 * 관세율·수수료율 같은 정책값이 바뀌면 저장된 파생값은 조용히 낡기 때문이다.
 *
 * ShortlistTab.tsx에서 분리한 이유는 단순히 길이다 — 합치면 한 파일이
 * 800줄에 가까워져 한눈에 안 들어온다.
 */

import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { C as BASE_C } from '@/lib/design-tokens';
import { parse1688Checkout, type Parsed1688 } from '@/lib/sourcing/parse-1688-checkout';
import { supplierCostsOf } from '@/lib/sourcing/shortlist-supplier-costs';
import { ASSUMED_UNIT_WEIGHT_KG } from '@/lib/sourcing/intl-shipping';
import { judgeSupplier, type SupplierCost } from '@/lib/sourcing/supplier-verdict';
import type { ShortlistItem, LogisticsSize, Verdict } from '@/types/shortlist';

// 공통 토큰에 없는 시맨틱 색만 로컬로 확장한다 (ShortlistTab.tsx와 동일 관례).
const C = {
  ...BASE_C,
  danger: '#dc2626',
  dangerBg: 'rgba(220,38,38,0.08)',
  successBg: 'rgba(22,163,74,0.10)',
  warningBg: 'rgba(217,119,6,0.10)',
  mutedBg: 'rgba(113,113,122,0.10)',
  /** 중국 공급처 식별색 — 두 줄을 색으로도 구분한다 */
  cn: '#ea580c',
  cnBg: 'rgba(234,88,12,0.06)',
} as const;

/** 리드타임. 원가 옆에 늘 같이 보여야 "싼 쪽"이 답이 아닐 수 있다는 게 읽힌다 */
const LEAD_TIME_DOME = '국내 · 2~3일';
const LEAD_TIME_1688 = '해운 약 30일 + 통관';

function won(n: number | null): string {
  return n === null ? '—' : `${n.toLocaleString('ko-KR')}원`;
}

/** 위안 표기. 1688 화면이 소수 2자리로 보여주므로 그대로 맞춘다 */
function cny(n: number | null): string {
  return n === null ? '—' : `¥${n.toFixed(2)}`;
}

/** 8% / 6.5%처럼 필요한 자리만 남긴다 (8.0%로 쓰지 않는다) */
function pct(rate: number): string {
  return `${Number((rate * 100).toFixed(1))}%`;
}

type Tone = 'pass' | 'miss' | 'hold';

interface Judgement {
  tone: Tone;
  label: string;
  why: string;
}

/**
 * 색 관례: 통과는 success, 미달은 textSub, 판정 불가는 warning.
 *
 * 미달에 경고색을 쓰지 않는 이유: 후보 대부분이 미달이다. 흔한 정상 결과에
 * 경고색을 칠하면 화면이 온통 경고가 되어 진짜 경고(판정 불가)가 안 보인다.
 * 이 관례는 상단 표의 VERDICT_BADGE(미달=danger)와 다르다 — 표는 한 줄에
 * 하나씩 훑는 화면이고 여기는 두 줄을 대조하는 화면이라, 여기서는 "둘 중
 * 어느 쪽이 통과인가"만 도드라지면 된다.
 */
const TONE_STYLE: Record<Tone, { color: string; background: string }> = {
  pass: { color: C.success, background: C.successBg },
  miss: { color: C.textSub, background: C.mutedBg },
  hold: { color: C.warning, background: C.warningBg },
};

/**
 * 판정(Verdict)은 supplier-verdict.ts와 공유하고 색(Tone)은 이 패널 고유다.
 *
 * 미달에 경고색을 쓰지 않는 이유는 TONE_STYLE 주석 그대로 — 후보 대부분이
 * 미달이라, 흔한 정상 결과에 경고색을 쓰면 진짜 봐야 할 것이 묻힌다.
 */
const TONE_OF: Record<Verdict, Tone> = {
  pass: 'pass',
  fail: 'miss',
  unknown: 'hold',
  dead: 'hold',
};

const LABEL_OF: Record<Verdict, string> = {
  pass: '통과',
  fail: '미달',
  unknown: '판정 불가',
  dead: '판정 불가',
};

/**
 * 공유 판정 규칙을 이 패널의 표현으로 옮긴다.
 *
 * 규칙 자체(1만원 하한이 손익분기보다 먼저, 하한 미달이면 공급처와 무관)는
 * supplier-verdict.ts의 judgeSupplier에 있다. 예전에는 같은 규칙이 이 파일에
 * 한 벌 더 있었고, 상단 표까지 세 번째 사본을 만들 참이었다.
 *
 * cost가 null이면 원가를 세우지 못한 것이다 — 판정을 시도할 입력 자체가 없다.
 */
function toJudgement(
  coupangP25: number | null,
  cost: SupplierCost | null,
  size: LogisticsSize,
): Judgement {
  if (!cost) {
    return { tone: 'hold', label: '판정 불가', why: '원가를 계산하지 못했습니다' };
  }
  const j = judgeSupplier(coupangP25, cost, size);
  return { tone: TONE_OF[j.verdict], label: LABEL_OF[j.verdict], why: j.why };
}

function Verdict({ j }: { j: Judgement }) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10,
        fontSize: 12.5, fontWeight: 650, padding: '4px 11px', borderRadius: 999,
        fontVariantNumeric: 'tabular-nums', ...TONE_STYLE[j.tone],
      }}
    >
      {j.label}
      <span style={{ fontWeight: 500, opacity: 0.85 }}>— {j.why}</span>
    </span>
  );
}

/** 라벨 위·값 아래의 수치 한 칸. accent는 그 줄에서 가장 중요한 값(손익분기가)에만 준다 */
function Fig({
  label, value, accent = false, children,
}: {
  label: string;
  value?: string;
  accent?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 11, color: C.textMuted, letterSpacing: '0.03em' }}>{label}</span>
      {children ?? (
        <span style={{
          fontSize: 15, fontWeight: 650, fontVariantNumeric: 'tabular-nums',
          color: accent ? C.accent : C.text,
        }}>
          {value}
        </span>
      )}
    </div>
  );
}

const figsRowStyle: React.CSSProperties = {
  display: 'flex', gap: 20, flexWrap: 'wrap', margin: '9px 0 0',
};

function supplierName(name: string, note: string, color: string) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
      <span style={{ fontWeight: 700, fontSize: 14, color }}>{name}</span>
      <span style={{ fontSize: 12, color: C.textSub }}>{note}</span>
    </div>
  );
}

export default function SupplierCompare({
  item,
  onPatch,
  busy = false,
}: {
  item: ShortlistItem;
  /**
   * PATCH를 보내고 성공 여부를 돌려준다.
   * ShortlistTab.patchItem은 예외를 던지지 않고 boolean을 반환한다 —
   * 저장에 실패했는데 붙여넣은 원문을 지우면 사용자가 다시 긁어와야 한다.
   */
  onPatch: (itemNo: number, body: Record<string, unknown>) => Promise<boolean>;
  /** 부모가 다른 PATCH를 처리 중이면 입력을 잠근다 (표 전체가 흐려지는 것과 짝) */
  busy?: boolean;
}) {
  const [paste, setPaste] = useState('');
  const [parsed, setParsed] = useState<Parsed1688 | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 원가 조립은 shortlist-supplier-costs.ts가 맡는다 — 상단 표와 같은 값이어야 한다.
  // cost(1688 상세)는 관세·부가세 내역을 펼쳐 보여주는 데 쓴다.
  const { dome: domeCost, cn1688: cnCost, cn1688Detail: cost } = supplierCostsOf(item);

  // 도매꾹 줄 — 판매종료는 원가를 따질 상황이 아니라 판정 대신 사실만 적는다
  const domeJudge: Judgement =
    item.verdict === 'dead'
      ? { tone: 'miss', label: '판매종료', why: '도매꾹에서 내려간 상품입니다' }
      : toJudgement(item.coupangP25, domeCost, item.logisticsSize);

  const cnJudge: Judgement | null = cost
    ? toJudgement(item.coupangP25, cnCost, item.logisticsSize)
    : null;

  function runParse() {
    setErr(null);
    setParsed(parse1688Checkout(paste));
  }

  function clearPaste() {
    setPaste('');
    setParsed(null);
    setErr(null);
  }

  async function save() {
    if (!parsed?.ok || saving) return;
    setSaving(true);
    setErr(null);
    try {
      const ok = await onPatch(item.itemNo, {
        // 정수·소수 자릿수를 API 검증과 DB 컬럼(numeric(10,2)·numeric(8,2))에 맞춘다.
        // 화면에 보여준 값과 저장되는 값이 어긋나지 않게 여기서 맞춰 둔다.
        buyKrwTotal: Math.round(parsed.totalKrw!),
        buyCnyTotal: Math.round(parsed.totalCny! * 100) / 100,
        orderQty1688: parsed.qty!,
        exchangeRate1688: Math.round(parsed.exchangeRate! * 100) / 100,
      });
      // 성공했을 때만 원문을 지운다. 실패하고도 지우면 결제 화면을 다시 긁어와야 한다
      if (ok) clearPaste();
      else setErr('저장하지 못했습니다. 붙여넣은 내용은 그대로 두었습니다.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : '저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  }

  const locked = busy || saving;

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* ── 두 공급처 비교 ─────────────────────────────────────────── */}
      <div style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden',
      }}>
        {/* 도매꾹 */}
        <div style={{ borderLeft: `3px solid ${C.textSub}`, padding: '13px 15px' }}>
          {supplierName('도매꾹', LEAD_TIME_DOME, C.text)}
          <div style={figsRowStyle}>
            <Fig label="도매가" value={won(item.domePrice)} />
            <Fig label="개당 배송비" value={won(item.unitDeliFee)} />
            <Fig label="실효원가" value={won(item.effectiveCost)} />
            <Fig label="손익분기가" value={won(item.breakEvenPrice)} accent />
          </div>
          <Verdict j={domeJudge} />
        </div>

        {/* 1688 */}
        <div style={{
          borderLeft: `3px solid ${C.cn}`, borderTop: `1px solid ${C.border}`,
          background: C.cnBg, padding: '13px 15px',
        }}>
          {supplierName('1688', LEAD_TIME_1688, C.cn)}

          {!cost && (
            <p style={{ color: C.textMuted, fontSize: 13, margin: '8px 0 0' }}>
              아래에 1688 결제 확인 화면을 붙여넣고 저장하면 여기에 원가와 판정이 나옵니다.
            </p>
          )}

          {cost && (
            <>
              <div style={figsRowStyle}>
                <Fig label="개당 평균가" value={won(cost.unitKrw)} />
                <Fig label="개당 국제배송비">
                  {/*
                    비제어 입력이다. key를 item.intlShipPerUnit에 거는 이유는 상단 표의
                    쿠팡 실판가 입력과 같다 — defaultValue는 최초 마운트에만 반영되므로,
                    key 없이는 서버 값이 바뀌어도 화면엔 내가 마지막에 친 값이 남는다.
                  */}
                  <input
                    key={item.intlShipPerUnit ?? 'empty'}
                    defaultValue={item.intlShipPerUnit ?? ''}
                    onBlur={(e) => {
                      const raw = e.target.value.replace(/[^0-9]/g, '');
                      const next = raw === '' ? null : Number.parseInt(raw, 10);
                      // 값이 실제로 바뀐 경우에만 PATCH한다. 가드가 없으면 이 입력을
                      // 스쳐 지나가기만 해도 매번 쓰기가 나간다
                      if (next !== (item.intlShipPerUnit ?? null)) {
                        void onPatch(item.itemNo, { intlShipPerUnit: next });
                      }
                    }}
                    disabled={locked}
                    inputMode="numeric"
                    // 미입력이면 placeholder에 추정치를 그대로 띄운다. 흐린 글자라
                    // "아직 안 넣은 값"으로 읽히면서도, 위 실효원가가 어느 숫자에서
                    // 나왔는지가 같이 보인다.
                    placeholder={cost.shipEstimated ? String(cost.intlShipPerUnitKrw) : '0'}
                    aria-label={`${item.title} 개당 국제배송비`}
                    style={{
                      width: 96, padding: '4px 7px', textAlign: 'right',
                      fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
                      background: C.card, color: C.text,
                      border: `1px solid ${C.border}`, borderRadius: 4,
                    }}
                  />
                  {/*
                    추정치임을 반드시 화면에 적는다. 사람이 넣은 값과 구분되지 않으면
                    사후 수정을 유도할 수 없고, 아래 실효원가·손익분기가 실측처럼 읽힌다.
                  */}
                  {cost.shipEstimated && (
                    <span
                      style={{ fontSize: 11, color: C.warning, marginTop: 2, maxWidth: 200, lineHeight: 1.4 }}
                      title={`개당 ${ASSUMED_UNIT_WEIGHT_KG[item.logisticsSize]}kg 가정 × 사입 ${item.orderQty}개의 해운 요율에서 나온 값입니다. 실측이 아닙니다.`}
                    >
                      ~{cost.intlShipPerUnitKrw.toLocaleString('ko-KR')}원 추정 — 실제 청구액으로 고치세요
                    </span>
                  )}
                </Fig>
                <Fig label="실효원가" value={won(cost.effectiveCostKrw)} />
                <Fig label="손익분기가" value={won(cost.breakEvenPriceKrw)} accent />
              </div>

              {cnJudge && <Verdict j={cnJudge} />}

              {cost.shippingMissing && (
                <div style={{ color: C.warning, fontSize: 12.5, marginTop: 8 }}>
                  ⚠ 배송비 미반영 — 실제 원가는 더 높다. 배대지 → 한국 구간 요금을 개당으로 넣으세요.
                </div>
              )}

              {/* 원가의 내역. 관세·부가세가 어디서 왔는지 보이지 않으면 숫자를 못 믿는다 */}
              <div style={{
                marginTop: 11, paddingTop: 10, borderTop: `1px dashed ${C.border}`,
                fontSize: 12.5, color: C.textSub, fontVariantNumeric: 'tabular-nums',
              }}>
                <span style={{ display: 'inline-block', marginRight: 16 }}>
                  과세가격 <b style={{ color: C.text, fontWeight: 650 }}>{won(cost.dutiableValueKrw)}</b>
                </span>
                <span style={{ display: 'inline-block', marginRight: 16 }}>
                  관세 {pct(cost.tariffRate)} <b style={{ color: C.text, fontWeight: 650 }}>{won(cost.tariffKrw)}</b>
                </span>
                <span style={{ display: 'inline-block', marginRight: 16 }}>
                  수입 부가세 <b style={{ color: C.text, fontWeight: 650 }}>{won(cost.importVatKrw)}</b>
                </span>
              </div>

              {/* 저장된 입력값 — 이 원가가 어느 주문에서 나왔는지 되짚을 수 있어야 한다 */}
              <div style={{ marginTop: 6, fontSize: 12, color: C.textMuted, fontVariantNumeric: 'tabular-nums' }}>
                {cny(item.buyCnyTotal)} · {item.orderQty1688}개 · 환율{' '}
                {item.exchangeRate1688 === null ? '—' : `${item.exchangeRate1688.toFixed(2)}원/위안`}
                {item.pastedAt1688 && ` · ${new Date(item.pastedAt1688).toLocaleDateString('ko-KR')} 붙여넣음`}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── 붙여넣기 ────────────────────────────────────────────────── */}
      <div style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text }}>
            1688 결제 확인 붙여넣기
          </h4>
          <span style={{ fontSize: 12, color: C.textSub }}>
            장바구니가 아니라 결제 직전 화면입니다 — 개당가가 확정되는 유일한 지점
          </span>
        </div>

        <textarea
          value={paste}
          onChange={(e) => {
            setPaste(e.target.value);
            // 본문이 바뀌면 앞선 파싱 결과는 더 이상 이 텍스트의 결과가 아니다.
            // 지우지 않으면 화면에 보이는 것과 다른 값이 저장될 수 있다
            if (parsed) setParsed(null);
          }}
          spellCheck={false}
          disabled={locked}
          placeholder="1688 결제 확인 화면을 드래그해 복사한 뒤 여기에 붙여넣으세요"
          aria-label={`${item.title} 1688 결제 확인 화면 붙여넣기`}
          style={{
            width: '100%', minHeight: 96, resize: 'vertical', boxSizing: 'border-box',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 12, lineHeight: 1.6,
            color: C.text, background: C.bg,
            border: `1px solid ${C.border}`, borderRadius: 6, padding: '10px 11px',
          }}
        />

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
          <button onClick={runParse} disabled={locked || !paste.trim()} style={btn()}>
            파싱
          </button>
          <button onClick={clearPaste} disabled={locked || (!paste && !parsed)} style={btn()}>
            지우기
          </button>
          <button onClick={() => void save()} disabled={locked || !parsed?.ok} style={btn(true)}>
            {saving && <Loader2 size={13} className="animate-spin" />}
            저장
          </button>
        </div>

        {/* 파싱 실패 — 파서가 만든 문장을 그대로 보여준다. 저장 버튼은 열리지 않는다 */}
        {parsed && !parsed.ok && (
          <div style={{
            marginTop: 10, padding: '8px 11px', borderRadius: 6,
            background: C.warningBg, color: C.warning, fontSize: 12.5, lineHeight: 1.6,
          }}>
            ⚠ {parsed.error}
          </div>
        )}

        {parsed?.ok && (
          <>
            <div style={{
              marginTop: 10, padding: '7px 11px', borderRadius: 6,
              background: C.successBg, color: C.success, fontSize: 12.5,
              fontVariantNumeric: 'tabular-nums',
            }}>
              ✓ 검산 통과{' '}
              <span style={{ opacity: 0.85, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11.5 }}>
                상품 {cny(parsed.goodsCny)} − 할인 {cny(parsed.discountCny ?? 0)} + 운임{' '}
                {cny(parsed.freightCny)} = 합계 {cny(parsed.totalCny)}
              </span>
            </div>

            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
              gap: '12px 20px', marginTop: 12,
            }}>
              <Fig label="합계 (위안)" value={cny(parsed.totalCny)} />
              <Fig label="합계 (원화)" value={won(parsed.totalKrw)} />
              <Fig label="총 수량" value={`${parsed.qty}개`} />
              {/*
                실효환율은 소수 2자리로 보여준다. 저장 컬럼이 numeric(8,2)라 어차피
                2자리로 반올림되므로, 미리보기를 더 정밀하게 보여주면 저장 후 값이
                달라 보인다
              */}
              <Fig
                label="실효환율"
                value={parsed.exchangeRate === null ? '—' : `${parsed.exchangeRate.toFixed(2)}원/위안`}
              />
              <Fig label="개당 평균가" value={won(parsed.unitKrw)} accent />
            </div>
          </>
        )}

        {err && (
          <div style={{
            marginTop: 10, padding: '8px 11px', borderRadius: 6,
            background: C.dangerBg, color: C.danger, fontSize: 12.5,
          }}>
            {err}
          </div>
        )}
      </div>
    </div>
  );
}

function btn(primary = false): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '7px 13px', borderRadius: 6, fontSize: 13, fontWeight: 600,
    cursor: 'pointer',
    border: primary ? 'none' : `1px solid ${C.border}`,
    background: primary ? C.accent : C.card,
    color: primary ? '#fff' : C.text,
  };
}
