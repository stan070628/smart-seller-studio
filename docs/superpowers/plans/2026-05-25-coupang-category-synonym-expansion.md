# 쿠팡 카테고리 동의어 확장 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자가 카테고리 검색창에 입력한 키워드를 정적 동의어 매핑 테이블로 확장해, 쿠팡 카테고리 트리 검색 결과를 개선한다.

**Architecture:** `src/lib/listing/category-synonyms.ts`에 정적 매핑 테이블과 `expandKeyword(keyword)` 함수를 신규 생성한다. `/api/listing/coupang/categories` route가 이를 import해 키워드를 확장한 뒤 각 동의어로 트리 검색을 병렬 실행하고, `displayItemCategoryCode` 기준으로 중복을 제거해 반환한다. 클라이언트(`CategorySearch`)는 변경 없음.

**Tech Stack:** TypeScript, Next.js App Router API Route, Vitest

---

## 파일 구조

| 파일 | 작업 |
|---|---|
| `src/lib/listing/category-synonyms.ts` | 신규 — 정적 동의어 맵 + `expandKeyword` 함수 |
| `src/__tests__/lib/category-synonyms.test.ts` | 신규 — `expandKeyword` 단위 테스트 |
| `src/app/api/listing/coupang/categories/route.ts` | 수정 — `expandKeyword` import 및 키워드 검색 블록 교체 |
| `src/__tests__/api/coupang-categories-synonym.test.ts` | 신규 — 동의어 확장 통합 테스트 |

---

### Task 1: expandKeyword 함수 구현 (category-synonyms.ts)

**Files:**
- Create: `src/lib/listing/category-synonyms.ts`
- Test: `src/__tests__/lib/category-synonyms.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/__tests__/lib/category-synonyms.test.ts` 파일을 생성한다:

```typescript
import { describe, it, expect } from 'vitest';
import { expandKeyword } from '@/lib/listing/category-synonyms';

describe('expandKeyword', () => {
  it('매핑 있는 키워드는 원본을 첫 번째로, 동의어를 뒤에 반환', () => {
    const result = expandKeyword('등산가방');
    expect(result[0]).toBe('등산가방');
    expect(result).toContain('배낭');
    expect(result).toContain('트레킹백');
    expect(result.length).toBeGreaterThan(1);
  });

  it('매핑 없는 키워드는 원본만 포함한 길이 1 배열 반환', () => {
    expect(expandKeyword('없는키워드')).toEqual(['없는키워드']);
  });

  it('앞뒤 공백은 trim 처리 후 매핑 탐색', () => {
    const result = expandKeyword('  등산가방  ');
    expect(result[0]).toBe('등산가방');
    expect(result).toContain('배낭');
  });

  it('원본 키워드가 항상 배열의 첫 번째 요소', () => {
    const result = expandKeyword('텐트');
    expect(result[0]).toBe('텐트');
    expect(result.length).toBeGreaterThan(1);
  });

  it('텀블러 매핑 확인', () => {
    const result = expandKeyword('보온병');
    expect(result).toContain('텀블러');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/__tests__/lib/category-synonyms.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/listing/category-synonyms'`

- [ ] **Step 3: category-synonyms.ts 구현**

`src/lib/listing/category-synonyms.ts` 파일을 생성한다:

