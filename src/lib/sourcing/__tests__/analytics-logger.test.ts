// @vitest-environment node
/**
 * analytics-logger.test.ts
 * 4계층 데이터 추적 시스템 — Layer 1·2 로깅 단위 테스트
 *
 * DB 연결 없이 getSourcingPool을 mock하여 순수 로직만 검증
 * node 환경 사용: 순수 서버 모듈이므로 jsdom 불필요 (jsdom은 console.error 오류 추적 방식이 달라 오탐 발생)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Pool, PoolClient, QueryResult } from 'pg';

// ─────────────────────────────────────────────────────────────────────────────
// Mock 설정 — getSourcingPool
// ─────────────────────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
const mockPool = { query: mockQuery } as unknown as Pool;

vi.mock('@/lib/sourcing/db', () => ({
  getSourcingPool: () => mockPool,
}));

// analytics-logger는 mock 이후 동적 import
import {
  logDiscoveryBatch,
  updateDiscoveryAction,
  findTodayDiscoveryLogId,
  logRegistration,
  type DiscoveryLogEntry,
  type RegistrationEntry,
} from '../analytics-logger';

// ─────────────────────────────────────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<DiscoveryLogEntry> = {}): DiscoveryLogEntry {
  return {
    channelSource:           'domeggook',
    productId:               'ITEM-001',
    productName:             '테스트 상품',
    category:                '생활용품',
    scoreTotal:              75,
    scoreBreakdown:          { legal: 12, price: 15, cs: 10, margin: 10, demand: 12, supply: 8, moq: 5 },
    grade:                   null,
    recommendedPriceNaver:   12000,
    recommendedPriceCoupang: 13000,
    maleScore:               20,
    maleTier:                'mid',
    seasonBonus:             0,
    seasonLabels:            [],
    needsReview:             false,
    blockedReason:           null,
    ...overrides,
  };
}

function makeRegistrationEntry(
  overrides: Partial<RegistrationEntry> = {},
): RegistrationEntry {
  return {
    discoveryLogId:          1,
    platform:                'naver',
    platformProductId:       null,
    productName:             '테스트 상품',
    categoryPath:            '생활용품',
    actualListedPrice:       12000,
    actualBundleStrategy:    'single',
    titleUsed:               '테스트 상품 생활용품',
    keywordsUsed:            ['생활용품', '테스트'],
    thumbnailUrl:            null,
    systemRecommendedPrice:  11900,
    wholesaleCost:           8000,
    shippingCostEstimate:    3500,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 테스트
// ─────────────────────────────────────────────────────────────────────────────

describe('logDiscoveryBatch', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    // 인메모리 캐시 초기화: 모듈 내부 _memCache를 우회하기 위해
    // 날짜를 달리한 entryId를 사용하거나, 첫 호출마다 새로운 productId 사용
  });

  it('빈 배열 → 0 반환, DB 쿼리 없음', async () => {
    const result = await logDiscoveryBatch([]);
    expect(result).toBe(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('1개 entry → INSERT 쿼리 1회 실행, 1 반환', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1, rows: [] } as unknown as QueryResult);
    const entry = makeEntry({ productId: 'NEW-ITEM-' + Date.now() }); // 고유 ID
    const result = await logDiscoveryBatch([entry]);
    expect(result).toBe(1);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('grade=null 이면 scoreTotal에서 자동 계산 (75점 → A등급)', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1, rows: [] } as unknown as QueryResult);
    const entry = makeEntry({ productId: 'GRADE-TEST-' + Date.now(), scoreTotal: 75, grade: null });
    await logDiscoveryBatch([entry]);

    const callArgs = mockQuery.mock.calls[0];
    const values = callArgs[1] as unknown[];
    // grade는 6번째 값 ($6)
    expect(values[5]).toBe('A'); // 75 → A등급 (65~79)
  });

  it('scoreTotal=85 → S등급 자동 계산', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1, rows: [] } as unknown as QueryResult);
    const entry = makeEntry({ productId: 'GRADE-S-' + Date.now(), scoreTotal: 85, grade: null });
    await logDiscoveryBatch([entry]);
    const values = mockQuery.mock.calls[0][1] as unknown[];
    expect(values[5]).toBe('S'); // 85 → S등급 (≥80)
  });

  it('pool.query 오류 시 예외 전파 없이 0 반환 (fire-and-forget)', async () => {
    mockQuery.mockImplementation(() => { throw new Error('DB connection failed'); });
    const entry = makeEntry({ productId: 'ERR-ITEM-' + Date.now() });
    await expect(logDiscoveryBatch([entry])).resolves.toBe(0);
  });

  it('101개 entries → BATCH_SIZE(100) 분할로 쿼리 2회 실행', async () => {
    mockQuery.mockResolvedValue({ rowCount: 100, rows: [] } as unknown as QueryResult);
    const entries = Array.from({ length: 101 }, (_, i) =>
      makeEntry({ productId: `BATCH-${Date.now()}-${i}` }),
    );
    await logDiscoveryBatch(entries);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('seasonLabels 배열은 그대로 전달', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1, rows: [] } as unknown as QueryResult);
    const entry = makeEntry({
      productId:    'SEASON-' + Date.now(),
      seasonLabels: ['크리스마스', '겨울캠핑'],
    });
    await logDiscoveryBatch([entry]);
    const values = mockQuery.mock.calls[0][1] as unknown[];
    // seasonLabels은 13번째 값 ($13) = offset=0에서 values[12]
    expect(values[12]).toEqual(['크리스마스', '겨울캠핑']);
  });

  it('seasonLabels=[] → null 전달', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1, rows: [] } as unknown as QueryResult);
    const entry = makeEntry({ productId: 'NO-SEASON-' + Date.now(), seasonLabels: [] });
    await logDiscoveryBatch([entry]);
    const values = mockQuery.mock.calls[0][1] as unknown[];
    expect(values[12]).toBeNull();
  });

  it('ON CONFLICT 절 포함 여부 확인', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1, rows: [] } as unknown as QueryResult);
    const entry = makeEntry({ productId: 'CONFLICT-TEST-' + Date.now() });
    await logDiscoveryBatch([entry]);
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('ON CONFLICT');
    expect(sql).toContain('DO UPDATE SET');
    // operator_action은 갱신하지 않음 — score_total 등은 포함
    expect(sql).toContain('score_total');
    expect(sql).toContain('score_breakdown');
    // DO UPDATE SET 절에 operator_action = EXCLUDED 형태가 없어야 함
    expect(sql).not.toMatch(/DO UPDATE SET[\s\S]*operator_action\s*=/);
  });
});

describe('updateDiscoveryAction', () => {
  beforeEach(() => mockQuery.mockReset());

  it('registered 액션 → UPDATE 쿼리 실행', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1, rows: [] } as unknown as QueryResult);
    await updateDiscoveryAction(42, 'registered');
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, values] = mockQuery.mock.calls[0];
    expect(sql).toContain('UPDATE');
    expect(sql).toContain('operator_action');
    expect(values[0]).toBe('registered');
    expect(values[2]).toBe(42);
  });

  it('skipped + note → note 값 전달', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1, rows: [] } as unknown as QueryResult);
    await updateDiscoveryAction(99, 'skipped', '경쟁 심화');
    const values = mockQuery.mock.calls[0][1] as unknown[];
    expect(values[0]).toBe('skipped');
    expect(values[1]).toBe('경쟁 심화');
  });

  it('note 없으면 null 전달', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1, rows: [] } as unknown as QueryResult);
    await updateDiscoveryAction(1, 'bookmarked');
    const values = mockQuery.mock.calls[0][1] as unknown[];
    expect(values[1]).toBeNull();
  });

  it('DB 오류 시 예외 전파 없이 완료', async () => {
    // vi.fn()의 동기 throw는 Vitest 4.x에서 try-catch와 무관하게 테스트 실패를 유발하므로
    // 일반 async 함수로 pool.query를 교체하여 rejected Promise를 반환
    (mockPool as unknown as { query: unknown }).query = async () => { throw new Error('timeout'); };
    await expect(updateDiscoveryAction(1, 'registered')).resolves.toBeUndefined();
    (mockPool as unknown as { query: unknown }).query = mockQuery;
  });
});

describe('findTodayDiscoveryLogId', () => {
  beforeEach(() => mockQuery.mockReset());

  it('행이 있으면 id 반환', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 123 }] } as QueryResult);
    const id = await findTodayDiscoveryLogId('domeggook', 'ITEM-001');
    expect(id).toBe(123);
  });

  it('행이 없으면 null 반환', async () => {
    mockQuery.mockResolvedValue({ rows: [] } as unknown as QueryResult);
    const id = await findTodayDiscoveryLogId('costco', 'COSTCO-001');
    expect(id).toBeNull();
  });

  it('DB 오류 시 null 반환', async () => {
    (mockPool as unknown as { query: unknown }).query = async () => { throw new Error('connection reset'); };
    const id = await findTodayDiscoveryLogId('domeggook', 'ITEM-ERR');
    expect(id).toBeNull();
    (mockPool as unknown as { query: unknown }).query = mockQuery;
  });
});

describe('logRegistration', () => {
  beforeEach(() => mockQuery.mockReset());

  it('정상 입력 → INSERT 실행 + id 반환', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 55 }] } as unknown as QueryResult);
    const id = await logRegistration(makeRegistrationEntry());
    expect(id).toBe(55);
    expect(mockQuery).toHaveBeenCalledTimes(2); // INSERT + updateDiscoveryAction
  });

  it('price_deviation 자동 계산: actual=12000, recommended=11900 → 약 +0.008', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 1 }] } as unknown as QueryResult);
    await logRegistration(makeRegistrationEntry({
      actualListedPrice:      12000,
      systemRecommendedPrice: 11900,
    }));
    const insertValues = mockQuery.mock.calls[0][1] as unknown[];
    // price_deviation = (12000 - 11900) / 11900 ≈ 0.00840
    const deviation = insertValues[11] as number;
    expect(deviation).toBeCloseTo(0.0084, 3);
  });

  it('systemRecommendedPrice=null → price_deviation=null', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 1 }] } as unknown as QueryResult);
    await logRegistration(makeRegistrationEntry({ systemRecommendedPrice: null }));
    const values = mockQuery.mock.calls[0][1] as unknown[];
    expect(values[11]).toBeNull();
  });

  it('discoveryLogId=null → updateDiscoveryAction 미호출', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 1 }] } as unknown as QueryResult);
    await logRegistration(makeRegistrationEntry({ discoveryLogId: null }));
    // INSERT만 실행, updateDiscoveryAction 없음
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('keywordsUsed=[] → null 전달', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 1 }] } as unknown as QueryResult);
    await logRegistration(makeRegistrationEntry({ keywordsUsed: [] }));
    const values = mockQuery.mock.calls[0][1] as unknown[];
    expect(values[8]).toBeNull(); // keywords_used
  });

  it('keywordsUsed 배열 있으면 그대로 전달', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 1 }] } as unknown as QueryResult);
    await logRegistration(makeRegistrationEntry({ keywordsUsed: ['캠핑', '아웃도어'] }));
    const values = mockQuery.mock.calls[0][1] as unknown[];
    expect(values[8]).toEqual(['캠핑', '아웃도어']);
  });

  it('DB 오류 시 null 반환 (예외 전파 없음)', async () => {
    (mockPool as unknown as { query: unknown }).query = async () => { throw new Error('unique violation'); };
    const id = await logRegistration(makeRegistrationEntry());
    expect(id).toBeNull();
    (mockPool as unknown as { query: unknown }).query = mockQuery;
  });
});
