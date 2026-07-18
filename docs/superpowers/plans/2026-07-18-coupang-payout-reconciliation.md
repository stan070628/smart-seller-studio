# 쿠팡 지급 확정 대조 배너 (B1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 정산 탭에 쿠팡 실제 지급 확정액(`settlement-histories`)을 내 장부 정산예상과 월 단위로 대조하는 배너를 추가한다.

**Architecture:** `coupang-client.ts`에 `getSettlementHistories(month)` 메서드 추가(기존 HMAC `request()` 재사용). 신규 `GET /api/settlement/payout?month=` 라우트가 이를 호출해 지급 확정 정보를 반환. `SettlementTab`이 선택된 월로 조회해 배너 표시(내 장부 정산예상 = monthTotal.revenue − couponDiscount − platformFee). 매출 소스·일별 계산은 변경 없음.

**Tech Stack:** Next.js App Router, Coupang Open API (HMAC), Vitest.

**참조 스펙:** `docs/superpowers/specs/2026-07-18-coupang-payout-reconciliation-design.md`

---

## 배경 요약 (작업자용)

- 정산 탭 매출은 우리 임포트 기반이라 쿠팡 Wing 화면과 완전 일치 불가(전용 API 없음, revenue-history는 순환). **유일하게 독립적인 쿠팡 숫자 = `settlement-histories`(월 지급 확정액)**. 이걸 월 단위로 대조한다.
- `settlement-histories`는 `marketplace_openapi` provider. HMAC 서명은 경로 기반이라 기존 `request()`로 호출된다.
- **월 단위 정보용 배너만** 추가. 일별 표·순이익 계산·매출 소스는 그대로.

## 파일 구조

- 수정: `src/lib/listing/coupang-client.ts` — `getSettlementHistories` 메서드
- 신규: `src/app/api/settlement/payout/route.ts` — 지급 확정 조회
- 신규: `src/__tests__/api/settlement-payout.test.ts` — 라우트 테스트
- 수정: `src/components/orders/SettlementTab.tsx` — 배너 + payout fetch

## 미검증 가정 (작업자 주의)

`settlement-histories`의 **원본 응답 필드명**은 2026-05-21 스펙에서 학습한 것(`finalAmount`, `settlementDate`, `status`, `settlementTargetAmount`, `serviceFee`)을 기준으로 매핑한다. 실제 응답 필드명이 다를 수 있으므로, Task 4 수동 검증에서 실응답을 로그로 확인하고 다르면 매핑을 조정한다. `vendorId` 쿼리 필요 여부도 불명 — 우선 `revenue-history`처럼 포함하고, API가 거부하면 제거한다.

---

### Task 1: coupang-client — getSettlementHistories

**Files:**
- Modify: `src/lib/listing/coupang-client.ts` (getRevenueHistory 메서드 뒤에 추가)

- [ ] **Step 1: 메서드 추가**

`getRevenueHistory` 메서드가 끝나는 `}` 바로 다음에 아래를 추가한다. `request`/`sleep`/`API_DELAY`/`this.vendorId`는 같은 클래스에 이미 존재한다.

```typescript
  // ─── 지급 내역 (정산) 조회 ─────────────────────────────
  /**
   * settlement-histories — 월별 지급 확정 내역.
   * provider가 marketplace_openapi로 revenue-history(openapi)와 다르나 HMAC 서명은 경로 기반이라 동일 request() 사용.
   * 응답이 지급 주기별 배열이면 finalAmount 합산, 최근 settlementDate를 대표로 반환. 데이터 없으면 null.
   * 주의: 원본 필드명은 2026-05-21 스펙 학습분 기준 — 실응답과 다르면 매핑 조정.
   */
  async getSettlementHistories(yearMonth: string): Promise<{
    finalAmount: number;
    settlementTargetAmount: number;
    serviceFee: number;
    settlementDate: string;
    status: string;
  } | null> {
    const url = `/v2/providers/marketplace_openapi/apis/api/v1/settlement-histories?vendorId=${this.vendorId}&revenueRecognitionYearMonth=${yearMonth}`;
    await sleep(API_DELAY);
    const res = await this.request<Array<Record<string, unknown>>>('GET', url);
    const rows = Array.isArray(res.data) ? res.data : [];
    if (rows.length === 0) return null;
    let finalAmount = 0;
    let settlementTargetAmount = 0;
    let serviceFee = 0;
    let settlementDate = '';
    let status = '';
    for (const r of rows) {
      finalAmount += Number(r.finalAmount ?? 0);
      settlementTargetAmount += Number(r.settlementTargetAmount ?? 0);
      serviceFee += Number(r.serviceFee ?? 0);
      const d = String(r.settlementDate ?? '');
      if (d > settlementDate) settlementDate = d;   // 최근 지급일
      status = String(r.status ?? status);
    }
    return { finalAmount, settlementTargetAmount, serviceFee, settlementDate, status };
  }
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음. (`request`/`sleep`/`API_DELAY`/`this.vendorId`가 클래스에 존재. 없다고 나오면 `getRevenueHistory` 근처 심볼명을 확인해 맞춘다.)

- [ ] **Step 3: 커밋**

```bash
git add src/lib/listing/coupang-client.ts
git commit -m "feat(coupang): getSettlementHistories — 월 지급 확정 조회"
```

---

### Task 2: GET /api/settlement/payout 라우트 + 테스트 (TDD)

**Files:**
- Create: `src/app/api/settlement/payout/route.ts`
- Test: `src/__tests__/api/settlement-payout.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `src/__tests__/api/settlement-payout.test.ts`:

