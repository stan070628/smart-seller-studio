// src/lib/erp/sku/sync-app.ts
// 앱(API 라우트)에서 SKU 자동 추가를 부르는 곳 — 풀·트랜잭션·쿠팡 클라이언트를 붙인다. syncForApp은 던지지 않는다.
import { getSourcingPool } from '@/lib/sourcing/db';
import { withTx } from '@/lib/erp/stock/http';
import { getCoupangClient } from '@/lib/listing/coupang-client';
import { syncMissing, syncSellerProduct, type SkuSync, type SyncDeps, type SyncMissingResult } from './sync-product';

const appDeps = (): SyncDeps => ({ db: getSourcingPool(), tx: withTx, coupang: getCoupangClient() });

export async function syncForApp(sellerProductId: number): Promise<SkuSync> {
  if (!Number.isInteger(sellerProductId) || sellerProductId <= 0) return { status: 'skipped', skus: 0 };
  try {
    return await syncSellerProduct(appDeps(), sellerProductId);
  } catch (e) {
    // 쿠팡 키가 없으면 getCoupangClient가 던진다 — 원가관리 저장은 이미 끝났으므로 실패로만 알린다
    return { status: 'failed', skus: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

export const syncMissingForApp = (): Promise<SyncMissingResult> => syncMissing(appDeps());
