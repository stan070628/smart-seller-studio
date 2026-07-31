/**
 * 코스트코 매입가 감시 — 임계가 이하로 내려가면 텔레그램으로 알린다.
 *
 * 코스트코 정품 리셀링은 쿠팡에 시장가가 형성되어 있어 판매가를 올릴 수 없다.
 * 마진을 개선할 수 있는 변수는 매입가 하나뿐인데, 세일은 예고 없이 시작하고
 * 끝난다. 발견이 하루 늦으면 그만큼 비싸게 사입하게 된다.
 */

import type { Pool } from 'pg';
import { sendTelegramMessage } from '@/lib/telegram/client';

export interface PriceWatchRow {
  id: string;
  product_code: string;
  label: string;
  threshold_price: number;
  chat_id: string;
  last_notified_price: number | null;
  current_price: number | null;
  lowest_price: number | null;
  prev_price: number | null;
}

/** 판정 결과. reset은 세일 종료로 재알림 상태를 초기화하는 경우다. */
export type WatchDecision = 'notify' | 'reset' | 'silent';

/**
 * 알림 여부를 판정한다.
 *
 * 같은 세일이 며칠 이어질 때 매일 알리면 알림 자체를 무시하게 되므로,
 * **처음 임계가를 밑돌 때와 그보다 더 싸질 때만** 알린다.
 * 가격이 임계가 위로 올라가면 세일이 끝난 것으로 보고 상태를 리셋해,
 * 다음 세일 때 다시 알림이 가도록 한다.
 */
export function decideNotification(
  currentPrice: number | null,
  thresholdPrice: number,
  lastNotifiedPrice: number | null,
): WatchDecision {
  if (currentPrice === null || currentPrice <= 0) return 'silent';

  // 임계가 초과 — 세일이 아니다. 알린 적이 있으면 리셋한다.
  if (currentPrice > thresholdPrice) {
    return lastNotifiedPrice === null ? 'silent' : 'reset';
  }

  // 임계가 이하 — 처음이거나 더 싸졌을 때만 알린다.
  if (lastNotifiedPrice === null) return 'notify';
  return currentPrice < lastNotifiedPrice ? 'notify' : 'silent';
}

/** 텔레그램 메시지 본문을 만든다. */
export function buildWatchMessage(row: PriceWatchRow): string {
  const current = row.current_price ?? 0;
  const lines = [`💰 코스트코 세일 감지`, ``, row.label, ``];

  // 직전 가격이 있으면 낙폭을 보여준다. 없으면 현재가만.
  if (row.prev_price !== null && row.prev_price > current) {
    const diff = row.prev_price - current;
    const pct = ((diff / row.prev_price) * 100).toFixed(1);
    lines.push(
      `${row.prev_price.toLocaleString()}원 → ${current.toLocaleString()}원`,
      `(-${diff.toLocaleString()}원, -${pct}%)`,
    );
  } else {
    lines.push(`현재가 ${current.toLocaleString()}원`);
  }

  lines.push(``, `임계가 ${row.threshold_price.toLocaleString()}원 이하`);

  if (row.lowest_price !== null) {
    const isRecordLow = current <= row.lowest_price;
    lines.push(
      isRecordLow
        ? `🔥 역대 최저가`
        : `역대 최저 ${row.lowest_price.toLocaleString()}원`,
    );
  }

  return lines.join('\n');
}

/**
 * 감시 대상을 점검하고 알림을 보낸다.
 *
 * 크론에서 가격 수집·기록이 끝난 뒤 호출한다. `prev_price`는
 * `costco_price_logs`의 직전 기록에서 가져오므로, 반드시 오늘 로그를
 * 기록한 다음에 실행해야 낙폭이 계산된다.
 *
 * @returns 실제로 알림을 보낸 건수
 */
export async function checkPriceWatches(pool: Pool): Promise<number> {
  const res = await pool.query<PriceWatchRow>(
    `SELECT w.id, w.product_code, w.label, w.threshold_price, w.chat_id,
            w.last_notified_price,
            p.price        AS current_price,
            p.lowest_price AS lowest_price,
            (SELECT l.price FROM public.costco_price_logs l
              WHERE l.product_code = w.product_code
                AND l.logged_at < CURRENT_DATE
              ORDER BY l.logged_at DESC LIMIT 1) AS prev_price
       FROM public.costco_price_watches w
       LEFT JOIN public.costco_products p ON p.product_code = w.product_code
      WHERE w.is_active = true`,
  );

  let notified = 0;

  for (const row of res.rows) {
    const decision = decideNotification(
      row.current_price,
      row.threshold_price,
      row.last_notified_price,
    );

    if (decision === 'silent') continue;

    if (decision === 'reset') {
      await pool.query(
        `UPDATE public.costco_price_watches
            SET last_notified_price = NULL, last_notified_at = NULL
          WHERE id = $1`,
        [row.id],
      );
      continue;
    }

    // 전송 실패가 나머지 감시 대상 처리를 막지 않도록 개별 격리한다.
    try {
      await sendTelegramMessage(row.chat_id, buildWatchMessage(row));
      await pool.query(
        `UPDATE public.costco_price_watches
            SET last_notified_price = $1, last_notified_at = now()
          WHERE id = $2`,
        [row.current_price, row.id],
      );
      notified += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[costco/price-watch] ${row.product_code} 알림 실패: ${msg}`);
    }
  }

  return notified;
}
