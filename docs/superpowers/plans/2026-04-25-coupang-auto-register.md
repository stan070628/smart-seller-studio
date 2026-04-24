# 쿠팡 자동등록 (URL → 쿠팡윙스) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 도매꾹/코스트코 상품 URL을 입력하면 AI가 쿠팡 등록 필드를 매핑하고 단계별 wizard로 확인 후 쿠팡윙스 API로 직접 등록한다. 반복 등록 시 학습 엔진이 수정 패턴을 누적해 자동 모드로 전환된다.

**Architecture:** `/listing/auto-register` 신규 페이지에 6단계 wizard UI를 구성한다. 백엔드는 `parse-url` route(URL→상품 데이터), `ai-map` route(상품 데이터→쿠팡 필드+신뢰도)로 분리한다. 학습 엔진은 Supabase `auto_register_corrections` 테이블을 읽어 필드별 신뢰도를 계산하며, 신뢰도가 기준을 넘으면 해당 필드를 자동 통과시킨다.

**Tech Stack:** Next.js App Router, Anthropic SDK(`@/lib/ai/claude`), Supabase(`@/lib/supabase/server`), Vitest, `domeggook-client`, `costco-client`, `buildCoupangPayload`, `calcCoupangWing`, `edit-thumbnail` API

---

## File Map

### 신규 생성
| 파일 | 역할 |
|------|------|
| `src/lib/auto-register/types.ts` | 공유 타입 정의 |
| `src/lib/auto-register/url-parser.ts` | URL → `{ source, itemId }` 추출 |
| `src/lib/auto-register/ai-field-mapper.ts` | 상품 데이터 → 쿠팡 필드 + 신뢰도 매핑 |
| `src/lib/auto-register/learning-engine.ts` | 수정 이력 저장 + 신뢰도 계산 |
| `src/lib/auto-register/__tests__/url-parser.test.ts` | URL 파서 테스트 |
| `src/lib/auto-register/__tests__/learning-engine.test.ts` | 학습 엔진 테스트 |
| `src/app/api/auto-register/parse-url/route.ts` | POST: URL → 상품 데이터 |
| `src/app/api/auto-register/ai-map/route.ts` | POST: 상품 데이터 → 매핑 필드 |
| `src/components/listing/auto-register/WizardShell.tsx` | 단계 진행 표시 shell |
| `src/components/listing/auto-register/UrlInputStep.tsx` | URL 입력 + fetch |
| `src/components/listing/auto-register/steps/Step1BasicInfo.tsx` | 상품명, 카테고리, 브랜드 |
| `src/components/listing/auto-register/steps/Step2PriceStock.tsx` | 가격, 재고, 마진 |
| `src/components/listing/auto-register/steps/Step3Images.tsx` | 이미지 + AI 편집 |
| `src/components/listing/auto-register/steps/Step4DetailPage.tsx` | 상세페이지 + AI 편집 |
| `src/components/listing/auto-register/steps/Step5Delivery.tsx` | 배송/반품 정보 |
| `src/components/listing/auto-register/steps/Step6Keywords.tsx` | 검색태그 + 최종 확인 + 등록 |
| `src/app/listing/auto-register/page.tsx` | 전체 wizard 오케스트레이터 |
| `supabase/migrations/035_auto_register_corrections.sql` | 신규 테이블 마이그레이션 |

### 수정
| 파일 | 변경 내용 |
|------|---------|
| `src/lib/sourcing/costco-client.ts` | `fetchCostcoProduct(code)` 메서드 추가 |

---

## Task 1: 공유 타입 정의

**Files:**
- Create: `src/lib/auto-register/types.ts`

- [ ] **Step 1: 타입 파일 생성**

```typescript
// src/lib/auto-register/types.ts

export type SourceType = 'domeggook' | 'costco';

export interface ParsedUrl {
  source: SourceType;
  itemId: string;
}

/** AI가 단일 필드에 대해 반환하는 제안값 + 신뢰도 */
export interface MappedField<T = string> {
  value: T;
  confidence: number; // 0~1
}

/** ai-map route가 반환하는 전체 매핑 결과 */
export interface MappedCoupangFields {
  sellerProductName: MappedField<string>;
  displayCategoryCode: MappedField<number>;
  brand: MappedField<string>;
  salePrice: MappedField<number>;
  originalPrice: MappedField<number>;
  stockQuantity: MappedField<number>;
  deliveryChargeType: MappedField<'FREE' | 'NOT_FREE'>;
  deliveryCharge: MappedField<number>;
  searchTags: MappedField<string[]>;
}

/** 학습 엔진에 저장하는 단일 필드 수정 이력 */
export interface FieldCorrection {
  sourceType: SourceType;
  fieldName: keyof MappedCoupangFields;
  aiValue: string;
  acceptedValue: string;
  wasCorrected: boolean;
}

/** 학습 엔진이 반환하는 단일 필드 신뢰 상태 */
export interface FieldTrustStatus {
  fieldName: string;
  recentCount: number;
  acceptedCount: number;
  trustScore: number; // acceptedCount / recentCount
  isTrusted: boolean; // trustScore >= 0.8 && recentCount >= 5
}

/** 자동 모드 가용 여부 요약 */
export interface AutoModeStatus {
  isAvailable: boolean;
  fieldsTrusted: number;
  fieldsTotal: number;
  untrustedFields: string[];
}

/** parse-url route가 반환하는 정규화된 상품 데이터 */
export interface NormalizedProduct {
  source: SourceType;
  itemId: string;
  title: string;
  price: number;
  originalPrice?: number;
  imageUrls: string[];   // 첫 번째가 대표 이미지
  description: string;   // 텍스트 설명 (HTML 제거)
  brand?: string;
  categoryHint?: string; // 소스 카테고리명 (AI 매핑 힌트용)
  detailHtml?: string;   // 도매꾹 prepare API 결과 HTML (있으면)
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/lib/auto-register/types.ts
git commit -m "feat(auto-register): 공유 타입 정의"
```

---

## Task 2: URL 파서

**Files:**
- Create: `src/lib/auto-register/url-parser.ts`
- Create: `src/lib/auto-register/__tests__/url-parser.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```typescript
// src/lib/auto-register/__tests__/url-parser.test.ts
import { describe, it, expect } from 'vitest';
import { parseSourceUrl } from '../url-parser';

