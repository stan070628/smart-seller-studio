import { describe, it, expect, vi, beforeEach } from 'vitest';

// listForVerify는 getSourcingPool()을 내부에서 부르므로 db 모듈을 모킹해야 한다.
// mockQuery를 vi.hoisted로 감싸는 이유: vi.mock 팩토리는 파일 최상단으로
// 호이스팅되므로, 평범한 `const mockQuery = vi.fn()`을 아래에 두면 팩토리가
// 초기화 전의 변수를 참조해 `ReferenceError: Cannot access 'mockQuery' before
// initialization`이 난다.
const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock('@/lib/sourcing/db', () => ({
  getSourcingPool: () => ({ query: mockQuery }),
}));

import {
  upsertShortlistCandidate,
  listForVerify,
  listShortlist,
  patchShortlist,
} from '@/lib/sourcing/shortlist-db';

const pool = { query: mockQuery } as never;

describe('upsertShortlistCandidate', () => {
  beforeEach(() => mockQuery.mockReset());

  it('신규 후보를 삽입한다', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    await upsertShortlistCandidate(pool, {
      itemNo: 55788793,
      title: '메쉬 반장갑',
      domePrice: 3300,
      unitDeliFee: 300,
      coupangP25: 9900,
      coupangSampleN: 91,
      effectiveCost: 3600,
      breakEvenPrice: 9471,
      margin: 3226,
      marginRate: 32.6,   // 백분율 1자리 — DB가 numeric(5,1)이다
      verdict: 'pass',
    });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('ON CONFLICT');
    expect(params[0]).toBe(55788793);
  });

  it('같은 item_no를 다시 넣어도 실패하지 않는다 (재검증만 갱신)', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    await upsertShortlistCandidate(pool, {
      itemNo: 55788793,
      title: '메쉬 반장갑',
      domePrice: 3300,
      unitDeliFee: 300,
      coupangP25: 9900,
      coupangSampleN: 91,
      effectiveCost: 3600,
      breakEvenPrice: 9471,
      margin: 3226,
      marginRate: 32.6,   // 백분율 1자리 — DB가 numeric(5,1)이다
      verdict: 'pass',
    });
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('DO UPDATE');
    expect(sql).not.toContain('memo = EXCLUDED.memo'); // 사용자 메모를 덮지 않는다
  });

  // 아래 두 건은 mock으로 확인할 수 있는 최소한의 스키마 방어선이다.
  // 실제 컬럼 존재 여부는 여전히 검증하지 못하므로
  // supabase/migrations/094_sourcing_shortlist.sql을 직접 대조해야 한다.
  it('테이블명은 sourcing_shortlist다 (shortlist가 아니다)', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    await upsertShortlistCandidate(pool, {
      itemNo: 1, title: 't', domePrice: 1000, unitDeliFee: 0,
      coupangP25: 20000, coupangSampleN: 10,
      effectiveCost: 1000, breakEvenPrice: 5000, margin: 1000,
      marginRate: 5, verdict: 'pass',
    });
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('INSERT INTO sourcing_shortlist');
  });

  it('사용자 소유 컬럼(memo·is_archived·order_qty·logistics_size)은 갱신하지 않는다', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    await upsertShortlistCandidate(pool, {
      itemNo: 1, title: 't', domePrice: 1000, unitDeliFee: 0,
      coupangP25: 20000, coupangSampleN: 10,
      effectiveCost: 1000, breakEvenPrice: 5000, margin: 1000,
      marginRate: 5, verdict: 'pass',
    });
    const [sql] = mockQuery.mock.calls[0];
    for (const col of ['memo', 'is_archived', 'order_qty', 'logistics_size']) {
      expect(sql).not.toContain(`${col} = EXCLUDED.${col}`);
    }
  });

  it('verified_at을 NULL로 남겨 검증 큐 맨 앞에 세운다', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    await upsertShortlistCandidate(pool, {
      itemNo: 1, title: 't', domePrice: 1000, unitDeliFee: 0,
      coupangP25: 20000, coupangSampleN: 10,
      effectiveCost: 1000, breakEvenPrice: 5000, margin: 1000,
      marginRate: 5, verdict: 'pass',
    });
    const [sql] = mockQuery.mock.calls[0];

    // 파이프라인은 사입 10개·극소형을 가정하고 계산하지만 검증 크론은 행의 실제
    // order_qty·logistics_size로 계산한다. NOW()로 찍으면 가정값이 검증필로 위장되고
    // listForVerify(verified_at ASC NULLS FIRST)에서 큐 맨 뒤로 밀린다.
    expect(sql).toContain('verified_at       = NULL');
    expect(sql).not.toContain('verified_at       = NOW()');
  });
});

describe('listForVerify — 저장된 쿠팡가 동반 조회', () => {
  beforeEach(() => mockQuery.mockReset());

  it('SELECT에 coupang_p25가 포함된다', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await listForVerify(5);
    const [sql] = mockQuery.mock.calls[0];
    // 재검증이 수동 입력값을 인자로 받아야 하므로 큐 조회가 함께 가져와야 한다
    expect(sql).toContain('coupang_p25');
  });
});

describe('1688 저장', () => {
  // mockQuery는 파일 전체가 공유하므로 리셋하지 않으면 앞 describe의 호출이
  // mock.calls[0]에 남아 엉뚱한 SQL을 검사하게 된다.
  beforeEach(() => mockQuery.mockReset());

  it('patchShortlist가 1688 입력값을 저장한다', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    await patchShortlist(55788793, {
      buyKrwTotal: 3867,
      buyCnyTotal: 17.5,
      orderQty1688: 2,
      exchangeRate1688: 220.97,
      intlShipPerUnit: 322,
    });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('buy_krw_total');
    expect(sql).toContain('pasted_at_1688 = now()');  // 붙여넣은 시각을 함께 찍는다
    expect(params).toContain(3867);
  });

  it('SELECT_COLS에 1688 컬럼이 포함된다', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await listShortlist();
    const [sql] = mockQuery.mock.calls[0];
    for (const c of ['buy_krw_total', 'order_qty_1688', 'intl_ship_per_unit']) {
      expect(sql).toContain(c);
    }
  });
});