```typescript
const SYNONYM_MAP: Record<string, string[]> = {
  // 아웃도어/스포츠
  '등산가방': ['배낭', '트레킹백', '하이킹백'],
  '등산화': ['트레킹화', '하이킹화', '아웃도어화'],
  '텐트': ['캠핑텐트', '돔텐트', '터널텐트'],
  '캠핑의자': ['접이식의자', '폴딩체어', '캠핑체어'],
  '등산스틱': ['트레킹폴', '등산폴'],
  '등산복': ['아웃도어웨어', '트레킹복', '하이킹복'],
  '캠핑매트': ['에어매트', '폼매트', '수면매트'],
  '물통': ['보조물통', '트레킹물통', '스포츠물통'],

  // 패션
  '후드티': ['후드집업', '후드스웨트', '스웨트셔츠'],
  '트레이닝복': ['운동복', '조거팬츠', '트레이닝세트'],
  '크로스백': ['숄더백', '메신저백', '크로스바디백'],
  '패딩': ['다운자켓', '롱패딩', '숏패딩'],
  '맨투맨': ['스웨트셔츠', '크루넥'],
  '레깅스': ['타이츠', '압박스타킹', '요가팬츠'],
  '운동화': ['스니커즈', '트레이닝화', '런닝화'],
  '런닝화': ['조깅화', '마라톤화', '운동화'],
  '슬리퍼': ['쪼리', '샌들', '욕실화'],
  '토트백': ['에코백', '캔버스백'],

  // 가전
  '공기청정기': ['에어클리너', '공기정화기'],
  '에어프라이어': ['에어프라이기', '오일프리어'],
  '전기밥솥': ['압력밥솥', '전기압력밥솥'],
  '로봇청소기': ['로봇진공청소기', '자동청소기'],
  '스탠드선풍기': ['선풍기', '써큘레이터'],
  '제습기': ['습도조절기'],
  '가습기': ['초음파가습기', '스팀가습기'],
  '전기면도기': ['쉐이버', '전동면도기'],
  '헤어드라이기': ['드라이어', '헤어드라이어'],
  '무선청소기': ['핸디청소기', '스틱청소기'],
  '전기포트': ['전기주전자', '전기케틀'],

  // 주방/식품
  '믹서기': ['블렌더', '주서기', '핸드블렌더'],
  '보온병': ['텀블러', '진공보온병', '스텐보온병'],
  '냄비': ['스테인리스냄비', '압력냄비', '편수냄비'],
  '프라이팬': ['후라이팬', '코팅팬', '인덕션팬'],
  '도마': ['주방도마', '나무도마', '플라스틱도마'],
  '밀폐용기': ['반찬통', '보관용기', '식품용기'],

  // 유아
  '유아침대': ['아기침대', '범퍼침대', '유아범퍼침대'],
  '기저귀': ['팬티기저귀', '밴드기저귀'],
  '유모차': ['절충형유모차', '디럭스유모차', '휴대용유모차'],
  '아기띠': ['힙시트', '슬링', '캥거루아기띠'],
  '보행기': ['아기보행기', '유아보행기'],
  '젖병': ['아기젖병', '유리젖병', '실리콘젖병'],
  '분유': ['아기분유', '조제분유', '성장기분유'],
  '아기로션': ['베이비로션', '유아로션', '아기크림'],
  '장난감': ['유아완구', '아기장난감', '교육완구'],

  // 가구/인테리어
  '책상': ['컴퓨터책상', '학생책상', '사무용책상'],
  '의자': ['사무용의자', '게이밍의자', '학생의자'],
  '수납장': ['선반', '책장', '진열장'],
  '커튼': ['암막커튼', '차광커튼', '쉬폰커튼'],
  '러그': ['카펫', '매트', '플로어매트'],
  '침대프레임': ['침대', '퀸침대', '싱글침대'],
  '협탁': ['사이드테이블', '베드사이드테이블'],

  // IT/디지털
  '이어폰': ['유선이어폰', '이어버드'],
  '무선이어폰': ['블루투스이어폰', 'TWS', '에어팟'],
  '보조배터리': ['휴대용충전기', '파워뱅크', '외장배터리'],
  '휴대폰케이스': ['스마트폰케이스', '폰케이스', '핸드폰케이스'],
  '키보드': ['기계식키보드', '무선키보드', '블루투스키보드'],
  '마우스': ['무선마우스', '게이밍마우스', '블루투스마우스'],
  '웹캠': ['화상카메라', 'PC카메라'],
  'USB허브': ['멀티허브', 'USB분배기'],

  // 뷰티/헬스
  '선크림': ['선스크린', '자외선차단제', 'SPF크림'],
  '마스크팩': ['시트마스크', '패드마스크', '얼굴팩'],
  '세럼': ['에센스', '앰플'],
  '마사지기': ['안마기', '마사지건', '진동마사지기'],
  '체중계': ['체지방계', '스마트체중계'],

  // 반려동물
  '강아지사료': ['반려견사료', '도그푸드', '개사료'],
  '고양이사료': ['캣푸드', '반려묘사료'],
  '고양이화장실': ['캣박스', '모래화장실'],
  '강아지옷': ['반려견의류', '애견의류'],
  '리드줄': ['목줄', '가슴줄', '하네스'],
};

export function expandKeyword(keyword: string): string[] {
  const trimmed = keyword.trim();
  const synonyms = SYNONYM_MAP[trimmed];
  if (!synonyms) return [trimmed];
  return [trimmed, ...synonyms];
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/lib/category-synonyms.test.ts
```

