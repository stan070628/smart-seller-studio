import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';
import { calculateProductMetrics } from '@/lib/cost-management/calculations';
import type { CostEntryRow } from '@/lib/cost-management/calculations';
import { calculateFifo, ENTRY_CHANNEL, SALE_CHANNEL } from '@/lib/cost-management/fifo';
import type { PurchaseBatch, SaleRow, FifoSummary } from '@/lib/cost-management/fifo';
import { getYearMonths } from '@/lib/cost-management/ad-spend';
import { calcBreakevenRoas, isWinner } from '@/lib/roi/calculations';

// ─────────────────────────────────────────
// GET /api/cost-management/products
// 현재 유저의 상품 목록과 FIFO 기반 수익성 지표를 반환한다.
// ─────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const channelFilter = (searchParams.get('channel') ?? 'all') as 'all' | 'rg' | 'wing' | 'naver';

    const pool = getSourcingPool();

    const { rows: products } = await pool.query(
      `SELECT id, product_name, seller_product_id, vendor_item_id, naver_channel_product_no, platform, platform_fee_rate,
              subdivision_unit, subdivision_carryover, subdivision_carryover_unit_cost, created_at
       FROM product_costs
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [user.userId],
    );

    // 입고 전체 조회 (기간 필터 없음 — 재고는 전체 입고 기준)
    const { rows: allEntries } = await pool.query(
      `SELECT id, product_cost_id, received_at, quantity, unit_cost, unit_shipping_fee, unit_rg_shipping_fee, shipping_group_id, channel
       FROM cost_entries WHERE user_id = $1`,
      [user.userId],
    );

    // 판매는 전체 조회 (재고/FIFO 계산 기준)
    const { rows: allSales } = await pool.query(
      `SELECT id, product_cost_id, sold_at, quantity, selling_price, channel FROM sale_records WHERE user_id = $1`,
      [user.userId],
    );

    // 기간 필터된 판매 ID 집합 — 실현손익/매출액 집계에만 사용
    const filteredSaleIds: Set<string> = new Set();
    if (from && to) {
      for (const s of allSales) {
        const soldAt = s.sold_at instanceof Date ? s.sold_at.toISOString().slice(0, 10) : String(s.sold_at).slice(0, 10);
        if (soldAt >= from && soldAt <= to) filteredSaleIds.add(s.id);
      }
    } else {
      for (const s of allSales) filteredSaleIds.add(s.id);
    }

    // 기간 필터된 입고 ID 집합 — 매입비 집계에 사용 (received_at 기준)
    const filteredEntryIds: Set<string> = new Set();
    if (from && to) {
      for (const e of allEntries) {
        const receivedAt = e.received_at instanceof Date ? e.received_at.toISOString().slice(0, 10) : String(e.received_at).slice(0, 10);
        if (receivedAt >= from && receivedAt <= to) filteredEntryIds.add(e.id);
      }
    } else {
      for (const e of allEntries) filteredEntryIds.add(e.id);
    }

    const entriesByProduct = new Map<string, CostEntryRow[]>();
    for (const e of allEntries) {
      const list = entriesByProduct.get(e.product_cost_id) ?? [];
      list.push({
        id: e.id,
        product_cost_id: e.product_cost_id,
        received_at: e.received_at instanceof Date ? e.received_at.toISOString().slice(0, 10) : String(e.received_at).slice(0, 10),
        quantity: Number(e.quantity),
        unit_cost: Number(e.unit_cost),
        unit_shipping_fee: Number(e.unit_shipping_fee),
        unit_rg_shipping_fee: Number(e.unit_rg_shipping_fee ?? 0),
        shipping_group_id: e.shipping_group_id,
        channel: e.channel ?? ENTRY_CHANNEL.WING,
      });
      entriesByProduct.set(e.product_cost_id, list);
    }

    const salesByProduct = new Map<string, SaleRow[]>();
    for (const s of allSales) {
      const list = salesByProduct.get(s.product_cost_id) ?? [];
      list.push({
        id: s.id,
        sold_at: s.sold_at instanceof Date ? s.sold_at.toISOString().slice(0, 10) : String(s.sold_at).slice(0, 10),
        quantity: Number(s.quantity),
        selling_price: Number(s.selling_price),
        channel: s.channel ?? SALE_CHANNEL.MANUAL,
      });
      salesByProduct.set(s.product_cost_id, list);
    }

    // product_ad_spend 테이블에서 기간 내 광고비 합산
    const yearMonths = getYearMonths(from, to);
    const adSpendByProduct = new Map<string, number>();
    if (yearMonths.length > 0) {
      const { rows: adRows } = await pool.query(
        `SELECT product_id, SUM(ad_spend)::float AS total_ad_spend
         FROM product_ad_spend
         WHERE user_id = $1 AND year_month = ANY($2::text[])
         GROUP BY product_id`,
        [user.userId, yearMonths],
      );
      for (const row of adRows) {
        adSpendByProduct.set(row.product_id, Number(row.total_ad_spend));
      }
    }

    // 채널 필터에 따라 상품 목록 필터링
    const filteredProducts = channelFilter === 'rg'
      ? products.filter((p: { vendor_item_id: string | null }) => p.vendor_item_id != null)
      : channelFilter === 'wing'
        ? products.filter((p: { seller_product_id: string | null }) => p.seller_product_id != null)
        : channelFilter === 'naver'
          ? products.filter((p: { naver_channel_product_no: string | null }) => p.naver_channel_product_no != null)
          : products;

    const data = filteredProducts.map((p) => {
      const pEntries = entriesByProduct.get(p.id) ?? [];
      const pSales = salesByProduct.get(p.id) ?? [];
      const feeRate = Number(p.platform_fee_rate);

      // 채널별 FIFO 분리: 채널 필터에 맞는 입고/판매만 사용
      const batchesToUse = channelFilter === 'rg'
        ? pEntries.filter((e) => e.channel === ENTRY_CHANNEL.RG)
        : channelFilter === 'wing'
          ? pEntries.filter((e) => e.channel === ENTRY_CHANNEL.WING)
          : pEntries;

      const salesToUse = channelFilter === 'rg'
        ? pSales.filter((s) => s.channel === SALE_CHANNEL.ROCKET_GROWTH)
        : channelFilter === 'wing'
          ? pSales.filter((s) => s.channel !== SALE_CHANNEL.ROCKET_GROWTH)
          : channelFilter === 'naver'
            ? pSales.filter((s) => s.channel === SALE_CHANNEL.NAVER)
            : pSales;

      const metrics = calculateProductMetrics(batchesToUse);

      // 채널 필터된 입고/판매로 FIFO 실행 → current_stock, stock_value 정확히 계산
      let fifoResult: FifoSummary = { current_stock: 0, stock_value: 0, total_realized_profit: 0, sale_details: [] };
      try {
        const batches: PurchaseBatch[] = batchesToUse.map((e) => ({
          id: e.id,
          received_at: e.received_at,
          quantity: e.quantity,
          unit_cost: e.unit_cost,
          unit_shipping_fee: e.unit_shipping_fee,
          unit_rg_shipping_fee: e.unit_rg_shipping_fee ?? 0,
        }));
        fifoResult = calculateFifo(batches, salesToUse, feeRate);
      } catch (e) {
        console.warn(`FIFO 계산 실패 product=${p.id}:`, e instanceof Error ? e.message : e);
      }

      // 기간 필터된 입고 매입비 집계 (received_at 기준)
      const pFilteredEntries = batchesToUse.filter((e) => filteredEntryIds.has(e.id));
      const periodPurchaseAmount = pFilteredEntries.reduce((s, e) => s + e.unit_cost * e.quantity, 0);

      // 기간 필터된 판매만 집계
      const pFilteredSales = salesToUse.filter((s) => filteredSaleIds.has(s.id));
      const periodSaleIds = new Set(pFilteredSales.map((s) => s.id));
      const pSalesById = new Map(pSales.map((s) => [s.id, s]));
      const periodRealizedProfit = fifoResult.sale_details
        .filter((d) => periodSaleIds.has(d.saleId))
        .reduce((sum, d) => sum + d.realized_profit_per_unit * (pSalesById.get(d.saleId)?.quantity ?? 0), 0);
      const periodSalesAmount = pFilteredSales.reduce((s, sale) => s + sale.selling_price * sale.quantity, 0);

      // product_ad_spend 에서 광고비 조회 및 ROAS 계산
      const adSpend = adSpendByProduct.get(p.id) ?? 0;
      const adRoas = adSpend > 0 ? (periodSalesAmount / adSpend) * 100 : 0;

      // ROI 계산
      const totalQtySold = pFilteredSales.reduce((s, x) => s + x.quantity, 0);
      const marginRate = periodSalesAmount > 0 ? periodRealizedProfit / periodSalesAmount : 0;
      const avgSellingPrice = totalQtySold > 0 ? periodSalesAmount / totalQtySold : 0;
      const avgMarginPerUnit = totalQtySold > 0 ? periodRealizedProfit / totalQtySold : 0;
      const breakevenRoas = calcBreakevenRoas(avgSellingPrice, avgMarginPerUnit);
      const winnerStatus = isWinner(0, 0, adRoas, totalQtySold);

      return {
        id: p.id,
        product_name: p.product_name,
        seller_product_id: p.seller_product_id,
        vendor_item_id: p.vendor_item_id,
        naver_channel_product_no: p.naver_channel_product_no,
        platform: p.platform,
        platform_fee_rate: feeRate,
        entry_count: pEntries.length,
        sale_count: pFilteredSales.length,
        weighted_avg_cost: metrics.weighted_avg_cost,
        weighted_avg_shipping: metrics.weighted_avg_shipping,
        weighted_avg_rg_shipping: metrics.weighted_avg_rg_shipping,
        total_purchase_amount: periodPurchaseAmount,
        current_stock: fifoResult.current_stock,
        stock_value: fifoResult.stock_value,
        total_realized_profit: periodRealizedProfit,
        total_sales_amount: periodSalesAmount,
        // ROI 필드
        ad_spend: adSpend,
        ad_roas: adRoas,
        margin_rate: marginRate,
        breakeven_roas: breakevenRoas,
        winner_status: winnerStatus,
        // 소분 판매 필드
        subdivision_unit: p.subdivision_unit ? Number(p.subdivision_unit) : null,
        subdivision_carryover: Number(p.subdivision_carryover ?? 0),
        subdivision_carryover_unit_cost: Number(p.subdivision_carryover_unit_cost ?? 0),
      };
    });

    const summary = {
      total_purchase_amount: data.reduce((s, p) => s + p.total_purchase_amount, 0),
      total_sales_amount: data.reduce((s, p) => s + p.total_sales_amount, 0),
      total_realized_profit: data.reduce((s, p) => s + p.total_realized_profit, 0),
    };

    return NextResponse.json({ success: true, data, summary });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// ─────────────────────────────────────────
// POST /api/cost-management/products
// 신규 상품을 product_costs 테이블에 등록한다.
// ─────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // JSON 파싱 실패 시 null을 반환하여 아래 검증 단계에서 처리
    const body = await request.json().catch(() => null);
    const { product_name, seller_product_id, vendor_item_id, platform_fee_rate, subdivision_unit } = body ?? {};

    // product_name 필수 검증
    if (!product_name || typeof product_name !== 'string' || product_name.trim() === '') {
      return NextResponse.json({ success: false, error: 'product_name required' }, { status: 400 });
    }

    // platform_fee_rate 유효성 검사: 0 초과 1 미만의 숫자여야 함
    if (platform_fee_rate !== undefined && platform_fee_rate !== null) {
      if (typeof platform_fee_rate !== 'number' || platform_fee_rate <= 0 || platform_fee_rate >= 1) {
        return NextResponse.json(
          { success: false, error: 'platform_fee_rate must be between 0 and 1 (exclusive)' },
          { status: 400 },
        );
      }
    }

    // seller_product_id 유효성 검사: 양의 정수여야 함
    if (seller_product_id !== undefined && seller_product_id !== null) {
      if (!Number.isInteger(seller_product_id) || seller_product_id <= 0) {
        return NextResponse.json(
          { success: false, error: 'seller_product_id must be a positive integer' },
          { status: 400 },
        );
      }
    }

    // vendor_item_id 유효성 검사: 양의 정수여야 함
    if (vendor_item_id !== undefined && vendor_item_id !== null) {
      if (!Number.isInteger(vendor_item_id) || vendor_item_id <= 0) {
        return NextResponse.json(
          { success: false, error: 'vendor_item_id must be a positive integer' },
          { status: 400 },
        );
      }
    }

    // subdivision_unit 유효성 검사: 1 이상의 정수여야 함
    if (subdivision_unit !== undefined && subdivision_unit !== null) {
      if (!Number.isInteger(subdivision_unit) || subdivision_unit < 1) {
        return NextResponse.json(
          { success: false, error: 'subdivision_unit must be a positive integer' },
          { status: 400 },
        );
      }
    }

    const pool = getSourcingPool();
    const { rows } = await pool.query(
      `INSERT INTO product_costs (user_id, product_name, seller_product_id, vendor_item_id, platform_fee_rate, subdivision_unit)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, product_name, seller_product_id, vendor_item_id, platform, platform_fee_rate,
                 subdivision_unit, subdivision_carryover, subdivision_carryover_unit_cost, current_stock, created_at`,
      [
        user.userId,
        product_name.trim(),
        seller_product_id ?? null,
        vendor_item_id ?? null,
        // platform_fee_rate 미전달 시 쿠팡 기본 수수료율 10.8% 적용
        platform_fee_rate ?? 0.108,
        subdivision_unit ?? null,
      ],
    );

    return NextResponse.json({ success: true, data: rows[0] }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
