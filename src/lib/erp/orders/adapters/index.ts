// src/lib/erp/orders/adapters/index.ts
// 채널 → 실제 클라이언트로 만든 어댑터. 클라이언트 생성자는 환경변수가 없으면 던진다 — 수집기가 채널마다 따로 잡도록 지연 생성한다.
import { getCoupangClient } from '@/lib/listing/coupang-client';
import { getNaverCommerceClient } from '@/lib/listing/naver-commerce-client';
import { getTossShoppingClient } from '@/lib/listing/toss-shopping-client';
import type { OrderAdapter, OrderChannel } from '../types';
import { createWingAdapter } from './coupang-wing';
import { createRgAdapter } from './coupang-rg';
import { createNaverAdapter } from './naver';
import { createTossAdapter } from './toss';

export const ADAPTER_FACTORIES: Record<OrderChannel, () => OrderAdapter> = {
  coupang_wing: () => createWingAdapter(getCoupangClient()),
  coupang_rg: () => createRgAdapter(getCoupangClient()),
  naver: () => createNaverAdapter(getNaverCommerceClient()),
  toss: () => createTossAdapter(getTossShoppingClient()),
};
