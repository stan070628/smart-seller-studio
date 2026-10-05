// src/lib/erp/stock/rg-auto.ts
// (1-C2b ④ · 1-C2c) 매일 RG 대조의 판정(순수). 설계 결정 2: 입고 완료만 자동 — RG 실재고가 원장보다 많고 그 SKU에 입고중(rg_inbound)이 있으면
// min(차이, 입고중)만큼 입고중 → RG. (1-C2c) 남은 증가는 복귀 한도(최근 30일 RG 판매 − 최근 30일 복귀)까지 「취소·반품 복귀」 — RG API는 취소·반품을
// 주지 않아 실재고로만 보인다(2026-10-05 실측). 그 밖은 알림만: 한도를 넘는 증가 · 2회 연속 감소(분실·파손 의심) · 입고중 7일 초과 · 연결 안 된 RG 번호.
// 전제: 판매 차감이 켜져 있다(꺼져 있으면 판매분이 차이로 보인다 — 실행기가 막는다).

export const STALE_DAYS = 7;

export interface Inflow {
  /** 원장 줄 id — 역전표 짝 맞춤용(없으면 짝을 찾지 않는다) */
  id?: number;
  /** 역전표면 되돌린 원 줄 id */
  reversesId?: number | null;
  /** rg_inbound 원장 줄 수량(+ 들어옴 / − 나감) */
  qty: number;
  occurredAt: string;
}

export interface RgAutoRow {
  skuId: number;
  /** 원장 RG */
  ledger: number;
  /** 쿠팡 RG 판매가능 재고(배수 환산) */
  actual: number;
  /** 원장 입고중 */
  inbound: number;
  /** (1-C2c) 복귀 한도 = 최근 30일 RG 판매 수량 − 최근 30일 rg_return 수량(rg-return-room.ts). 음수는 0으로 본다 */
  returnRoom: number;
  /** 직전 실행의 actual − ledger. 기록 없으면 null */
  prevDiff: number | null;
  /** 이 SKU의 rg_inbound 원장 줄(시각순) */
  inflows: Inflow[];
}

export type RgAlert =
  | { kind: 'unsent_increase'; skuId: number; qty: number }
  | { kind: 'decrease'; skuId: number; qty: number }
  | { kind: 'inbound_stale'; skuId: number; since: string; days: number }
  | { kind: 'unmapped_vid'; vid: string; qty: number }
  /** 실행기가 더한다: 비활성 SKU에 RG 재고 · 잠금 뒤 전표가 실패한 SKU */
  | { kind: 'inactive_sku'; skuId: number; qty: number }
  | { kind: 'move_failed'; skuId: number; error: string }
  /** (1-C2c) 복귀할 수량이 있으나 원장·옛 원가 어디에도 단가가 없어 기록하지 않았다 */
  | { kind: 'return_no_cost'; skuId: number; qty: number };

/**
 * 입고중에 남은 가장 오래된 발송 시각 — 역전표와 그것이 되돌린 원 줄을 짝으로 뺀 뒤, 들어온 줄을 오래된 순으로 쌓고
 * 나간 합계(+ extraOut)만큼 앞에서 지운다. 짝 없이 빼면 나중 발송을 되돌린 역전표가 앞 발송을 지운 것처럼 보인다.
 */
export function oldestWaiting(all: Inflow[], extraOut = 0): string | null {
  const reversed = new Set(all.filter((r) => r.reversesId != null).map((r) => r.reversesId as number));
  const rows = all.filter((r) => r.reversesId == null && !(r.id !== undefined && reversed.has(r.id)));
  const ins = rows.filter((r) => r.qty > 0).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  let out = rows.filter((r) => r.qty < 0).reduce((s, r) => s - r.qty, 0) + extraOut;
  for (const r of ins) {
    if (out >= r.qty) { out -= r.qty; continue; }
    return r.occurredAt;
  }
  return null;
}