```typescript
/**
 * GET /api/settlement/payout?month= — 쿠팡 지급 확정 조회
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@/lib/listing/coupang-client', () => ({ getCoupangClient: vi.fn() }));

import { getCurrentUser } from '@/lib/auth';
import { getCoupangClient } from '@/lib/listing/coupang-client';

const mockUser = getCurrentUser as ReturnType<typeof vi.fn>;
const mockClient = getCoupangClient as ReturnType<typeof vi.fn>;

function req(qs: string): NextRequest {
  return new NextRequest(`http://localhost/api/settlement/payout?${qs}`);
}

describe('GET settlement/payout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.mockResolvedValue({ userId: 'u1', email: 't@e.com' });
  });

  it('month 형식 틀리면 400', async () => {
    const { GET } = await import('@/app/api/settlement/payout/route');
    const res = await GET(req('month=2026-7'));
    expect(res.status).toBe(400);
  });

  it('지급 데이터 있으면 payout 반환', async () => {
    mockClient.mockReturnValue({
      getSettlementHistories: vi.fn().mockResolvedValue({
        finalAmount: 12450000, settlementTargetAmount: 13500000, serviceFee: 1500000,
        settlementDate: '2026-08-03', status: 'SUBJECT',
      }),
    });
    const { GET } = await import('@/app/api/settlement/payout/route');
    const res = await GET(req('month=2026-07'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.payout.finalAmount).toBe(12450000);
    expect(json.payout.settlementDate).toBe('2026-08-03');
  });

  it('데이터 없으면 payout null', async () => {
    mockClient.mockReturnValue({ getSettlementHistories: vi.fn().mockResolvedValue(null) });
    const { GET } = await import('@/app/api/settlement/payout/route');
    const res = await GET(req('month=2026-07'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.payout).toBeNull();
  });

  it('API 실패해도 500 대신 payout null', async () => {
    mockClient.mockReturnValue({ getSettlementHistories: vi.fn().mockRejectedValue(new Error('coupang down')) });
    const { GET } = await import('@/app/api/settlement/payout/route');
    const res = await GET(req('month=2026-07'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.payout).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run (vitest SLOW here — timeout 300000ms): `npx vitest run src/__tests__/api/settlement-payout.test.ts`
Expected: FAIL — 라우트 모듈 없음.

- [ ] **Step 3: 라우트 작성**

Create `src/app/api/settlement/payout/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getCoupangClient } from '@/lib/listing/coupang-client';

const MONTH_RE = /^\d{4}-\d{2}$/;

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const month = req.nextUrl.searchParams.get('month');
  if (!month || !MONTH_RE.test(month)) {
    return NextResponse.json({ success: false, error: 'month (YYYY-MM) required' }, { status: 400 });
  }

  // 외부 API 실패해도 정산 화면이 죽지 않게 payout: null 로 흡수.
  try {
    const client = getCoupangClient();
    const payout = await client.getSettlementHistories(month);
    return NextResponse.json({ success: true, payout });
  } catch (err) {
    console.warn('[settlement] 지급 조회 실패:', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: true, payout: null });
  }
}
```

- [ ] **Step 4: 통과 확인 + 타입체크**

Run: `npx vitest run src/__tests__/api/settlement-payout.test.ts` (300s) — 4개 PASS.
Run: `npx tsc --noEmit` — 에러 없음.

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/settlement/payout/route.ts src/__tests__/api/settlement-payout.test.ts
git commit -m "feat(settlement): GET /api/settlement/payout 지급 확정 조회"
```

---

### Task 3: SettlementTab 배너

**Files:**
- Modify: `src/components/orders/SettlementTab.tsx`

- [ ] **Step 1: payout 상태 + fetch 추가**

`const [modal, setModal] = ...` 선언 근처(상태 선언부)에 추가:

```typescript
  const [payout, setPayout] = useState<{ finalAmount: number; settlementDate: string; status: string } | null>(null);
  const [payoutLoading, setPayoutLoading] = useState(false);
```

그리고 월별 데이터 로드 `useEffect(() => { load(); }, [load]);` 바로 아래에 payout 로드 추가:

```typescript
  useEffect(() => {
    let alive = true;
    setPayoutLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/settlement/payout?month=${ym}`);
        const json = await res.json();
        if (alive) setPayout(json.success ? json.payout : null);
      } finally {
        if (alive) setPayoutLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [ym]);
```

- [ ] **Step 2: 정산예상 계산 + 배너 JSX**

`const total = data?.monthTotal;` 아래에 정산예상 계산 추가:

```typescript
  // 내 장부 정산예상 = 매출 − 쿠폰 − 수수료 (내 비용은 제외 — 쿠팡이 떼는 게 아님)
  const expected = total ? total.revenue - total.couponDiscount - total.platformFee : 0;
```

그리고 월 이동 컨트롤 div(‹ 이전달 / {ym} / 다음달 › 가 있는 `<div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>...</div>`) **바로 다음 줄**에 배너를 삽입:

```tsx
      {payoutLoading ? (
        <div style={{ fontSize: 12, color: '#a1a1aa', marginBottom: 12 }}>쿠팡 지급 조회 중…</div>
      ) : payout && payout.finalAmount > 0 ? (
        <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: '#1e3a5f', marginBottom: 12 }}>
          <b>쿠팡 지급 확정 {won(payout.finalAmount)}원</b>
          {payout.settlementDate ? ` (지급일 ${payout.settlementDate})` : ''}
          {' · '}내 장부 정산예상 {won(expected)}원
          {' · '}차이 <b style={{ color: payout.finalAmount - expected < 0 ? '#b91c1c' : '#14532d' }}>{won(payout.finalAmount - expected)}원</b>
          <span style={{ color: '#93a3b8' }}> · 월 단위 참고 대조</span>
        </div>
      ) : (
        <div style={{ background: '#f4f4f5', border: '1px solid #e5e5e5', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: '#71717a', marginBottom: 12 }}>
          쿠팡 지급 미확정 — 정산 완료 후 표시됩니다.
        </div>
      )}
```

`won` 헬퍼는 파일에 이미 있다.

- [ ] **Step 3: 타입체크 + 탭 회귀**

Run: `npx tsc --noEmit` — 에러 없음.
Run: `npx vitest run src/__tests__/components/orders-client-tabs.test.tsx` (300s) — PASS.

- [ ] **Step 4: 커밋**

```bash
git add src/components/orders/SettlementTab.tsx
git commit -m "feat(settlement): 쿠팡 지급 확정 대조 배너"
```

---

### Task 4: 최종 검증

- [ ] **Step 1: 전체 테스트 + 타입체크**

Run: `npx tsc --noEmit` — 에러 없음.
Run: `npx vitest run src/__tests__/api/settlement-payout.test.ts src/lib/settlement/__tests__ src/__tests__/components/orders-client-tabs.test.tsx` (300s) — 전부 PASS.

- [ ] **Step 2: 실응답 필드 검증 (수동, 중요)**

dev 서버(로그인)에서 정산 탭을 **지난달**로 이동 → 배너에 지급 확정액이 뜨는지 확인. 안 뜨거나 0이면 dev 로그에서 `settlement-histories` 실제 응답을 확인:
- 필드명이 `finalAmount`/`settlementDate`/`status`와 다르면 Task 1의 매핑을 실제 필드명으로 수정 후 재검증.
- `vendorId` 쿼리 때문에 400/거부가 나면 Task 1 URL에서 `vendorId=...&` 제거.
이번 달(미확정)은 "쿠팡 지급 미확정" 안내인지 확인.

- [ ] **Step 3: 커밋 (매핑 수정 있었으면)**

```bash
git add src/lib/listing/coupang-client.ts
git commit -m "fix(coupang): settlement-histories 실응답 필드 매핑 조정"
```

---

## Self-Review 결과 (작성자 기록)

- **스펙 커버리지**: 클라이언트(§3.1→T1), 라우트(§3.2→T2), 배너·정산예상·엣지(§4→T3), 미검증 필드 확인(§미검증→T4 Step2). 모두 대응.
- **엣지**: payout null/실패→배너 숨김·미확정 안내(T2 catch, T3 삼항). 외부 API 실패가 500 안 되게 흡수.
- **미검증 위험**: settlement-histories 원본 필드명·vendorId 필요 여부 — T4 Step2에서 실응답으로 확정하도록 명시(은닉 캡 방지).
- **타입 일관성**: payout `{finalAmount, settlementDate, status}`가 라우트 응답·클라이언트 반환·배너에서 일치. expected는 프론트 계산.
- **비영향**: 매출 소스·calculate.ts·일별 표 무변경. 배너만 추가.
