# 소싱 URL 접근 불가 알림 설계

**날짜**: 2026-05-19  
**상태**: 승인됨

## 배경 및 목적

상품등록 탭(BrowseMode)에서 소싱 출처로 저장한 외부 URL(1688, 도매꾹 등)의 원본 상품이 삭제되거나 접근 불가가 됐을 때, 셀러가 자신의 온라인몰 상품도 함께 내려야 한다. 이를 자동으로 감지해 매일 오후 6시(KST)에 앱 내 배지 + 이메일로 알려주는 기능을 구축한다.

---

## 아키텍처

```
[매일 오후 6시 KST = 0 9 * * * UTC]
  │
  ▼
/api/listing/sourcing/check-dead-urls  ← 신규 Vercel Cron
  │
  ├─ product_sourcing 테이블에서 sourcing_type='online' 전체 조회
  │
  ├─ 각 URL에 HEAD request (timeout 8초, User-Agent 설정)
  │     404 / 410          → dead (알림 생성)
  │     403 / 5xx / 오류   → skip (일시적 문제 또는 geo-block)
  │
  ├─ 동일 product_id+platform 알림이 최근 24시간 내 존재하면 중복 스킵
  │
  ├─ alerts 테이블 INSERT  (type='sourcing_url_dead', severity='high')
  │
  └─ dead URL 있으면 Resend로 이메일 즉시 발송
       (없으면 메일 없음)

AppNav (프론트)
  └─ 마운트 시 /api/alerts?unread=true 폴링 → 미읽음 수 배지 표시
       클릭 → AlertList 드롭다운
```

**1688 geo-block 처리**: 1688.com 도메인은 Vercel 미국 서버에서 geo-block될 수 있으므로 404/410 이외의 에러는 dead로 판정하지 않는다.

---

## DB 변경

### product_sourcing 테이블 컬럼 추가

```sql
ALTER TABLE product_sourcing
  ADD COLUMN product_name VARCHAR(500);
```

- 기존 rows: NULL 유지 (알림 메시지에서 fallback으로 URL 표시)
- 신규 저장 시: BrowseMode에서 상품명을 함께 전달

---

## 신규 파일

### `/src/lib/listing/url-health-check.ts`

URL 유효성 판정 로직을 분리한 순수 함수 모듈.

```typescript
export type UrlCheckResult =
  | { status: 'dead'; httpStatus: number }
  | { status: 'alive' }
  | { status: 'skip'; reason: string };

export async function checkUrl(url: string): Promise<UrlCheckResult>
```

- HEAD request, timeout 8초
- 404/410 → `dead`
- 403/5xx/네트워크 오류 → `skip`
- 2xx/3xx → `alive`

### `/src/app/api/listing/sourcing/check-dead-urls/route.ts`

크론 엔드포인트. `CRON_SECRET` 인증 후 아래 순서로 실행:

1. `product_sourcing` WHERE `sourcing_type = 'online'` 전체 조회
2. 각 URL `checkUrl()` 호출 (동시 5개 제한 — Promise 배치로 직접 구현)
3. dead 판정 시 `alerts` 테이블에 INSERT (중복 체크 포함)
4. dead URL 있으면 Resend로 즉시 이메일 발송

---

## 수정 파일

### `/src/lib/alerts/types.ts`

```typescript
export type AlertType =
  | 'roas_low' | 'stock_low' | 'negative_review'
  | 'winner_lost' | 'sourcing_recommendation' | 'review_milestone'
  | 'inbound_return_warning' | 'channel_distribution'
  | 'sourcing_url_dead';  // 추가
```

### `/src/lib/alerts/digest-email.ts`

`TYPE_LABELS`에 추가:

```typescript
sourcing_url_dead: '🔗 소싱 URL 접근 불가',
```

### `/src/app/api/listing/sourcing/route.ts`

PUT body에 `productName?: string` 필드 추가. 전달 시 `product_name` 컬럼에 저장.

### `/src/store/useListingStore.ts`

`saveSourcing` 시그니처에 `productName?: string` 인자 추가. PUT 요청 body에 함께 전달.

```typescript
// 변경 전
saveSourcing: (platform, productId, type, value) => Promise<boolean>
// 변경 후
saveSourcing: (platform, productId, type, value, productName?: string) => Promise<boolean>
```

### `/src/components/listing/browse/BrowseMode.tsx`

`handleSave()` 에서 `saveSourcing()` 호출 시 현재 row의 상품명을 5번째 인자로 전달.

### `/src/components/AppNav.tsx`

- 마운트 시 `/api/alerts?unread=true` fetch → 미읽음 수 state 관리
- 5분마다 재폴링
- 미읽음 수 > 0 이면 네비게이션 우상단에 빨간 배지 표시
- 배지 클릭 시 `AlertList` 드롭다운 (Portal 또는 absolute 포지셔닝)

### `vercel.json`

```json
{
  "path": "/api/listing/sourcing/check-dead-urls",
  "schedule": "0 9 * * *"
}
```

---

## 알림 메시지 예시

**앱 내 AlertList**:

```
[high] 소싱 URL 접근 불가 — 캠핑 접이식 의자 (쿠팡)
https://detail.1688.com/offer/123456.html → 404
온라인 상품을 내리는 것을 검토하세요.
```

**이메일 제목**: `⚠️ 소싱 URL 2건 접근 불가 — 2026-05-19`

**이메일 본문**:
```
🔗 소싱 URL 접근 불가 (2건)

• 캠핑 접이식 의자 (쿠팡) — 404
  https://detail.1688.com/offer/123456.html

• 네파 자외선차단 모자 (네이버) — 410
  https://domeggook.com/main/item/itemView.php?uid=...

→ 해당 상품을 온라인몰에서 내리는 것을 검토하세요.
```

---

## 엣지 케이스

| 케이스 | 처리 |
|--------|------|
| 1688 geo-block (403) | skip — dead로 판정하지 않음 |
| 네트워크 타임아웃 | skip |
| 동일 URL 오늘 이미 알림 발송 | 중복 INSERT 스킵 |
| product_name이 NULL인 기존 레코드 | 메시지에서 URL로 fallback |
| dead URL이 0건 | 이메일 발송하지 않음 |
| RESEND_API_KEY 미설정 | 이메일 건너뜀, 앱 내 알림만 동작 |

---

## 범위 외 (이번 구현 제외)

- 페이지 콘텐츠 분석으로 "품절" 감지 (403/5xx 에러 외 soft-delete 케이스)
- 알림 발생 후 자동으로 상품 비활성화
- Slack/SMS 알림 채널
