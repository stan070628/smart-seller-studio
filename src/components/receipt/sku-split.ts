// src/components/receipt/sku-split.ts
// 영수증 확정 요청의 sku_splits를 만든다. 서버 규칙(src/lib/erp/ledger/receipt.ts resolveReceiptSplit)과 짝이다:
// 후보 1개 → 보내지 않는다(서버 자동) · 후보 1개인데 「다른 SKU로 바꾸기」 → 그 SKU 전부(manual) ·
// 후보 없음 + 고른 SKU 1개 → qty null(입고 수량 전부) · 2개 이상 → 옵션별 수량.
export interface SkuCandidateView {
  skuId: number;
  key: string;
  name: string;
  option: string;
}

export interface LineSkuOptions {
  source: 'learned' | 'product' | 'none';
  candidates: SkuCandidateView[];
  expectedQty: { qty: number; approx: boolean } | null;
}

export interface SplitDraft {
  /** 후보가 없을 때 사람이 검색해 고른 SKU */
  picked: SkuCandidateView[];
  /** skuId → 입력 문자열 */
  qty: Record<number, string>;
  /** 후보가 하나일 때 「다른 SKU로 바꾸기」로 고른 SKU. 서버에 manual 표시로 간다 */
  override?: SkuCandidateView | null;
}

export type SkuSplitsBody = Record<number, { sku_id: number; qty: number | null; manual?: true }[]>;

export const emptyDraft = (): SplitDraft => ({ picked: [], qty: {} });

export function choicesOf(o: LineSkuOptions, d: SplitDraft | undefined): SkuCandidateView[] {
  return o.candidates.length > 0 ? o.candidates : (d?.picked ?? []);
}

export function splitSum(choices: SkuCandidateView[], d: SplitDraft | undefined): number {
  return choices.reduce((s, c) => s + (parseInt(d?.qty[c.skuId] ?? '0', 10) || 0), 0);
}

export function toSkuSplits(options: Record<number, LineSkuOptions>, drafts: Record<number, SplitDraft>): SkuSplitsBody {
  const out: SkuSplitsBody = {};
  for (const [k, o] of Object.entries(options)) {
    const lineNo = Number(k);
    const d = drafts[lineNo];
    const choices = choicesOf(o, d);
    if (o.candidates.length === 1) {
      if (d?.override) out[lineNo] = [{ sku_id: d.override.skuId, qty: null, manual: true }];
      continue;
    }
    if (choices.length === 0) continue;
    if (choices.length === 1) {
      out[lineNo] = [{ sku_id: choices[0].skuId, qty: null }];
      continue;
    }
    out[lineNo] = choices.map((c) => ({ sku_id: c.skuId, qty: parseInt(d?.qty[c.skuId] ?? '0', 10) || 0 }));
  }
  return out;
}

/**
 * 확정 전에 화면이 막을 줄 번호(오름차순). 서버도 같은 검사를 하지만, 틀린 채 보내면 그 줄만 실패해 다시 해야 한다.
 * - 후보 없는 줄인데 SKU를 고르지 않았다
 * - 옵션이 2개 이상인데 나눈 합이 입고 수량과 다르다(소분 추정 수량은 이월을 모르므로 서버에 맡긴다)
 */
export function blockedLines(options: Record<number, LineSkuOptions>, drafts: Record<number, SplitDraft>): number[] {
  const out: number[] = [];
  for (const [k, o] of Object.entries(options)) {
    const lineNo = Number(k);
    const d = drafts[lineNo];
    const choices = choicesOf(o, d);
    if (o.candidates.length === 0 && choices.length === 0) { out.push(lineNo); continue; }
    if (choices.length >= 2 && o.expectedQty && !o.expectedQty.approx && splitSum(choices, d) !== o.expectedQty.qty) out.push(lineNo);
  }
  return out.sort((a, b) => a - b);
}

/**
 * PC 영수증 모달(ReceiptIngestModal)이 확정을 막을 줄 번호(오름차순) — 옵션 나누기·SKU 고르기가 필요한 줄.
 * 나누기·고르기 전의 blockedLines와 같은 기준(후보 0개 · 2개 이상)이되, 소분 추정 수량 줄도 넣는다 —
 * PC 모달에는 나누기 화면이 없어 서버에 맡길 수 없다. 이런 줄은 휴대폰 영수증 화면(/m/receipt/<id>)에서 확정한다.
 */
export function linesNeedingPhone(options: Record<number, LineSkuOptions>): number[] {
  return Object.entries(options)
    .filter(([, o]) => o.candidates.length !== 1)
    .map(([k]) => Number(k))
    .sort((a, b) => a - b);
}

/** 확정 응답 skipped_pre_opening(실사 이전 구매라 원장 입고를 건너뛴 SKU) → 안내 한 줄. 없으면 null */
export function preOpeningNotice(list: { name: string }[] | undefined | null): string | null {
  if (!list || list.length === 0) return null;
  return `실사 이전 구매라 원장 입고는 건너뜀: ${[...new Set(list.map((x) => x.name))].join(', ')}`;
}
