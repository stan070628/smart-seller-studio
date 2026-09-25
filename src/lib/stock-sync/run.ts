/**
 * 쿠팡 → 네이버·토스 품절 동기화 1회 실행.
 * 쿠팡 조회 → 채널 옵션 단위로 묶어 판정(plan.ts) → 채널 반영 → zeroed_at 기록 → 요약 반환.
 */
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCoupangClient } from '@/lib/listing/coupang-client';
import { planLink, combineCoupang, isCoupangSellable, type CoupangState, type SyncLink, type Plan, type Channel } from './plan';
import { loadNaverProduct, saveNaverStocks, getTossToken, loadTossProduct, setTossStock } from './channels';

export interface SyncChange {
  label: string;
  channel: Channel;
  plan: Plan;
  applied: boolean;
}

export interface SyncResult {
  dryRun: boolean;
  links: number;
  changes: SyncChange[];
  errors: string[];
  /** 재고와 함께 바꾼 부수 상태 — 네이버 전시 ON/SUSPENSION 등 */
  notes: string[];
}

/** 채널 옵션 하나 = 연결 행 여러 개(쿠팡 옵션마다 한 행) */
interface Target {
  channel: Channel;
  productId: number;
  optionKey: string;
  label: string;
  rows: SyncLink[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** @param preset 연결을 DB 대신 넘긴다 — 등록 전 로컬 드라이런용. 이때는 dryRun만 허용한다 */
export async function runStockSync({ dryRun, preset }: { dryRun: boolean; preset?: SyncLink[] }): Promise<SyncResult> {
  if (preset && !dryRun) throw new Error('preset 연결은 드라이런에서만 쓸 수 있다');
  const pool = preset ? (null as never) : getSourcingPool();
  const rows = preset ? [] : (await pool.query(
    `SELECT id, coupang_vendor_item_id, channel, product_id, option_key, label, zeroed_at
       FROM stock_sync_links ORDER BY channel, product_id, option_key`,
  )).rows;
  const links: SyncLink[] = preset ?? rows.map((r: any) => ({
    id: Number(r.id), coupangVendorItemId: Number(r.coupang_vendor_item_id), channel: r.channel,
    productId: Number(r.product_id), optionKey: r.option_key, label: r.label, zeroedAt: r.zeroed_at,
  }));
  const result: SyncResult = { dryRun, links: links.length, changes: [], errors: [], notes: [] };

  // 1) 쿠팡 옵션 상태
  const cp = getCoupangClient();
  const coupang = new Map<number, CoupangState>();
  for (const vi of new Set(links.map((l) => l.coupangVendorItemId))) {
    try {
      const inv: any = await cp.getVendorItemInventory(vi);
      if (typeof inv.amountInStock !== 'number' || typeof inv.onSale !== 'boolean') throw new Error('응답에 amountInStock/onSale 없음');
      coupang.set(vi, { amountInStock: inv.amountInStock, onSale: inv.onSale });
    } catch (e: any) {
      result.errors.push(`쿠팡 조회 실패 ${vi}: ${e?.message ?? e}`);
    }
    await sleep(150);
  }

  // 2) 채널 옵션 단위로 묶는다
  const targets = new Map<string, Target>();
  for (const l of links) {
    const k = `${l.channel}:${l.productId}:${l.optionKey}`;
    const t = targets.get(k) ?? { channel: l.channel, productId: l.productId, optionKey: l.optionKey, label: l.label ?? k, rows: [] };
    t.rows.push(l);
    targets.set(k, t);
  }

  /** 판정 입력. 쿠팡 값을 하나라도 모르면 null — 조회 실패를 품절로 오판하면 멀쩡한 상품이 내려간다 */
  const inputOf = (t: Target) => {
    const states = t.rows.map((r) => coupang.get(r.coupangVendorItemId));
    if (states.some((s) => !s)) return null;
    const zeroed = t.rows.find((r) => r.zeroedAt)?.zeroedAt ?? null;
    return { state: combineCoupang(states as CoupangState[]), link: { ...t.rows[0], zeroedAt: zeroed } };
  };

  // 채널 상품을 읽어야 하는 것만: 쿠팡 판매 불가이거나 동기화가 내려둔 옵션
  const byProduct = new Map<string, Target[]>();
  for (const t of targets.values()) {
    const input = inputOf(t);
    if (!input || (isCoupangSellable(input.state) && !input.link.zeroedAt)) continue;
    const k = `${t.channel}:${t.productId}`;
    byProduct.set(k, [...(byProduct.get(k) ?? []), t]);
  }

  /** 반영 성공 직후 옵션마다 기록한다 — 중간 실패 시 이미 내린 옵션의 zeroed_at이 빠지면 영영 되살아나지 않는다 */
  const record = async (t: Target, plan: Plan) => {
    if (plan.kind === 'none') return;
    result.changes.push({ label: t.label, channel: t.channel, plan, applied: !dryRun && plan.kind !== 'missing' });
    if (dryRun) return;
    const ids = t.rows.map((r) => r.id);
    if (plan.kind === 'zero') await pool.query('UPDATE stock_sync_links SET zeroed_at = now(), last_error = NULL WHERE id = ANY($1)', [ids]);
    if (plan.kind === 'restore' || plan.kind === 'clear') await pool.query('UPDATE stock_sync_links SET zeroed_at = NULL, last_error = NULL WHERE id = ANY($1)', [ids]);
    if (plan.kind === 'missing') await pool.query('UPDATE stock_sync_links SET last_error = $2 WHERE id = ANY($1)', [ids, '채널에서 옵션을 찾지 못함']);
  };

  let tossToken: string | null = null;

  for (const group of byProduct.values()) {
    const { channel, productId } = group[0];
    try {
      if (channel === 'naver') {
        await sleep(700); // 건너뛰기·오류 경로에서도 간격을 지키도록 요청 앞에 둔다
        const p = await loadNaverProduct(productId);
        // 이미 판매중지된 상품은 팔릴 위험이 없다 — 옵션 전부 품절 시 네이버 제약에 걸려 3시간마다 오류만 쌓인다
        if (!p.onSale) continue;
        const planned = group.map((t) => {
          const { state, link } = inputOf(t)!;
          return { t, plan: planLink(link, state, p.stocks.get(t.optionKey) ?? null) };
        });
        const updates = new Map<string, number>();
        for (const { t, plan } of planned) {
          if (plan.kind === 'zero') updates.set(t.optionKey, 0);
          if (plan.kind === 'restore') updates.set(t.optionKey, plan.to);
        }
        // 네이버는 상품 전체 PUT 한 번이라 성공하면 전 옵션이 함께 반영된다
        if (updates.size && !dryRun) {
          const display = await saveNaverStocks(p, updates);
          if (display) result.notes.push(`[네이버] ${group[0].label.split(' · ')[0]}: 전시 ${display === 'SUSPENSION' ? '끔 (재고 0)' : '켬 (재고 복구)'}`);
        }
        for (const x of planned) await record(x.t, x.plan);
      } else {
        tossToken ??= await getTossToken();
        const p = await loadTossProduct(tossToken, productId);
        if (!p.onSale) continue;
        for (const t of group) {
          const { state, link } = inputOf(t)!;
          const cur = p.stocks.get(t.optionKey);
          const plan = planLink(link, state, cur?.stock ?? null);
          if (!dryRun && plan.kind === 'zero') await setTossStock(tossToken, productId, cur!.itemId, 0);
          if (!dryRun && plan.kind === 'restore') await setTossStock(tossToken, productId, cur!.itemId, plan.to);
          await record(t, plan);
        }
      }
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      result.errors.push(`${channel === 'naver' ? '네이버' : '토스'} ${productId} (${group[0].label}): ${msg}`);
      if (!dryRun) {
        await pool.query('UPDATE stock_sync_links SET last_error = $2 WHERE id = ANY($1)', [group.flatMap((t) => t.rows.map((r) => r.id)), msg.slice(0, 500)]);
      }
    }
  }

  return result;
}

export function formatSyncReport(r: SyncResult): string {
  const ch = (c: Channel) => (c === 'naver' ? '네이버' : '토스');
  const lines = [`📦 재고 동기화${r.dryRun ? ' (드라이런)' : ''} — 연결 ${r.links}건`];
  for (const c of r.changes) {
    const what =
      c.plan.kind === 'zero' ? `품절 처리 (${c.plan.from} → 0)` :
      c.plan.kind === 'restore' ? `되살림 (0 → ${c.plan.to})` :
      c.plan.kind === 'clear' ? '이미 되살려져 표시만 해제' :
      c.plan.kind === 'missing' ? '⚠️ 채널에서 옵션을 찾지 못함 — 연결 확인 필요' : '';
    lines.push(`• [${ch(c.channel)}] ${c.label}: ${what}`);
  }
  for (const n of r.notes ?? []) lines.push(`• ${n}`);
  for (const e of r.errors) lines.push(`🔴 ${e}`);
  return lines.join('\n');
}
