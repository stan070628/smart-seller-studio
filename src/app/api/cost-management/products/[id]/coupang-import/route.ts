// POST /api/cost-management/products/[id]/coupang-import — 2026-09-26 ERP 1-C2a로 폐지(410).
// 판매는 주문 수집(/api/cron/orders-sync 15분 · 화면 「지금 수집」 = POST /api/erp/orders/sync)이 sale_records까지 기록한다.
// 옛 구현은 RG 청크 끝 날짜를 배타로 넘겨 하루씩 잃었고(무효 1,062건), 상품별 불러오기는 무접두 키로 판매자배송을 이중 기록했다 —
// 살려 두면 다시 쓴다. 옛 코드는 git 기록에 있다. 기초재고 이전 행 복구는 1-C2b.
import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    { success: false, code: 'gone', error: '이 불러오기는 폐지됐습니다 — 판매는 15분마다 자동 수집됩니다(재고현황·원가관리의 「지금 수집」)' },
    { status: 410 },
  );
}
