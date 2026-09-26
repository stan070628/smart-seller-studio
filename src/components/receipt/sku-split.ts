// src/components/receipt/sku-split.ts
// 영수증 확정 요청의 sku_splits를 만든다. 서버 규칙(src/lib/erp/ledger/receipt.ts resolveReceiptSplit)과 짝이다:
// 후보 1개 → 보내지 않는다(서버 자동) · 후보 없음 + 고른 SKU 1개 → qty null(입고 수량 전부) · 2개 이상 → 옵션별 수량.
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
}

export type SkuSplitsBody = Record<number, { sku_id: number; qty: number | null }[]>;

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
    if (choices.length === 0 || o.candidates.length === 1) continue;
    if (choices.length === 1) {
      out[lineNo] = [{ sku_id: choices[0].skuId, qty: null }];
      continue;
    }
    out[lineNo] = choices.map((c) => ({ sku_id: c.skuId, qty: parseInt(d?.qty[c.skuId] ?? '0', 10) || 0 }));
  }
  return out;
}