describe('parseSourceUrl', () => {
  it('도매꾹 상품 상세 URL에서 itemId를 추출한다', () => {
    const result = parseSourceUrl('https://www.domeggook.com/product/detail/12345678');
    expect(result).toEqual({ source: 'domeggook', itemId: '12345678' });
  });

  it('도매꾹 모바일 URL도 처리한다', () => {
    const result = parseSourceUrl('https://m.domeggook.com/product/detail/87654321');
    expect(result).toEqual({ source: 'domeggook', itemId: '87654321' });
  });

  it('코스트코 코리아 /p/ URL에서 productCode를 추출한다', () => {
    const result = parseSourceUrl('https://www.costco.co.kr/p/123456');
    expect(result).toEqual({ source: 'costco', itemId: '123456' });
  });

  it('코스트코 쿼리스트링 포함 URL도 처리한다', () => {
    const result = parseSourceUrl('https://www.costco.co.kr/p/123456?foo=bar');
    expect(result).toEqual({ source: 'costco', itemId: '123456' });
  });

  it('지원하지 않는 URL은 null을 반환한다', () => {
    expect(parseSourceUrl('https://www.naver.com/product/123')).toBeNull();
  });

  it('빈 문자열은 null을 반환한다', () => {
    expect(parseSourceUrl('')).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/lib/auto-register/__tests__/url-parser.test.ts
```
Expected: FAIL (url-parser 모듈 없음)

- [ ] **Step 3: url-parser 구현**

```typescript
// src/lib/auto-register/url-parser.ts
import type { ParsedUrl } from './types';

const PATTERNS: { source: ParsedUrl['source']; regex: RegExp }[] = [
  {
    source: 'domeggook',
    regex: /domeggook\.com\/product\/detail\/(\d+)/,
  },
  {
    source: 'costco',
    regex: /costco\.co\.kr\/p\/([A-Za-z0-9-]+)/,
  },
];

export function parseSourceUrl(url: string): ParsedUrl | null {
  for (const { source, regex } of PATTERNS) {
    const match = url.match(regex);
    if (match?.[1]) {
      return { source, itemId: match[1] };
    }
  }
  return null;
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/lib/auto-register/__tests__/url-parser.test.ts
```
Expected: 6 tests PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/auto-register/url-parser.ts src/lib/auto-register/__tests__/url-parser.test.ts
git commit -m "feat(auto-register): URL 파서 구현"
```

---

## Task 3: Supabase 마이그레이션

**Files:**
- Create: `supabase/migrations/035_auto_register_corrections.sql`

- [ ] **Step 1: 마이그레이션 파일 생성**

```sql
-- supabase/migrations/035_auto_register_corrections.sql
CREATE TABLE IF NOT EXISTS auto_register_corrections (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type    text NOT NULL CHECK (source_type IN ('domeggook', 'costco')),
  field_name     text NOT NULL,
  ai_value       text,
  accepted_value text,
  was_corrected  boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_auto_register_corrections_source_field
  ON auto_register_corrections (source_type, field_name, created_at DESC);
```

- [ ] **Step 2: 로컬 Supabase에 적용**

```bash
npx supabase db push
```
Expected: migration 035 applied successfully

- [ ] **Step 3: 커밋**

```bash
git add supabase/migrations/035_auto_register_corrections.sql
git commit -m "feat(auto-register): auto_register_corrections 테이블 마이그레이션 추가"
```

---

## Task 4: 학습 엔진

**Files:**
- Create: `src/lib/auto-register/learning-engine.ts`
- Create: `src/lib/auto-register/__tests__/learning-engine.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```typescript
// src/lib/auto-register/__tests__/learning-engine.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeFieldTrust, computeAutoModeStatus } from '../learning-engine';
import type { FieldTrustStatus } from '../types';

describe('computeFieldTrust', () => {
  it('5회 중 4회 통과(80%)이면 isTrusted=true', () => {
    const rows = [
      { was_corrected: false },
      { was_corrected: false },
      { was_corrected: false },
      { was_corrected: false },
      { was_corrected: true },
    ];
    const result = computeFieldTrust('sellerProductName', rows);
    expect(result.isTrusted).toBe(true);
    expect(result.trustScore).toBeCloseTo(0.8);
  });

  it('5회 중 3회 통과(60%)이면 isTrusted=false', () => {
    const rows = [
      { was_corrected: false },
      { was_corrected: false },
      { was_corrected: false },
      { was_corrected: true },
      { was_corrected: true },
    ];
    const result = computeFieldTrust('salePrice', rows);
    expect(result.isTrusted).toBe(false);
  });

  it('5회 미만이면 isTrusted=false', () => {
    const rows = [
      { was_corrected: false },
      { was_corrected: false },
      { was_corrected: false },
      { was_corrected: false },
    ];
    const result = computeFieldTrust('brand', rows);
    expect(result.isTrusted).toBe(false);
    expect(result.recentCount).toBe(4);
  });
});

describe('computeAutoModeStatus', () => {
  it('모든 필드가 신뢰됨이면 isAvailable=true', () => {
    const allTrusted: FieldTrustStatus[] = [
      'sellerProductName', 'displayCategoryCode', 'brand',
      'salePrice', 'originalPrice', 'stockQuantity',
      'deliveryChargeType', 'deliveryCharge', 'searchTags',
    ].map((f) => ({
      fieldName: f, recentCount: 5, acceptedCount: 5,
      trustScore: 1.0, isTrusted: true,
    }));
    const status = computeAutoModeStatus(allTrusted);
    expect(status.isAvailable).toBe(true);
    expect(status.untrustedFields).toHaveLength(0);
  });

  it('하나라도 미신뢰 필드가 있으면 isAvailable=false', () => {
    const statuses: FieldTrustStatus[] = [
      { fieldName: 'sellerProductName', recentCount: 5, acceptedCount: 5, trustScore: 1, isTrusted: true },
      { fieldName: 'displayCategoryCode', recentCount: 3, acceptedCount: 3, trustScore: 1, isTrusted: false },
    ];
    const status = computeAutoModeStatus(statuses);
    expect(status.isAvailable).toBe(false);
    expect(status.untrustedFields).toContain('displayCategoryCode');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/lib/auto-register/__tests__/learning-engine.test.ts
```
Expected: FAIL

- [ ] **Step 3: 학습 엔진 구현**

```typescript
// src/lib/auto-register/learning-engine.ts
import { getSupabaseServerClient } from '@/lib/supabase/server';
import type {
  FieldCorrection, FieldTrustStatus, AutoModeStatus, SourceType, MappedCoupangFields,
} from './types';

const ALL_FIELDS: Array<keyof MappedCoupangFields> = [
  'sellerProductName', 'displayCategoryCode', 'brand',
  'salePrice', 'originalPrice', 'stockQuantity',
  'deliveryChargeType', 'deliveryCharge', 'searchTags',
];

const TRUST_THRESHOLD = 0.8;
const MIN_SAMPLES = 5;

/** 순수 함수 — rows는 테이블의 최근 MAX_SAMPLES 행 */
export function computeFieldTrust(
  fieldName: string,
  rows: { was_corrected: boolean }[],
): FieldTrustStatus {
  const recentCount = rows.length;
  const acceptedCount = rows.filter((r) => !r.was_corrected).length;
  const trustScore = recentCount === 0 ? 0 : acceptedCount / recentCount;
  const isTrusted = recentCount >= MIN_SAMPLES && trustScore >= TRUST_THRESHOLD;
  return { fieldName, recentCount, acceptedCount, trustScore, isTrusted };
}

export function computeAutoModeStatus(statuses: FieldTrustStatus[]): AutoModeStatus {
  const untrustedFields = statuses.filter((s) => !s.isTrusted).map((s) => s.fieldName);
  return {
    isAvailable: untrustedFields.length === 0,
    fieldsTrusted: statuses.filter((s) => s.isTrusted).length,
    fieldsTotal: statuses.length,
    untrustedFields,
  };
}

/** DB에서 source_type 기준 각 필드 최근 5행 조회 후 신뢰도 계산 */
export async function getAutoModeStatus(sourceType: SourceType): Promise<AutoModeStatus> {
  const supabase = await getSupabaseServerClient();
  const statuses: FieldTrustStatus[] = await Promise.all(
    ALL_FIELDS.map(async (fieldName) => {
      const { data } = await supabase
        .from('auto_register_corrections')
        .select('was_corrected')
        .eq('source_type', sourceType)
        .eq('field_name', fieldName)
        .order('created_at', { ascending: false })
        .limit(MIN_SAMPLES);
      return computeFieldTrust(fieldName, data ?? []);
    }),
  );
  return computeAutoModeStatus(statuses);
}

/** 등록 완료 후 수정 이력 저장 */
export async function saveCorrections(corrections: FieldCorrection[]): Promise<void> {
  if (corrections.length === 0) return;
  const supabase = await getSupabaseServerClient();
  await supabase.from('auto_register_corrections').insert(
    corrections.map((c) => ({
      source_type: c.sourceType,
      field_name: c.fieldName,
      ai_value: c.aiValue,
      accepted_value: c.acceptedValue,
      was_corrected: c.wasCorrected,
    })),
  );
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/lib/auto-register/__tests__/learning-engine.test.ts
```
Expected: 5 tests PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/auto-register/learning-engine.ts src/lib/auto-register/__tests__/learning-engine.test.ts
git commit -m "feat(auto-register): 학습 엔진 구현 (신뢰도 계산 + 이력 저장)"
```

---

## Task 5: 코스트코 단일 상품 조회

**Files:**
- Modify: `src/lib/sourcing/costco-client.ts`

- [ ] **Step 1: `fetchCostcoProduct` 함수 추가**

`fetchCostcoSubcategory` 함수 아래에 다음을 추가한다:

```typescript
/**
 * OCC v2 API로 단일 상품을 product code로 조회한다.
 * URL: https://www.costco.co.kr/p/{code} 에서 추출한 code를 사용.
 */
export async function fetchCostcoProduct(code: string): Promise<CostcoApiProduct | null> {
  const params = new URLSearchParams({
    fields: COSTCO_API_DEFAULTS.fields,
    lang: COSTCO_API_DEFAULTS.lang,
    curr: COSTCO_API_DEFAULTS.curr,
  });

  const url = `${COSTCO_API_BASE}/products/${encodeURIComponent(code)}?${params.toString()}`;

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'ko-KR,ko;q=0.9',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
    next: { revalidate: 0 },
  });

  if (!res.ok) return null;

  const raw = (await res.json()) as OccSearchResponse['products'][number];
  const categoryCode = (raw as unknown as { categories?: { code?: string }[] })?.categories?.[0]?.code ?? '';
  const categoryName = OCC_CODE_TO_CATEGORY[categoryCode] ?? '기타';

  return occProductToApi(raw, categoryName, categoryCode);
}
```

- [ ] **Step 2: 빌드 타입 오류 확인**

```bash
npx tsc --noEmit 2>&1 | grep costco-client | head -10
```
Expected: 오류 없음

- [ ] **Step 3: 커밋**

```bash
git add src/lib/sourcing/costco-client.ts
git commit -m "feat(costco-client): fetchCostcoProduct — 단일 상품 code 조회 추가"
```

---

## Task 6: AI 필드 매퍼

**Files:**
- Create: `src/lib/auto-register/ai-field-mapper.ts`

- [ ] **Step 1: ai-field-mapper 구현**

```typescript
// src/lib/auto-register/ai-field-mapper.ts
import { getAnthropicClient } from '@/lib/ai/claude';
import type { NormalizedProduct, MappedCoupangFields } from './types';

const SYSTEM_PROMPT = `당신은 한국 이커머스 상품을 쿠팡 오픈마켓에 등록하기 위해 필드를 분석하는 전문가입니다.
주어진 상품 정보를 바탕으로 쿠팡 등록에 필요한 각 필드의 값을 추론하고, 각 필드에 대한 신뢰도(0.0~1.0)를 함께 반환하세요.
신뢰도는 정보가 충분하고 명확할수록 높게(0.9~1.0), 추측이 많이 필요할수록 낮게(0.3~0.5) 설정하세요.
반드시 JSON만 반환하세요.`;

function buildPrompt(product: NormalizedProduct): string {
  return `상품 정보:
- 제목: ${product.title}
- 가격(원가): ${product.price}원
- 원래가격: ${product.originalPrice ?? '없음'}원
- 브랜드: ${product.brand ?? '없음'}
- 소스 카테고리: ${product.categoryHint ?? '없음'}
- 설명: ${product.description.slice(0, 500)}

다음 JSON 스키마로 반환하세요:
{
  "sellerProductName": { "value": "string (쿠팡 상품명, 최대 100자)", "confidence": 0.0~1.0 },
  "displayCategoryCode": { "value": number (쿠팡 카테고리 코드, 모르면 0), "confidence": 0.0~1.0 },
  "brand": { "value": "string (브랜드명, 없으면 '기타')", "confidence": 0.0~1.0 },
  "salePrice": { "value": number (원 단위 정수), "confidence": 0.0~1.0 },
  "originalPrice": { "value": number (정가, 없으면 salePrice와 동일), "confidence": 0.0~1.0 },
  "stockQuantity": { "value": number (권장: 100), "confidence": 0.0~1.0 },
  "deliveryChargeType": { "value": "FREE" | "NOT_FREE", "confidence": 0.0~1.0 },
  "deliveryCharge": { "value": number (FREE이면 0), "confidence": 0.0~1.0 },
  "searchTags": { "value": ["태그1", "태그2", ...] (최대 10개), "confidence": 0.0~1.0 }
}`;
}

export async function mapProductToCoupangFields(
  product: NormalizedProduct,
): Promise<MappedCoupangFields> {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildPrompt(product) }],
  });

  const raw = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('');

  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const parsed = JSON.parse(cleaned) as MappedCoupangFields;

  // displayCategoryCode value가 0이면 confidence를 0으로 보정
  if (parsed.displayCategoryCode.value === 0) {
    parsed.displayCategoryCode.confidence = 0;
  }

  return parsed;
}
```

- [ ] **Step 2: 타입 체크**

```bash
npx tsc --noEmit 2>&1 | grep ai-field-mapper | head -10
```
Expected: 오류 없음

- [ ] **Step 3: 커밋**

```bash
git add src/lib/auto-register/ai-field-mapper.ts
git commit -m "feat(auto-register): AI 필드 매퍼 구현 (Claude → 쿠팡 필드 + 신뢰도)"
```

---

## Task 7: parse-url API Route

**Files:**
- Create: `src/app/api/auto-register/parse-url/route.ts`

- [ ] **Step 1: route 구현**

```typescript
// src/app/api/auto-register/parse-url/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { parseSourceUrl } from '@/lib/auto-register/url-parser';
import { getItemView } from '@/lib/sourcing/domeggook-client';
import { fetchCostcoProduct } from '@/lib/sourcing/costco-client';
import type { NormalizedProduct } from '@/lib/auto-register/types';

const BodySchema = z.object({ url: z.string().url() });

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: '유효하지 않은 URL 형식입니다.' }, { status: 400 });
  }

  const parsedUrl = parseSourceUrl(parsed.data.url);
  if (!parsedUrl) {
    return NextResponse.json(
      { error: '지원하지 않는 URL 형식입니다. 도매꾹 또는 코스트코 코리아 상품 URL을 입력해주세요.' },
      { status: 422 },
    );
  }

  try {
    let product: NormalizedProduct;

    if (parsedUrl.source === 'domeggook') {
      const item = await getItemView(parsedUrl.itemId);
      if (!item) {
        return NextResponse.json({ error: '도매꾹 상품을 찾을 수 없습니다.' }, { status: 404 });
      }
      product = {
        source: 'domeggook',
        itemId: parsedUrl.itemId,
        title: item.title ?? '',
        price: item.price ?? 0,
        originalPrice: item.originalPrice,
        imageUrls: item.images ?? [],
        description: item.description ?? '',
        brand: item.brand,
        categoryHint: item.categoryName,
      };
    } else {
      const item = await fetchCostcoProduct(parsedUrl.itemId);
      if (!item) {
        return NextResponse.json({ error: '코스트코 상품을 찾을 수 없습니다.' }, { status: 404 });
      }
      product = {
        source: 'costco',
        itemId: parsedUrl.itemId,
        title: item.title,
        price: item.price,
        originalPrice: item.originalPrice,
        imageUrls: item.imageUrl ? [item.imageUrl] : [],
        description: item.title,
        brand: item.brand,
        categoryHint: item.categoryName,
      };
    }

    return NextResponse.json({ product });
  } catch {
    return NextResponse.json({ error: '상품 정보를 가져오는 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
```

> **주의:** `getItemView`의 반환 타입은 `domeggook-client.ts`의 실제 타입과 일치시킨다. 필드명이 다를 경우 해당 클라이언트를 확인 후 수정한다.

- [ ] **Step 2: 빌드 오류 확인**

```bash
npx tsc --noEmit 2>&1 | grep parse-url | head -10
```
Expected: 오류 없음

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/auto-register/parse-url/route.ts
git commit -m "feat(auto-register): parse-url API route 구현"
```

---

## Task 8: ai-map API Route

**Files:**
- Create: `src/app/api/auto-register/ai-map/route.ts`

- [ ] **Step 1: route 구현**

```typescript
// src/app/api/auto-register/ai-map/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { mapProductToCoupangFields } from '@/lib/auto-register/ai-field-mapper';
import type { NormalizedProduct } from '@/lib/auto-register/types';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { product?: NormalizedProduct } | null;
  if (!body?.product) {
    return NextResponse.json({ error: 'product 데이터가 필요합니다.' }, { status: 400 });
  }

  // 10초 타임아웃
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('TIMEOUT')), 10_000),
  );

  try {
    const fields = await Promise.race([
      mapProductToCoupangFields(body.product),
      timeoutPromise,
    ]);
    return NextResponse.json({ fields });
  } catch (err) {
    if (err instanceof Error && err.message === 'TIMEOUT') {
      // 타임아웃 시 빈 필드 반환 — UI가 빈 wizard로 진입
      return NextResponse.json({ fields: null, timedOut: true });
    }
    return NextResponse.json({ error: 'AI 매핑 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
```

- [ ] **Step 2: 빌드 오류 확인**

```bash
npx tsc --noEmit 2>&1 | grep ai-map | head -10
```
Expected: 오류 없음

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/auto-register/ai-map/route.ts
git commit -m "feat(auto-register): ai-map API route 구현 (10초 타임아웃 포함)"
```

---

## Task 9: WizardShell 컴포넌트

**Files:**
- Create: `src/components/listing/auto-register/WizardShell.tsx`

- [ ] **Step 1: WizardShell 구현**

```tsx
// src/components/listing/auto-register/WizardShell.tsx
'use client';

const STEP_LABELS = [
  '기본 정보',
  '가격 · 재고',
  '이미지',
  '상세페이지',
  '배송 · 반품',
  '태그 · 등록',
];

interface WizardShellProps {
  currentStep: number; // 1-indexed
  children: React.ReactNode;
}

export function WizardShell({ currentStep, children }: WizardShellProps) {
  return (
    <div className="flex flex-col gap-6">
      {/* 단계 진행 표시 */}
      <div className="flex items-center gap-0">
        {STEP_LABELS.map((label, idx) => {
          const step = idx + 1;
          const isCompleted = step < currentStep;
          const isCurrent = step === currentStep;
          return (
            <div key={step} className="flex items-center">
              <div className="flex flex-col items-center gap-1">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                    isCompleted
                      ? 'bg-blue-600 text-white'
                      : isCurrent
                        ? 'bg-blue-100 text-blue-700 border-2 border-blue-600'
                        : 'bg-gray-100 text-gray-400'
                  }`}
                >
                  {isCompleted ? '✓' : step}
                </div>
                <span
                  className={`text-xs whitespace-nowrap ${
                    isCurrent ? 'text-blue-700 font-medium' : 'text-gray-400'
                  }`}
                >
                  {label}
                </span>
              </div>
              {idx < STEP_LABELS.length - 1 && (
                <div
                  className={`h-0.5 w-8 mx-1 mb-4 ${isCompleted ? 'bg-blue-600' : 'bg-gray-200'}`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* 단계 콘텐츠 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">{children}</div>
    </div>
  );
}
```

- [ ] **Step 2: 빌드 오류 확인**

```bash
npx tsc --noEmit 2>&1 | grep WizardShell | head -5
```
Expected: 오류 없음

- [ ] **Step 3: 커밋**

```bash
git add src/components/listing/auto-register/WizardShell.tsx
git commit -m "feat(auto-register): WizardShell 단계 진행 컴포넌트"
```

---

## Task 10: UrlInputStep 컴포넌트

**Files:**
- Create: `src/components/listing/auto-register/UrlInputStep.tsx`

- [ ] **Step 1: UrlInputStep 구현**

```tsx
// src/components/listing/auto-register/UrlInputStep.tsx
'use client';
import { useState } from 'react';
import type { NormalizedProduct, MappedCoupangFields } from '@/lib/auto-register/types';

interface UrlInputStepProps {
  onComplete: (product: NormalizedProduct, fields: MappedCoupangFields | null) => void;
}

export function UrlInputStep({ onComplete }: UrlInputStepProps) {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<'idle' | 'fetching' | 'mapping' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');
    setStatus('fetching');

    const parseRes = await fetch('/api/auto-register/parse-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    if (!parseRes.ok) {
      const data = await parseRes.json().catch(() => ({})) as { error?: string };
      setErrorMsg(data.error ?? '상품 정보를 가져오지 못했습니다.');
      setStatus('error');
      return;
    }

    const { product } = (await parseRes.json()) as { product: NormalizedProduct };
    setStatus('mapping');

    const mapRes = await fetch('/api/auto-register/ai-map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product }),
    });

    if (!mapRes.ok) {
      onComplete(product, null);
      return;
    }

    const { fields } = (await mapRes.json()) as { fields: MappedCoupangFields | null };
    onComplete(product, fields);
  }

  const isLoading = status === 'fetching' || status === 'mapping';

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">상품 URL 입력</h2>
        <p className="text-sm text-gray-500 mt-1">
          도매꾹 또는 코스트코 코리아 상품 상세 페이지 URL을 입력하세요.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.domeggook.com/product/detail/..."
          className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          disabled={isLoading}
        />

        {errorMsg && (
          <p className="text-sm text-red-600">{errorMsg}</p>
        )}

        <button
          type="submit"
          disabled={isLoading || !url}
          className="w-full py-3 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
        >
          {status === 'fetching' && '상품 정보 불러오는 중...'}
          {status === 'mapping' && 'AI가 필드를 분석하는 중...'}
          {(status === 'idle' || status === 'error') && '분석 시작'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: 빌드 오류 확인**

```bash
npx tsc --noEmit 2>&1 | grep UrlInputStep | head -5
```
Expected: 오류 없음

- [ ] **Step 3: 커밋**

```bash
git add src/components/listing/auto-register/UrlInputStep.tsx
git commit -m "feat(auto-register): UrlInputStep — URL 입력 + 상품 fetch + AI 매핑 트리거"
```

---

## Task 11: Step1BasicInfo ~ Step5Delivery 컴포넌트

**Files:**
- Create: `src/components/listing/auto-register/steps/Step1BasicInfo.tsx`
- Create: `src/components/listing/auto-register/steps/Step2PriceStock.tsx`
- Create: `src/components/listing/auto-register/steps/Step3Images.tsx`
- Create: `src/components/listing/auto-register/steps/Step4DetailPage.tsx`
- Create: `src/components/listing/auto-register/steps/Step5Delivery.tsx`

각 step 컴포넌트는 동일한 인터페이스를 따른다:

```typescript
interface StepProps<T> {
  initialValue: T;          // AI가 제안한 초기값 (없으면 빈 값)
  confidence?: number;      // 0~1, 표시용
  onNext: (value: T) => void;
  onBack: () => void;
}
```

- [ ] **Step 1: Step1BasicInfo 구현**

```tsx
// src/components/listing/auto-register/steps/Step1BasicInfo.tsx
'use client';
import { useState } from 'react';

export interface BasicInfoValue {
  sellerProductName: string;
  displayCategoryCode: number;
  brand: string;
}

interface Props {
  initialValue: Partial<BasicInfoValue>;
  confidences?: Partial<Record<keyof BasicInfoValue, number>>;
  onNext: (value: BasicInfoValue) => void;
  onBack: () => void;
}

export function Step1BasicInfo({ initialValue, confidences, onNext, onBack }: Props) {
  const [name, setName] = useState(initialValue.sellerProductName ?? '');
  const [categoryCode, setCategoryCode] = useState(
    initialValue.displayCategoryCode ? String(initialValue.displayCategoryCode) : '',
  );
  const [brand, setBrand] = useState(initialValue.brand ?? '기타');

  function handleNext() {
    onNext({
      sellerProductName: name,
      displayCategoryCode: Number(categoryCode) || 0,
      brand,
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <h3 className="font-semibold text-gray-900">기본 정보 확인</h3>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">
          상품명
          {confidences?.sellerProductName !== undefined && (
            <span className="ml-2 text-xs text-gray-400">
              AI 신뢰도 {Math.round((confidences.sellerProductName ?? 0) * 100)}%
            </span>
          )}
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">
          카테고리 코드
          {confidences?.displayCategoryCode !== undefined && (confidences.displayCategoryCode ?? 0) < 0.5 && (
            <span className="ml-2 text-xs text-orange-500">AI 신뢰도 낮음 — 직접 확인 필요</span>
          )}
        </label>
        <input
          value={categoryCode}
          onChange={(e) => setCategoryCode(e.target.value)}
          placeholder="예: 56137"
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="text-xs text-gray-400">
          쿠팡 카테고리 코드 (날개에서 확인 가능)
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">브랜드</label>
        <input
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="flex gap-3 justify-end mt-2">
        <button onClick={onBack} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
          이전
        </button>
        <button
          onClick={handleNext}
          disabled={!name || !categoryCode}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          다음
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Step2PriceStock 구현**

```tsx
// src/components/listing/auto-register/steps/Step2PriceStock.tsx
'use client';
import { useState } from 'react';
import { calcCoupangWing } from '@/lib/calculator/calculate';

export interface PriceStockValue {
  salePrice: number;
  originalPrice: number;
  stockQuantity: number;
}

interface Props {
  initialValue: Partial<PriceStockValue>;
  costPrice: number; // 원가 (계산기용)
  confidences?: Partial<Record<keyof PriceStockValue, number>>;
  onNext: (value: PriceStockValue) => void;
  onBack: () => void;
}

export function Step2PriceStock({ initialValue, costPrice, confidences, onNext, onBack }: Props) {
  const [salePrice, setSalePrice] = useState(initialValue.salePrice ?? 0);
  const [originalPrice, setOriginalPrice] = useState(initialValue.originalPrice ?? 0);
  const [stock, setStock] = useState(initialValue.stockQuantity ?? 100);

  const calc = calcCoupangWing({
    costPrice,
    sellingPrice: salePrice,
    category: '기타',
    shippingFee: 0,
    adCost: 0,
  });

  return (
    <div className="flex flex-col gap-5">
      <h3 className="font-semibold text-gray-900">가격 · 재고 확인</h3>

      <div className="flex gap-4">
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-sm font-medium text-gray-700">판매가 (원)</label>
          <input
            type="number"
            value={salePrice}
            onChange={(e) => setSalePrice(Number(e.target.value))}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-sm font-medium text-gray-700">정가 (원)</label>
          <input
            type="number"
            value={originalPrice}
            onChange={(e) => setOriginalPrice(Number(e.target.value))}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
        </div>
      </div>

      {salePrice > 0 && (
        <div className="bg-gray-50 rounded-lg p-3 text-sm">
          <p className="text-gray-600">예상 마진: <span className="font-medium text-gray-900">{calc.margin.toLocaleString()}원</span></p>
          <p className="text-gray-600">마진율: <span className="font-medium text-gray-900">{(calc.marginRate * 100).toFixed(1)}%</span></p>
        </div>
      )}

      <div className="flex flex-col gap-1 w-32">
        <label className="text-sm font-medium text-gray-700">재고 수량</label>
        <input
          type="number"
          value={stock}
          onChange={(e) => setStock(Number(e.target.value))}
          min={1}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="flex gap-3 justify-end mt-2">
        <button onClick={onBack} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
          이전
        </button>
        <button
          onClick={() => onNext({ salePrice, originalPrice, stockQuantity: stock })}
          disabled={salePrice <= 0}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          다음
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Step3Images 구현**

```tsx
// src/components/listing/auto-register/steps/Step3Images.tsx
'use client';
import { useState } from 'react';

export interface ImagesValue {
  thumbnailUrl: string;
  additionalUrls: string[];
}

interface Props {
  initialValue: ImagesValue;
  onNext: (value: ImagesValue) => void;
  onBack: () => void;
}

export function Step3Images({ initialValue, onNext, onBack }: Props) {
  const [thumbnail, setThumbnail] = useState(initialValue.thumbnailUrl);
  const [editInstruction, setEditInstruction] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editError, setEditError] = useState('');

  async function handleAiEdit() {
    if (!editInstruction.trim()) return;
    setIsEditing(true);
    setEditError('');
    const res = await fetch('/api/ai/edit-thumbnail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl: thumbnail, instruction: editInstruction }),
    });
    if (res.ok) {
      const data = await res.json() as { editedUrl?: string };
      if (data.editedUrl) setThumbnail(data.editedUrl);
    } else {
      setEditError('AI 편집 중 오류가 발생했습니다.');
    }
    setIsEditing(false);
  }

  return (
    <div className="flex flex-col gap-5">
      <h3 className="font-semibold text-gray-900">이미지 확인 · AI 편집</h3>

      {thumbnail ? (
        <div className="flex flex-col gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={thumbnail} alt="대표 이미지" className="w-48 h-48 object-cover rounded-lg border border-gray-200" />

          <div className="flex gap-2">
            <input
              value={editInstruction}
              onChange={(e) => setEditInstruction(e.target.value)}
              placeholder="예: 배경을 흰색으로 바꿔줘"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isEditing}
            />
            <button
              onClick={handleAiEdit}
              disabled={isEditing || !editInstruction.trim()}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              {isEditing ? '편집 중...' : 'AI 편집'}
            </button>
          </div>
          {editError && <p className="text-xs text-red-500">{editError}</p>}
        </div>
      ) : (
        <p className="text-sm text-gray-500">이미지를 불러오지 못했습니다.</p>
      )}

      <div className="flex gap-3 justify-end mt-2">
        <button onClick={onBack} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
          이전
        </button>
        <button
          onClick={() => onNext({ thumbnailUrl: thumbnail, additionalUrls: initialValue.additionalUrls })}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          다음
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Step4DetailPage 구현**

```tsx
// src/components/listing/auto-register/steps/Step4DetailPage.tsx
'use client';
import { useState } from 'react';

export interface DetailPageValue {
  detailHtml: string;
}

interface Props {
  initialValue: DetailPageValue;
  onNext: (value: DetailPageValue) => void;
  onBack: () => void;
}

const INSTRUCTION_CHIPS = [
  '더 자세한 상품 설명 추가',
  '배송 안내 추가',
  '주의사항 추가',
  '한국어로 다듬기',
];

export function Step4DetailPage({ initialValue, onNext, onBack }: Props) {
  const [html, setHtml] = useState(initialValue.detailHtml);
  const [instruction, setInstruction] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  async function handleAiEdit(instr: string) {
    setIsEditing(true);
    const res = await fetch('/api/ai/generate-detail-html', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentHtml: html, instruction: instr }),
    });
    if (res.ok) {
      const data = await res.json() as { html?: string };
      if (data.html) setHtml(data.html);
    }
    setIsEditing(false);
  }

  return (
    <div className="flex flex-col gap-5">
      <h3 className="font-semibold text-gray-900">상세페이지 확인 · AI 편집</h3>

      <div className="flex flex-wrap gap-2">
        {INSTRUCTION_CHIPS.map((chip) => (
          <button
            key={chip}
            onClick={() => handleAiEdit(chip)}
            disabled={isEditing}
            className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-full text-xs hover:bg-blue-100 hover:text-blue-700 disabled:opacity-50"
          >
            {chip}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="직접 편집 지시 입력..."
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          disabled={isEditing}
        />
        <button
          onClick={() => handleAiEdit(instruction)}
          disabled={isEditing || !instruction.trim()}
          className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          {isEditing ? '편집 중...' : 'AI 편집'}
        </button>
      </div>

      <div
        className="border border-gray-200 rounded-lg p-4 max-h-64 overflow-y-auto text-sm"
        dangerouslySetInnerHTML={{ __html: html }}
      />

      <div className="flex gap-3 justify-end mt-2">
        <button onClick={onBack} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
          이전
        </button>
        <button
          onClick={() => onNext({ detailHtml: html })}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          다음
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Step5Delivery 구현**

```tsx
// src/components/listing/auto-register/steps/Step5Delivery.tsx
'use client';
import { useState } from 'react';

export interface DeliveryValue {
  deliveryMethod: 'SEQUENCIAL' | 'VENDOR_DIRECT';
  deliveryChargeType: 'FREE' | 'NOT_FREE';
  deliveryCharge: number;
  outboundShippingPlaceCode: string;
  returnCenterCode: string;
}

interface Props {
  initialValue: DeliveryValue;
  onNext: (value: DeliveryValue) => void;
  onBack: () => void;
}

export function Step5Delivery({ initialValue, onNext, onBack }: Props) {
  const [value, setValue] = useState(initialValue);

  return (
    <div className="flex flex-col gap-5">
      <h3 className="font-semibold text-gray-900">배송 · 반품 정보 확인</h3>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">배송 방법</label>
          <select
            value={value.deliveryMethod}
            onChange={(e) => setValue({ ...value, deliveryMethod: e.target.value as DeliveryValue['deliveryMethod'] })}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          >
            <option value="SEQUENCIAL">순차배송</option>
            <option value="VENDOR_DIRECT">직배송</option>
          </select>
        </div>

        <div className="flex gap-4">
          <div className="flex flex-col gap-1 flex-1">
            <label className="text-sm font-medium text-gray-700">배송비 유형</label>
            <select
              value={value.deliveryChargeType}
              onChange={(e) => setValue({ ...value, deliveryChargeType: e.target.value as 'FREE' | 'NOT_FREE' })}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="FREE">무료</option>
              <option value="NOT_FREE">유료</option>
            </select>
          </div>
          {value.deliveryChargeType === 'NOT_FREE' && (
            <div className="flex flex-col gap-1 flex-1">
              <label className="text-sm font-medium text-gray-700">배송비 (원)</label>
              <input
                type="number"
                value={value.deliveryCharge}
                onChange={(e) => setValue({ ...value, deliveryCharge: Number(e.target.value) })}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">출하지 코드</label>
          <input
            value={value.outboundShippingPlaceCode}
            onChange={(e) => setValue({ ...value, outboundShippingPlaceCode: e.target.value })}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">반품센터 코드</label>
          <input
            value={value.returnCenterCode}
            onChange={(e) => setValue({ ...value, returnCenterCode: e.target.value })}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
        </div>
      </div>

      <div className="flex gap-3 justify-end mt-2">
        <button onClick={onBack} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
          이전
        </button>
        <button
          onClick={() => onNext(value)}
          disabled={!value.outboundShippingPlaceCode || !value.returnCenterCode}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          다음
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: 빌드 오류 확인**

```bash
npx tsc --noEmit 2>&1 | grep "steps/Step" | head -10
```
Expected: 오류 없음

- [ ] **Step 7: 커밋**

```bash
git add src/components/listing/auto-register/steps/Step1BasicInfo.tsx \
        src/components/listing/auto-register/steps/Step2PriceStock.tsx \
        src/components/listing/auto-register/steps/Step3Images.tsx \
        src/components/listing/auto-register/steps/Step4DetailPage.tsx \
        src/components/listing/auto-register/steps/Step5Delivery.tsx
git commit -m "feat(auto-register): wizard Step1~Step5 컴포넌트 구현"
```

---

## Task 12: Step6Keywords + 최종 등록

**Files:**
- Create: `src/components/listing/auto-register/steps/Step6Keywords.tsx`

- [ ] **Step 1: Step6Keywords 구현**

```tsx
// src/components/listing/auto-register/steps/Step6Keywords.tsx
'use client';
import { useState } from 'react';

export interface KeywordsValue {
  searchTags: string[];
}

interface RegisterSummary {
  sellerProductName: string;
  displayCategoryCode: number;
  brand: string;
  salePrice: number;
  stockQuantity: number;
  thumbnailUrl: string;
  deliveryChargeType: string;
}

interface Props {
  initialValue: KeywordsValue;
  summary: RegisterSummary;
  isRegistering: boolean;
  registerError: string;
  onNext: (value: KeywordsValue) => void; // 등록 트리거
  onBack: () => void;
}

export function Step6Keywords({ initialValue, summary, isRegistering, registerError, onNext, onBack }: Props) {
  const [tags, setTags] = useState(initialValue.searchTags);
  const [inputTag, setInputTag] = useState('');

  function addTag() {
    const trimmed = inputTag.trim();
    if (trimmed && !tags.includes(trimmed) && tags.length < 10) {
      setTags([...tags, trimmed]);
      setInputTag('');
    }
  }

  function removeTag(tag: string) {
    setTags(tags.filter((t) => t !== tag));
  }

  return (
    <div className="flex flex-col gap-5">
      <h3 className="font-semibold text-gray-900">검색 태그 · 최종 확인</h3>

      {/* 태그 입력 */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-700">검색 태그 (최대 10개)</label>
        <div className="flex gap-2">
          <input
            value={inputTag}
            onChange={(e) => setInputTag(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
            placeholder="태그 입력 후 Enter"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
          <button onClick={addTag} className="px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
            추가
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span key={tag} className="flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-700 rounded-full text-xs">
              {tag}
              <button onClick={() => removeTag(tag)} className="text-blue-400 hover:text-blue-700">×</button>
            </span>
          ))}
        </div>
      </div>

      {/* 등록 요약 */}
      <div className="bg-gray-50 rounded-lg p-4 text-sm flex flex-col gap-2">
        <p className="font-medium text-gray-700">등록 요약</p>
        <div className="grid grid-cols-2 gap-1 text-gray-600">
          <span>상품명</span><span className="font-medium text-gray-900 truncate">{summary.sellerProductName}</span>
          <span>카테고리 코드</span><span>{summary.displayCategoryCode}</span>
          <span>브랜드</span><span>{summary.brand}</span>
          <span>판매가</span><span>{summary.salePrice.toLocaleString()}원</span>
          <span>재고</span><span>{summary.stockQuantity}개</span>
          <span>배송비</span><span>{summary.deliveryChargeType === 'FREE' ? '무료' : '유료'}</span>
        </div>
      </div>

      {registerError && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{registerError}</p>
      )}

      <div className="flex gap-3 justify-end mt-2">
        <button onClick={onBack} disabled={isRegistering} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50">
          이전
        </button>
        <button
          onClick={() => onNext({ searchTags: tags })}
          disabled={isRegistering}
          className="px-6 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          {isRegistering ? '등록 중...' : '쿠팡에 등록하기'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 빌드 오류 확인**

```bash
npx tsc --noEmit 2>&1 | grep Step6 | head -5
```
Expected: 오류 없음

- [ ] **Step 3: 커밋**

```bash
git add src/components/listing/auto-register/steps/Step6Keywords.tsx
git commit -m "feat(auto-register): Step6Keywords — 검색태그 + 최종 확인 + 등록 버튼"
```

---

## Task 13: 메인 페이지 (오케스트레이터)

**Files:**
- Create: `src/app/listing/auto-register/page.tsx`

- [ ] **Step 1: 메인 페이지 구현**

```tsx
// src/app/listing/auto-register/page.tsx
'use client';
import { useState, useEffect } from 'react';
import { WizardShell } from '@/components/listing/auto-register/WizardShell';
import { UrlInputStep } from '@/components/listing/auto-register/UrlInputStep';
import { Step1BasicInfo, type BasicInfoValue } from '@/components/listing/auto-register/steps/Step1BasicInfo';
import { Step2PriceStock, type PriceStockValue } from '@/components/listing/auto-register/steps/Step2PriceStock';
import { Step3Images, type ImagesValue } from '@/components/listing/auto-register/steps/Step3Images';
import { Step4DetailPage, type DetailPageValue } from '@/components/listing/auto-register/steps/Step4DetailPage';
import { Step5Delivery, type DeliveryValue } from '@/components/listing/auto-register/steps/Step5Delivery';
import { Step6Keywords, type KeywordsValue } from '@/components/listing/auto-register/steps/Step6Keywords';
import type { NormalizedProduct, MappedCoupangFields, FieldCorrection, AutoModeStatus } from '@/lib/auto-register/types';

type WizardData = {
  product: NormalizedProduct;
  mappedFields: MappedCoupangFields | null;
  basicInfo?: BasicInfoValue;
  priceStock?: PriceStockValue;
  images?: ImagesValue;
  detailPage?: DetailPageValue;
  delivery?: DeliveryValue;
  deliveryDefaults?: { outboundShippingPlaceCode: string; returnCenterCode: string };
};

export default function AutoRegisterPage() {
  const [step, setStep] = useState<0 | 1 | 2 | 3 | 4 | 5 | 6>(0);
  const [data, setData] = useState<Partial<WizardData>>({});
  const [autoModeStatus, setAutoModeStatus] = useState<AutoModeStatus | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [registerError, setRegisterError] = useState('');
  const [registerSuccess, setRegisterSuccess] = useState(false);

  // 자동 모드 상태 로드
  useEffect(() => {
    if (!data.product) return;
    fetch(`/api/auto-register/learning-status?sourceType=${data.product.source}`)
      .then((r) => r.json())
      .then((d: { status: AutoModeStatus }) => setAutoModeStatus(d.status))
      .catch(() => {});
  }, [data.product]);

  // 배송 기본값 로드 (서버 env var → API route → 클라이언트)
  useEffect(() => {
    fetch('/api/auto-register/delivery-defaults')
      .then((r) => r.json())
      .then((d: { outboundShippingPlaceCode: string; returnCenterCode: string }) => {
        setData((prev) => ({ ...prev, deliveryDefaults: d }));
      })
      .catch(() => {});
  }, []);

  function handleUrlComplete(product: NormalizedProduct, fields: MappedCoupangFields | null) {
    setData({ product, mappedFields: fields });
    setStep(1);
  }

  async function handleFinalRegister(keywords: KeywordsValue) {
    if (!data.product || !data.basicInfo || !data.priceStock || !data.images || !data.detailPage || !data.delivery) return;
    setIsRegistering(true);
    setRegisterError('');

    const corrections: FieldCorrection[] = [];
    const mf = data.mappedFields;

    if (mf) {
      (['sellerProductName', 'brand', 'salePrice', 'stockQuantity'] as const).forEach((field) => {
        const aiVal = String(mf[field].value);
        let acceptedVal = '';
        if (field === 'sellerProductName') acceptedVal = data.basicInfo!.sellerProductName;
        else if (field === 'brand') acceptedVal = data.basicInfo!.brand;
        else if (field === 'salePrice') acceptedVal = String(data.priceStock!.salePrice);
        else if (field === 'stockQuantity') acceptedVal = String(data.priceStock!.stockQuantity);
        corrections.push({
          sourceType: data.product!.source,
          fieldName: field,
          aiValue: aiVal,
          acceptedValue: acceptedVal,
          wasCorrected: aiVal !== acceptedVal,
        });
      });
    }

    const res = await fetch('/api/listing/coupang', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: data.basicInfo.sellerProductName,
        salePrice: data.priceStock.salePrice,
        originalPrice: data.priceStock.originalPrice,
        stock: data.priceStock.stockQuantity,
        thumbnailImages: [data.images.thumbnailUrl, ...data.images.additionalUrls].filter(Boolean),
        detailImages: [],
        description: data.detailPage.detailHtml,
        deliveryCharge: data.delivery.deliveryCharge,
        deliveryChargeType: data.delivery.deliveryChargeType,
        returnCharge: 0,
        displayCategoryCode: data.basicInfo.displayCategoryCode,
        brand: data.basicInfo.brand,
        outboundShippingPlaceCode: data.delivery.outboundShippingPlaceCode,
        returnCenterCode: data.delivery.returnCenterCode,
        searchTags: keywords.searchTags,
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({})) as { error?: string };
      setRegisterError(errData.error ?? '등록 중 오류가 발생했습니다.');
      setIsRegistering(false);
      return;
    }

    // 수정 이력 저장
    if (corrections.length > 0) {
      await fetch('/api/auto-register/save-corrections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ corrections }),
      }).catch(() => {});
    }

    setIsRegistering(false);
    setRegisterSuccess(true);
  }

  if (registerSuccess) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center flex flex-col gap-4">
        <div className="text-5xl">✓</div>
        <h2 className="text-xl font-semibold text-gray-900">쿠팡 등록 완료!</h2>
        <p className="text-gray-500 text-sm">쿠팡윙스에서 등록된 상품을 확인할 수 있습니다.</p>
        <button
          onClick={() => { setStep(0); setData({}); setRegisterSuccess(false); }}
          className="mt-4 mx-auto px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          다른 상품 등록하기
        </button>
      </div>
    );
  }

  const mf = data.mappedFields;

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">쿠팡 자동등록</h1>
        <p className="text-sm text-gray-500 mt-1">도매꾹 · 코스트코 → 쿠팡윙스 직접 등록</p>
      </div>

      {autoModeStatus && (
        <div className="mb-4 bg-blue-50 rounded-lg px-4 py-2 text-sm text-blue-700">
          학습 현황: {autoModeStatus.fieldsTrusted}/{autoModeStatus.fieldsTotal} 필드 완료
          {autoModeStatus.isAvailable && ' · 자동 모드 사용 가능'}
        </div>
      )}

      {step === 0 && <UrlInputStep onComplete={handleUrlComplete} />}

      {step >= 1 && (
        <WizardShell currentStep={step}>
          {step === 1 && (
            <Step1BasicInfo
              initialValue={{
                sellerProductName: mf?.sellerProductName.value ?? data.product?.title ?? '',
                displayCategoryCode: mf?.displayCategoryCode.value ?? 0,
                brand: mf?.brand.value ?? data.product?.brand ?? '기타',
              }}
              confidences={{
                sellerProductName: mf?.sellerProductName.confidence,
                displayCategoryCode: mf?.displayCategoryCode.confidence,
                brand: mf?.brand.confidence,
              }}
              onNext={(v) => { setData((d) => ({ ...d, basicInfo: v })); setStep(2); }}
              onBack={() => setStep(0)}
            />
          )}
          {step === 2 && (
            <Step2PriceStock
              initialValue={{
                salePrice: mf?.salePrice.value ?? data.product?.price ?? 0,
                originalPrice: mf?.originalPrice.value ?? data.product?.originalPrice ?? 0,
                stockQuantity: mf?.stockQuantity.value ?? 100,
              }}
              costPrice={data.product?.price ?? 0}
              confidences={{
                salePrice: mf?.salePrice.confidence,
                stockQuantity: mf?.stockQuantity.confidence,
              }}
              onNext={(v) => { setData((d) => ({ ...d, priceStock: v })); setStep(3); }}
              onBack={() => setStep(1)}
            />
          )}
          {step === 3 && (
            <Step3Images
              initialValue={{
                thumbnailUrl: data.product?.imageUrls[0] ?? '',
                additionalUrls: data.product?.imageUrls.slice(1) ?? [],
              }}
              onNext={(v) => { setData((d) => ({ ...d, images: v })); setStep(4); }}
              onBack={() => setStep(2)}
            />
          )}
          {step === 4 && (
            <Step4DetailPage
              initialValue={{ detailHtml: data.product?.detailHtml ?? data.product?.description ?? '' }}
              onNext={(v) => { setData((d) => ({ ...d, detailPage: v })); setStep(5); }}
              onBack={() => setStep(3)}
            />
          )}
          {step === 5 && (
            <Step5Delivery
              initialValue={{
                deliveryMethod: 'SEQUENCIAL',
                deliveryChargeType: (mf?.deliveryChargeType.value ?? 'FREE') as 'FREE' | 'NOT_FREE',
                deliveryCharge: mf?.deliveryCharge.value ?? 0,
                outboundShippingPlaceCode: data.deliveryDefaults?.outboundShippingPlaceCode ?? '',
                returnCenterCode: data.deliveryDefaults?.returnCenterCode ?? '',
              }}
              onNext={(v) => { setData((d) => ({ ...d, delivery: v })); setStep(6); }}
              onBack={() => setStep(4)}
            />
          )}
          {step === 6 && data.basicInfo && data.priceStock && data.images && (
            <Step6Keywords
              initialValue={{ searchTags: mf?.searchTags.value ?? [] }}
              summary={{
                sellerProductName: data.basicInfo.sellerProductName,
                displayCategoryCode: data.basicInfo.displayCategoryCode,
                brand: data.basicInfo.brand,
                salePrice: data.priceStock.salePrice,
                stockQuantity: data.priceStock.stockQuantity,
                thumbnailUrl: data.images.thumbnailUrl,
                deliveryChargeType: data.delivery?.deliveryChargeType ?? 'FREE',
              }}
              isRegistering={isRegistering}
              registerError={registerError}
              onNext={handleFinalRegister}
              onBack={() => setStep(5)}
            />
          )}
        </WizardShell>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 빌드 오류 확인**

```bash
npx tsc --noEmit 2>&1 | grep auto-register | head -15
```
Expected: 오류 없음

- [ ] **Step 3: 커밋**

```bash
git add src/app/listing/auto-register/page.tsx
git commit -m "feat(auto-register): 메인 페이지 오케스트레이터 구현"
```

---

## Task 14: 보조 API Routes (learning-status, save-corrections)

**Files:**
- Create: `src/app/api/auto-register/learning-status/route.ts`
- Create: `src/app/api/auto-register/save-corrections/route.ts`
- Create: `src/app/api/auto-register/delivery-defaults/route.ts`

- [ ] **Step 1: learning-status route**

```typescript
// src/app/api/auto-register/learning-status/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAutoModeStatus } from '@/lib/auto-register/learning-engine';
import type { SourceType } from '@/lib/auto-register/types';

export async function GET(req: NextRequest) {
  const sourceType = req.nextUrl.searchParams.get('sourceType') as SourceType | null;
  if (sourceType !== 'domeggook' && sourceType !== 'costco') {
    return NextResponse.json({ error: 'sourceType은 domeggook 또는 costco여야 합니다.' }, { status: 400 });
  }
  const status = await getAutoModeStatus(sourceType);
  return NextResponse.json({ status });
}
```

- [ ] **Step 1b: delivery-defaults route** (클라이언트에서 서버 env var를 안전하게 읽기 위한 route)

```typescript
// src/app/api/auto-register/delivery-defaults/route.ts
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    outboundShippingPlaceCode: process.env.COUPANG_OUTBOUND_CODE ?? '',
    returnCenterCode: process.env.COUPANG_RETURN_CENTER_CODE ?? '',
  });
}
```
```

- [ ] **Step 2: save-corrections route**

```typescript
// src/app/api/auto-register/save-corrections/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { saveCorrections } from '@/lib/auto-register/learning-engine';
import type { FieldCorrection } from '@/lib/auto-register/types';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { corrections?: FieldCorrection[] } | null;
  if (!body?.corrections || !Array.isArray(body.corrections)) {
    return NextResponse.json({ error: 'corrections 배열이 필요합니다.' }, { status: 400 });
  }
  await saveCorrections(body.corrections);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: 빌드 오류 확인**

```bash
npx tsc --noEmit 2>&1 | grep "learning-status\|save-corrections" | head -5
```
Expected: 오류 없음

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/auto-register/learning-status/route.ts \
        src/app/api/auto-register/save-corrections/route.ts \
        src/app/api/auto-register/delivery-defaults/route.ts
git commit -m "feat(auto-register): learning-status, save-corrections, delivery-defaults API routes 추가"
```

---

## Task 15: 통합 확인 및 네비게이션 연결

- [ ] **Step 1: 개발 서버 실행**

```bash
npm run dev
```

- [ ] **Step 2: 브라우저에서 `/listing/auto-register` 접속 확인**

- URL 입력 폼이 표시되는지 확인
- 도매꾹 상품 URL 입력 → "분석 시작" 클릭 → Step 1 진입 확인
- 각 Step 이동이 정상 동작하는지 확인
- Step 6에서 "쿠팡에 등록하기" 버튼 클릭 → 성공 화면 확인

- [ ] **Step 3: ListingDashboard 우측 버튼 그룹에 링크 추가**

`src/components/listing/ListingDashboard.tsx` 약 424번째 줄 `{/* 우측 버튼 그룹 */}` 의 `div` 안, 기존 버튼들 앞에 다음을 추가한다:

```tsx
{/* 자동등록 버튼 */}
<Link
  href="/listing/auto-register"
  style={{
    padding: '6px 14px',
    borderRadius: '8px',
    border: '1px solid rgba(37,99,235,0.3)',
    backgroundColor: 'rgba(37,99,235,0.07)',
    color: '#1d4ed8',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    textDecoration: 'none',
  }}
>
  🤖 URL 자동등록
</Link>
```

`Link`는 파일 상단에 이미 `import Link from 'next/link'`로 import되어 있다 (line 12).

- [ ] **Step 4: 빌드 최종 확인**

```bash
npm run build 2>&1 | tail -20
```
Expected: 오류 없이 빌드 성공

- [ ] **Step 5: 최종 커밋**

```bash
git add -p  # 변경된 nav/dashboard 파일만 선택
git commit -m "feat(auto-register): 자동등록 페이지 네비게이션 연결"
```