export function planRgAuto(
  rows: RgAutoRow[],
  unmapped: { vid: string; qty: number }[],
  now: Date,
): { moves: { skuId: number; qty: number }[]; returns: { skuId: number; qty: number }[]; alerts: RgAlert[] } {
  const moves: { skuId: number; qty: number }[] = [];
  const returns: { skuId: number; qty: number }[] = [];
  const alerts: RgAlert[] = [];
  for (const r of [...rows].sort((a, b) => a.skuId - b.skuId)) {
    const d = r.actual - r.ledger;
    let move = 0;
    if (d > 0) {
      move = Math.min(d, Math.max(0, r.inbound));
      if (move > 0) moves.push({ skuId: r.skuId, qty: move });
      const ret = Math.min(d - move, Math.max(0, r.returnRoom));
      if (ret > 0) returns.push({ skuId: r.skuId, qty: ret });
      if (d - move - ret > 0) alerts.push({ kind: 'unsent_increase', skuId: r.skuId, qty: d - move - ret });
    } else if (d < 0 && r.prevDiff !== null && r.prevDiff < 0) {
      alerts.push({ kind: 'decrease', skuId: r.skuId, qty: -d });
    }
    if (r.inbound - move > 0) {
      const since = oldestWaiting(r.inflows, move);
      if (since) {
        const days = Math.floor((now.getTime() - Date.parse(since)) / 86_400_000);
        if (days > STALE_DAYS) alerts.push({ kind: 'inbound_stale', skuId: r.skuId, since, days });
      }
    }
  }
  for (const u of unmapped) if (u.qty > 0) alerts.push({ kind: 'unmapped_vid', vid: u.vid, qty: u.qty });
  return { moves, returns, alerts };
}

/** GET /api/erp/stock/rg-auto 응답 — 마지막 실행에서 옮김·옮길 예정·알림이 있는 줄만(route 파일은 핸들러만 내보내므로 여기 둔다) */
export interface RgAutoLast {
  runAt: string | null;
  rows: { skuId: number | null; vid: string | null; label: string; ledger: number; actual: number; inbound: number; planned: number; moved: number; plannedReturn: number; returned: number; alert: string | null }[];
}

/**
 * 텔레그램 중복 방지용 고정 키 — 문구(수량·날짜 수)가 바뀌어도 같은 사안이면 같은 키. 기록(rg_recon_snapshots.alert)에는
 * 「키|문구」로 적고(' / '로 여럿), 화면·API는 stripAlertKeys로 앞머리를 떼어 보인다. 감소는 키와 무관하게 늘 보낸다.
 */
export function alertKey(a: RgAlert): string {
  switch (a.kind) {
    case 'inbound_stale': return `inbound_stale:${a.skuId}:${a.since}`;
    case 'unmapped_vid': return `unmapped_vid:${a.vid}`;
    default: return `${a.kind}:${a.skuId}`;
  }
}

const KEY_PREFIX = /^(?:unsent_increase|decrease|inbound_stale|unmapped_vid|inactive_sku|move_failed|return_no_cost):[^|]*\|/;
export const ALERT_SEP = ' / ';

/** 기록의 「키|문구」 → 키(키가 없는 옛 문구는 null) */
export function keyOfStored(part: string): string | null {
  const m = KEY_PREFIX.exec(part);
  return m ? m[0].slice(0, -1) : null;
}

/** 기록 alert에서 「키|」 앞머리를 뗀다(여러 개면 각각) */
export function stripAlertKeys(alert: string | null): string | null {
  if (alert === null) return null;
  return alert.split(ALERT_SEP).map((x) => x.replace(KEY_PREFIX, '')).join(ALERT_SEP);
}

export function alertText(a: RgAlert, name: (skuId: number) => string): string {
  switch (a.kind) {
    case 'unsent_increase': return `${name(a.skuId)} RG가 원장보다 ${a.qty}개 많다(보낸 기록 없음)`;
    case 'decrease': return `${name(a.skuId)} RG가 원장보다 ${a.qty}개 적다(2회 연속 — 분실·파손 의심)`;
    case 'inbound_stale': return `${name(a.skuId)} 입고중 ${a.days}일째(${a.since.slice(0, 10)} 발송분)`;
    case 'unmapped_vid': return `연결 안 된 RG 번호 ${a.vid} 재고 ${a.qty}개`;
    case 'inactive_sku': return `비활성 SKU ${name(a.skuId)} RG 재고 ${a.qty}개`;
    case 'move_failed': return `${name(a.skuId)} 자동 이동 실패: ${a.error}`;
    case 'return_no_cost': return `${name(a.skuId)} RG 복귀 ${a.qty}개 보류(단가 없음)`;
  }
}
