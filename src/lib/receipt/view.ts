/**
 * 화면이 상태를 판단하지 않게 한다.
 *
 * 초안 하나의 상태는 ocr_status(4) × verify_status(3) × status(3) 조합이라
 * 컴포넌트 안에서 if로 풀면 반드시 빠뜨린다. 우선순위를 여기 한 곳에 둔다.
 */

export type BadgeTone = 'ok' | 'warn' | 'danger' | 'neutral';

export interface Badge {
  label: string;
  tone: BadgeTone;
  /** true면 화면이 폴링해야 한다 */
  busy: boolean;
}

export interface DraftLike {
  ocr_status: 'pending' | 'parsing' | 'parsed' | 'failed';
  verify_status: 'matched' | 'mismatch' | 'unreadable';
  status: 'draft' | 'done' | 'discarded';
}

/**
 * 우선순위: 종결 상태 → 판독 상태 → 검산 상태.
 * 완료된 초안의 검산 결과는 더 이상 행동을 바꾸지 않으므로 뒤로 밀린다.
 */
export function draftBadge(draft: DraftLike): Badge {
  if (draft.status === 'discarded') return { label: '폐기', tone: 'neutral', busy: false };
  if (draft.status === 'done') return { label: '입고 완료', tone: 'ok', busy: false };

  if (draft.ocr_status === 'pending') return { label: '판독 대기', tone: 'neutral', busy: true };
  if (draft.ocr_status === 'parsing') return { label: '판독 중', tone: 'neutral', busy: true };
  if (draft.ocr_status === 'failed') return { label: '판독 실패', tone: 'danger', busy: false };

  if (draft.verify_status === 'mismatch') return { label: '검산 불일치', tone: 'warn', busy: false };
  if (draft.verify_status === 'unreadable') return { label: '검산 불가', tone: 'neutral', busy: false };
  return { label: '검산 통과', tone: 'ok', busy: false };
}

export interface ProgressLine {
  is_discount: boolean;
  decision: 'pending' | 'ingest' | 'skip';
  product_cost_id: string | null;
  cost_entry_id: string | null;
}

export interface Progress {
  /** 할인 줄을 뺀 품목 줄 수 */
  total: number;
  confirmed: number;
  /** 지금 확정 버튼을 누르면 들어갈 줄 */
  ready: number;
  /** 입고하기로 했는데 상품이 안 붙은 줄 */
  blocked: number;
  /** 입고인지 제외인지 아직 안 정한 줄 */
  undecided: number;
}

/**
 * 할인 줄은 총계에서 뺀다. 사람이 손댈 대상이 아니고,
 * 세면 "13줄 중 11줄 확정"처럼 영원히 끝나지 않는 표시가 된다.
 */
export function draftProgress(lines: ProgressLine[]): Progress {
  const items = lines.filter((l) => !l.is_discount);
  const p: Progress = { total: items.length, confirmed: 0, ready: 0, blocked: 0, undecided: 0 };

  for (const l of items) {
    if (l.cost_entry_id != null) { p.confirmed++; continue; }
    if (l.decision === 'skip') continue;
    if (l.decision === 'pending') { p.undecided++; continue; }
    if (!l.product_cost_id) { p.blocked++; continue; }
    p.ready++;
  }

  return p;
}