Expected: PASS — 5 tests passed

- [ ] **Step 5: 커밋**

```bash
git add src/lib/listing/category-synonyms.ts src/__tests__/lib/category-synonyms.test.ts
git commit -m "feat: 쿠팡 카테고리 동의어 확장 — expandKeyword 함수 추가"
```

---

### Task 2: categories route에 동의어 확장 적용

**Files:**
- Modify: `src/app/api/listing/coupang/categories/route.ts`
- Test: `src/__tests__/api/coupang-categories-synonym.test.ts`

- [ ] **Step 1: 실패하는 통합 테스트 작성**

`src/__tests__/api/coupang-categories-synonym.test.ts` 파일을 생성한다:

```typescript
/**
 * coupang-categories-synonym.test.ts
 * GET /api/listing/coupang/categories 동의어 확장 통합 테스트
 *
 * 가짜 카테고리 트리를 주입해 동의어 확장이 실제로 검색 결과에 반영되는지 검증한다.
 * ("등산가방" 검색 → "배낭", "트레킹백" 노드도 결과에 포함)
 */

import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

// vi.mock은 hoisting되므로 import 전에 선언
vi.mock('@/lib/listing/coupang-client', () => {
  // 아웃도어 카테고리 아래 "등산가방"·"배낭"·"트레킹백" 세 말단 노드를 가진 최소 트리
  const fakeTree = {
    displayItemCategoryCode: 0,
    name: 'root',
    status: 'ACTIVE',
    child: [
      {
        displayItemCategoryCode: 100,
        name: '아웃도어',
        status: 'ACTIVE',
        child: [
          { displayItemCategoryCode: 1001, name: '등산가방', status: 'ACTIVE', child: [] },
          { displayItemCategoryCode: 1002, name: '배낭', status: 'ACTIVE', child: [] },
          { displayItemCategoryCode: 1003, name: '트레킹백', status: 'ACTIVE', child: [] },
        ],
      },
    ],
  };
  return {
    getCoupangClient: vi.fn(() => ({
      getCategoryTree: vi.fn().mockResolvedValue(fakeTree),
      predictCategory: vi.fn().mockResolvedValue(null),
    })),
  };
});

import { GET } from '@/app/api/listing/coupang/categories/route';

describe('GET /api/listing/coupang/categories — 동의어 확장', () => {
  it('동의어 매핑 있는 키워드: 원본 + 동의어 노드를 모두 반환', async () => {
    const req = new NextRequest(
      'http://localhost/api/listing/coupang/categories?keyword=등산가방',
    );
    const res = await GET(req);
    const body = await res.json();

    expect(body.success).toBe(true);
    const codes = (body.data as { code: number }[]).map((d) => d.code);
    expect(codes).toContain(1001); // 등산가방 (원본 키워드 매칭)
    expect(codes).toContain(1002); // 배낭 (동의어 매칭)
    expect(codes).toContain(1003); // 트레킹백 (동의어 매칭)
  });

  it('동의어 매핑 없는 키워드: 기존 트리 검색 결과만 반환', async () => {
    const req = new NextRequest(
      'http://localhost/api/listing/coupang/categories?keyword=없는키워드',
    );
    const res = await GET(req);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
  });

  it('중복 code 없음 — 동일 말단이 여러 검색에 걸려도 한 번만 포함', async () => {
    const req = new NextRequest(
      'http://localhost/api/listing/coupang/categories?keyword=등산가방',
    );
    const res = await GET(req);
    const body = await res.json();

    const codes = (body.data as { code: number }[]).map((d) => d.code);
    const uniqueCodes = [...new Set(codes)];
    expect(codes.length).toBe(uniqueCodes.length);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/__tests__/api/coupang-categories-synonym.test.ts
```

