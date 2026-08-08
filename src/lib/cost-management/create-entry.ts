import type { PoolClient } from 'pg';
import { ENTRY_CHANNEL } from '@/lib/cost-management/fifo';
import { calculateSubdivision } from '@/lib/cost-management/subdivision';

/**
 * 입고 1건 생성.
 *
 * POST /api/cost-management/products/[id]/entries에서 추출했다.
 * 영수증 확정 경로도 같은 함수를 쓴다 — 소분 이월 계산이 두 곳에 있으면
 * 어느 경로로 들어왔는지에 따라 같은 상품의 원가가 달라진다.
 *
 * 트랜잭션은 호출자가 연다. 이 함수는 주어진 client로만 쿼리한다.
 * 상품 조회가 트랜잭션 안에 들어오므로, 같은 상품에 동시 입고가 들어올 때
 * 이월을 덮어쓰는 창이 추출 전보다 좁다.
 */
export interface CreateEntryInput {
  client: PoolClient;
  userId: string;
  productCostId: string;
  receivedAt: string;
  /** 일반 모드: 개당 단가 / 소분 모드: 총 구매가 */
  unitCost: number;
  /** 일반 모드에서만 쓴다 */
  quantity?: number;
  /** 양수면 소분 모드로 판정한다 */
  purchaseQuantity?: number | null;
  /** 생략하면 상품에 설정된 기본값을 쓴다 */
  subdivisionUnit?: number | null;
  unitShippingFee?: number;
  unitRgShippingFee?: number;
  channel?: string;
  variantName?: string | null;
  /** 영수증 확정 경로에서만 채운다 */
  sourceReceiptLineId?: string | null;
}

export interface CreateEntryResult {
  entry: Record<string, unknown>;
  /** 소분 모드에서만 값이 있다 */
  carryoverOut: number | null;
  isSubdivisionMode: boolean;
}

/**
 * 호출자가 HTTP 상태로 옮길 수 있도록 상태를 실어 던진다.
 * 라우트가 추출 전과 같은 400/404를 내게 하는 장치다.
 */
export class CostEntryError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'CostEntryError';
  }
}

export async function createCostEntry(input: CreateEntryInput): Promise<CreateEntryResult> {
  const {
    client, userId, productCostId, receivedAt, unitCost,
    quantity, purchaseQuantity, subdivisionUnit: inputSubdivisionUnit,
    unitShippingFee, unitRgShippingFee, channel, variantName, sourceReceiptLineId,
  } = input;

  // 소분 모드 여부 판별: purchase_quantity가 양수로 전달된 경우
  const isSubdivisionMode =
    purchaseQuantity != null && typeof purchaseQuantity === 'number' && purchaseQuantity > 0;

  // subdivision 필드를 포함하여 product 조회
  const { rows: check } = await client.query(
    `SELECT id, subdivision_unit, subdivision_carryover, subdivision_carryover_unit_cost
     FROM product_costs WHERE id = $1 AND user_id = $2`,
    [productCostId, userId],
  );
  if (check.length === 0) throw new CostEntryError('Not found', 404);

  const product = check[0];

  // 소분/일반 분기 처리
  let finalQuantity: number;
  let finalUnitCost: number;
  let finalPurchaseQuantity: number | null = null;
  let finalSubdivisionUnit: number | null = null;
  let carryoverOut: number | null = null;
  let newCarryoverUnitCost: number | null = null;

  if (isSubdivisionMode) {
    const subdivisionUnit =
      inputSubdivisionUnit ??
      (product.subdivision_unit ? Number(product.subdivision_unit) : null);

    if (!subdivisionUnit || subdivisionUnit < 1) {
      throw new CostEntryError('subdivision_unit required (product default or body)', 400);
    }

    const calc = calculateSubdivision({
      purchaseQuantity,
      totalPurchaseCost: unitCost,
      subdivisionUnit,
      carryoverQuantity: Number(product.subdivision_carryover ?? 0),
      carryoverUnitCost: Number(product.subdivision_carryover_unit_cost ?? 0),
    });

    if (calc.sellablePacks === 0) {
      throw new CostEntryError(
        `팩을 완성하기에 수량이 부족합니다. 현재 이월 포함 총 ${calc.totalAvailable}개, 소분 단위 ${subdivisionUnit}개`,
        400,
      );
    }

    finalQuantity = calc.sellablePacks;
    finalUnitCost = calc.packUnitCost;
    finalPurchaseQuantity = purchaseQuantity;
    finalSubdivisionUnit = subdivisionUnit;
    carryoverOut = calc.newCarryoverQuantity;
    newCarryoverUnitCost = calc.newCarryoverUnitCost;
  } else {
    if (quantity == null) throw new CostEntryError('quantity required', 400);
    finalQuantity = quantity;
    finalUnitCost = unitCost;
  }

  const { rows } = await client.query(
    `INSERT INTO cost_entries
       (user_id, product_cost_id, received_at, quantity, unit_cost, unit_shipping_fee,
        unit_rg_shipping_fee, channel, purchase_quantity, subdivision_unit, variant_name,
        source_receipt_line_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      userId,
      productCostId,
      receivedAt,
      finalQuantity,
      finalUnitCost,
      unitShippingFee ?? 0,
      unitRgShippingFee ?? 0,
      (channel === ENTRY_CHANNEL.RG || channel === ENTRY_CHANNEL.WING) ? channel : ENTRY_CHANNEL.WING,
      finalPurchaseQuantity,
      finalSubdivisionUnit,
      variantName ?? null,
      sourceReceiptLineId ?? null,
    ],
  );

  // 소분 모드인 경우 product_costs의 이월 수량/단가 갱신 (같은 트랜잭션)
  if (isSubdivisionMode && carryoverOut !== null) {
    await client.query(
      `UPDATE product_costs SET subdivision_carryover = $1, subdivision_carryover_unit_cost = $2 WHERE id = $3`,
      [carryoverOut, newCarryoverUnitCost, productCostId],
    );
  }

  return { entry: rows[0], carryoverOut, isSubdivisionMode };
}
