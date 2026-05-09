import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';
import { calculateProductMetrics } from '@/lib/cost-management/calculations';
import type { CostEntryRow } from '@/lib/cost-management/calculations';
import { calculateFifo } from '@/lib/cost-management/fifo';
import type { PurchaseBatch, SaleRow, FifoSummary } from '@/lib/cost-management/fifo';

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

    const pool = getSourcingPool();

    const { rows: products } = await pool.query(
      `SELECT id, product_name, seller_product_id, platform, platform_fee_rate, created_at
       FROM product_costs
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [user.userId],
    );

    // 입고 전체 조회 (기간 필터 없음 — 재고는 전체 입고 기준)
    const { rows: allEntries } = await pool.query(
      `SELECT id, product_cost_id, received_at, quantity, unit_cost, unit_shipping_fee, unit_rg_shipping_fee, shipping_group_id
       FROM cost_entries WHERE user_id = $1`,
      [user.userId],
    );

    // 판매는 전체 조회 (재고/FIFO 계산 기준)
    const { rows: allSales } = await pool.query(
      `SELECT id, product_cost_id, sold_at, quantity, selling_price FROM sale_records WHERE user_id = $1`,
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
        shipping_group_id: e.shipping_group_id,
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
      });
      salesByProduct.set(s.product_cost_id, list);
    }

    const data = products.map((p) => {
      const pEntries = entriesByProduct.get(p.id) ?? [];
      const pSales = salesByProduct.get(p.id) ?? [];
      const feeRate = Number(p.platform_fee_rate);

      const metrics = calculateProductMetrics(pEntries);

      // 전체 판매로 FIFO 실행 → current_stock, stock_value 정확히 계산
      let fifoResult: FifoSummary = { current_stock: 0, stock_value: 0, total_realized_profit: 0, sale_details: [] };
      try {
        const batches: PurchaseBatch[] = pEntries.map((e) => ({
          id: e.id,
          received_at: e.received_at,
          quantity: e.quantity,
          unit_cost: e.unit_cost,
          unit_shipping_fee: e.unit_shipping_fee,
          unit_rg_shipping_fee: e.unit_rg_shipping_fee ?? 0,
        }));
        fifoResult = calculateFifo(batches, pSales, feeRate);
      } catch (e) {
        console.warn(`FIFO 계산 실패 product=${p.id}:`, e instanceof Error ? e.message : e);
      }

      // 기간 필터된 판매만 집계
      const pFilteredSales = pSales.filter((s) => filteredSaleIds.has(s.id));
      const periodSaleIds = new Set(pFilteredSales.map((s) => s.id));
      const periodRealizedProfit = fifoResult.sale_details
        .filter((d) => periodSaleIds.has(d.saleId))
        .reduce((sum, d) => sum + d.realized_profit_per_unit * (pSales.find((s) => s.id === d.saleId)?.quantity ?? 0), 0);
      const periodSalesAmount = pFilteredSales.reduce((s, sale) => s + sale.selling_price * sale.quantity, 0);

      return {
        id: p.id,
        product_name: p.product_name,
        seller_product_id: p.seller_product_id,
        platform: p.platform,
        platform_fee_rate: feeRate,
        entry_count: pEntries.length,
        sale_count: pFilteredSales.length,
        weighted_avg_cost: metrics.weighted_avg_cost,
        weighted_avg_shipping: metrics.weighted_avg_shipping,
        total_purchase_amount: metrics.total_purchase_amount,
        current_stock: fifoResult.current_stock,
        stock_value: fifoResult.stock_value,
        total_realized_profit: periodRealizedProfit,
        total_sales_amount: periodSalesAmount,
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
    const { product_name, seller_product_id, platform_fee_rate } = body ?? {};

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

    const pool = getSourcingPool();
    const { rows } = await pool.query(
      `INSERT INTO product_costs (user_id, product_name, seller_product_id, platform_fee_rate)
       VALUES ($1, $2, $3, $4)
       RETURNING id, product_name, seller_product_id, platform, platform_fee_rate, current_stock, created_at`,
      [
        user.userId,
        product_name.trim(),
        seller_product_id ?? null,
        // platform_fee_rate 미전달 시 쿠팡 기본 수수료율 10.8% 적용
        platform_fee_rate ?? 0.108,
      ],
    );

    return NextResponse.json({ success: true, data: rows[0] }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
