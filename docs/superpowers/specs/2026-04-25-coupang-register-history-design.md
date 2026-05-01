# 쿠팡 등록 이력 + Wings 확인 기능 설계

**날짜:** 2026-04-25  
**상태:** 승인됨

---

## 목적

자동등록 후 AI가 잘못 채운 필드가 없는지 쿠팡윙스에서 직접 확인할 수 있도록 한다.  
Coupang API는 draft 상태가 없으므로 UNDER_REVIEW(검수 대기) = 임시저장으로 활용한다.  
앱에서도 등록 이력을 추적하고, 문제 있으면 원클릭으로 삭제한다.

---

## 흐름

```
등록 완료 (UNDER_REVIEW)
  → sellerProductId를 Supabase에 저장
  → 성공 화면에 "Wings에서 확인하기" 버튼 표시
  → 페이지 상단 "최근 등록 상품" 목록에도 추가
       - Wings 링크 버튼
       - 삭제 버튼 (Coupang API 삭제 + Supabase 소프트 삭제)
```

---

## 변경 범위

### 1. Supabase 마이그레이션 (`036_coupang_registered_products.sql`)

```sql
CREATE TABLE coupang_registered_products (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  seller_product_id bigint NOT NULL,
  seller_product_name text NOT NULL,
  source_url       text,
  source_type      text,                          -- 'domeggook' | 'costco' | 'manual'
  wings_status     text DEFAULT 'UNDER_REVIEW',  -- UNDER_REVIEW | APPROVED | REJECTED | DELETED
  created_at       timestamptz DEFAULT now(),
  deleted_at       timestamptz                    -- soft delete
);

CREATE INDEX ON coupang_registered_products(user_id, created_at DESC);

ALTER TABLE coupang_registered_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "본인 데이터만" ON coupang_registered_products
  FOR ALL USING (auth.uid() = user_id);
```

### 2. `coupang-client.ts` — `deleteProduct()` 추가

```typescript
async deleteProduct(sellerProductId: number): Promise<void> {
  await this.request('DELETE', `/v2/providers/seller_api/apis/api/v4/products/${sellerProductId}`);
}
```

### 3. `POST /api/listing/coupang` 수정

성공 시 Supabase에 저장 추가:
```typescript
// 기존 registerProduct() 호출 후
await supabase.from('coupang_registered_products').insert({
  user_id: authUser.id,
  seller_product_id: result.sellerProductId,
  seller_product_name: d.sellerProductName,
  source_type: 'manual',
  wings_status: 'UNDER_REVIEW',
});
```

Response에 `wingsUrl` 추가:
```json
{
  "success": true,
  "data": {
    "sellerProductId": 12345678,
    "productUrl": "https://www.coupang.com/vp/products/12345678",
    "wingsUrl": "https://wing.coupang.com/vendor/products/manage"
  }
}
```

### 4. `DELETE /api/listing/coupang/[sellerProductId]/route.ts` 신규

- Coupang API로 상품 삭제
- Supabase `deleted_at` + `wings_status = 'DELETED'` 업데이트

### 5. `GET /api/listing/coupang/registered` 신규

- Supabase에서 최근 20개 조회 (deleted_at IS NULL)
- Response: `[{ sellerProductId, sellerProductName, sourceType, wingsStatus, createdAt }]`

### 6. `auto-register/page.tsx` UI 변경

#### 성공 화면 (등록 완료 후)
```
✅ 쿠팡 등록 완료 (검수 대기)
상품 ID: 12345678

[Wings에서 확인하기 →]   [새 상품 등록]
```
- "Wings에서 확인하기" → `https://wing.coupang.com/vendor/products/manage` 새 탭으로 열기

#### 페이지 상단 "최근 등록 상품" 섹션 (URL 입력 전 표시)
```
최근 등록 상품
─────────────────────────────────────────────
차량용 선풍기 7종  |  검수 대기  |  2026-04-25  |  [Wings] [삭제]
무선 키보드        |  승인        |  2026-04-24  |  [Wings]
```

---

## Wings URL 패턴

- 상품 목록 페이지: `https://wing.coupang.com/vendor/products/manage`
- 특정 상품 직접 링크는 Wings 세션 쿠키 기반이라 deep link 불가
- → 목록 페이지로 링크 + 앱에서 sellerProductId 표시로 검색 안내

---

## 제약 사항

- `dryRun: true`로 등록 시 Supabase 저장 안 함 (실제 ID 없음)
- Wings UNDER_REVIEW는 Coupang이 빠르면 수 분~수 시간 내 검수 완료할 수 있음
- 삭제는 UNDER_REVIEW 상태일 때만 가능 (APPROVED 후는 Wings에서 직접)