Expected: FAIL — 첫 번째 테스트에서 `codes`에 1002, 1003이 없어서 실패 (동의어 확장이 아직 적용되지 않음)

- [ ] **Step 3: route.ts 수정**

`src/app/api/listing/coupang/categories/route.ts` 상단에 import 추가:

```typescript
import { expandKeyword } from '@/lib/listing/category-synonyms';
```

같은 파일의 GET 핸들러에서 키워드 검색 블록(`if (keyword && keyword.trim().length > 0)`)을 다음으로 교체:

```typescript
    // 키워드 검색: 동의어 확장 후 트리 검색 + AI 예측 병렬 실행
    if (keyword && keyword.trim().length > 0) {
      const kw = keyword.trim();
      const keywords = expandKeyword(kw);

      // searchCategories는 동기 함수 — 동의어별로 실행 후 code 기준 중복 제거
      const seen = new Set<number>();
      const treeResults = keywords
        .flatMap((k) => searchCategories(root.child, k))
        .filter((cat) => {
          if (seen.has(cat.code)) return false;
          seen.add(cat.code);
          return true;
        });

      const predicted = await client.predictCategory(kw).catch(() => null);

      // AI 예측 결과를 최상단에 삽입 (중복 제거)
      const merged: { code: number; name: string; path: string; aiRecommended?: boolean }[] = [];

      if (predicted) {
        const lastName = predicted.categoryPath.split(' > ').at(-1) ?? predicted.categoryPath;
        merged.push({
          code: predicted.categoryId,
          name: lastName,
          path: predicted.categoryPath,
          aiRecommended: true,
        });
      }

      for (const item of treeResults) {
        if (predicted && item.code === predicted.categoryId) continue;
        merged.push(item);
      }

      return Response.json({ success: true, data: merged });
    }
```

교체 전 전체 기존 블록(현재 `route.ts` 136~165 라인):

```typescript
    // 키워드 검색: 트리 검색 + AI 예측 병렬 실행
    if (keyword && keyword.trim().length > 0) {
      const kw = keyword.trim();

      const [treeResults, predicted] = await Promise.all([
        Promise.resolve(searchCategories(root.child, kw)),
        client.predictCategory(kw).catch(() => null),
      ]);

      // AI 예측 결과를 최상단에 삽입 (중복 제거)
      const merged: { code: number; name: string; path: string; aiRecommended?: boolean }[] = [];

      if (predicted) {
        const lastName = predicted.categoryPath.split(' > ').at(-1) ?? predicted.categoryPath;
        merged.push({
          code: predicted.categoryId,
          name: lastName,
          path: predicted.categoryPath,
          aiRecommended: true,
        });
      }

      for (const item of treeResults) {
        // predict 결과와 중복 코드는 제외
        if (predicted && item.code === predicted.categoryId) continue;
        merged.push(item);
      }

      return Response.json({ success: true, data: merged });
    }
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/api/coupang-categories-synonym.test.ts
```

Expected: PASS — 3 tests passed

- [ ] **Step 5: 전체 테스트 회귀 확인**

```bash
npx vitest run
```

Expected: 기존 테스트 전부 통과, 새 테스트 포함 전체 green

- [ ] **Step 6: 커밋**

```bash
git add src/app/api/listing/coupang/categories/route.ts \
        src/__tests__/api/coupang-categories-synonym.test.ts
git commit -m "feat: 쿠팡 카테고리 검색에 동의어 확장 적용"
```
