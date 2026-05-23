# 내 상품 조회 — 소싱 출처 기능 설계

**날짜**: 2026-05-18  
**범위**: `BrowseMode` (내 상품 조회 탭) — 쿠팡/네이버 상품별 소싱 출처 입력 및 저장

---

## 목적

내 상품 조회 화면에서 각 상품이 어디서 소싱된 것인지 기록할 수 있게 한다.  
온라인 구매(1688, 도매꾹, 코스트코 온라인)와 오프라인 직접 사입(코스트코 등) 두 가지 유형을 지원한다.

---

## 데이터 모델

### Render PostgreSQL — 신규 테이블 `product_sourcing`

```sql
CREATE TABLE IF NOT EXISTS product_sourcing (
  id            SERIAL PRIMARY KEY,
  platform      TEXT NOT NULL CHECK (platform IN ('coupang', 'naver')),
  product_id    TEXT NOT NULL,
  sourcing_type TEXT NOT NULL CHECK (sourcing_type IN ('online', 'offline')),
  sourcing_value TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(platform, product_id)
);
```

- `platform`: `'coupang'` 또는 `'naver'`
- `product_id`: 쿠팡은 `sellerProductId`(number→string), 네이버는 `originProductNo`(number→string)
- `sourcing_type`: `'online'` (URL) 또는 `'offline'` (매장명)
- `sourcing_value`: URL 문자열 또는 매장명 문자열
- 하나의 상품에 소싱 출처는 반드시 하나 (UNIQUE 제약)

---

## API Routes

### `GET /api/listing/sourcing`

상품 목록 로드 시 배치 조회.

**Query params**
- `platform`: `coupang` | `naver`
- `ids`: 쉼표 구분 product_id 목록 (예: `12345,67890`)

**Response**
```json
{
  "sourcing": {
    "12345": { "type": "online", "value": "https://detail.1688.com/..." },
    "67890": { "type": "offline", "value": "코스트코" }
  }
}
```

### `PUT /api/listing/sourcing`

소싱 출처 저장 (upsert).

**Body**
```json
{
  "platform": "coupang",
  "productId": "12345",
  "type": "online",
  "value": "https://detail.1688.com/..."
}
```

**Response**: `{ "success": true }`

### `DELETE /api/listing/sourcing`

소싱 출처 삭제.

**Body**
```json
{ "platform": "coupang", "productId": "12345" }
```

**Response**: `{ "success": true }`

---

## 상태 관리 (useListingStore)

### 추가 상태

```ts
sourcingMap: Record<string, { type: 'online' | 'offline'; value: string } | null>;
```

키 형식: `${platform}:${productId}` (예: `"coupang:12345"`)

### 추가 액션

```ts
fetchSourcing: (platform: 'coupang' | 'naver', ids: string[]) => Promise<void>
saveSourcing: (platform: 'coupang' | 'naver', productId: string, type: 'online' | 'offline', value: string) => Promise<boolean>
deleteSourcing: (platform: 'coupang' | 'naver', productId: string) => Promise<boolean>
```

- `fetchSourcing`: 배치 GET → `sourcingMap` 병합 업데이트
- `saveSourcing`: optimistic update 후 PUT → 실패 시 롤백
- `deleteSourcing`: optimistic update 후 DELETE → 실패 시 롤백

---

## UI 변경

### BrowseMode 테이블 — "소싱 출처" 열 추가

`CoupangBrowser`, `NaverBrowser` 양쪽 테이블에 동일하게 적용.

#### 뱃지 상태

| 상태 | 표시 | 색상 |
|------|------|------|
| 미입력 | `＋ 소싱 출처` | 회색 점선 테두리 |
| 온라인 URL | `🌐 {도메인 or 플랫폼명}` | 파란색 (`#e0f2fe` / `#0369a1`) |
| 오프라인 매장 | `🏪 {매장명}` | 초록색 (`#f0fdf4` / `#15803d`) |

온라인 뱃지 라벨: URL에서 플랫폼명 추출
- `1688.com` → `1688`
- `domeggook.com` → `도매꾹`
- `costco.co.kr` → `코스트코 온라인`
- 그 외 → 도메인 첫 부분

#### 팝오버 (뱃지 클릭 시)

- 뱃지 위치 기준 절대 포지셔닝, 외부 클릭 시 닫힘
- 탭 토글: **🌐 온라인 URL** / **🏪 오프라인 매장** (택 1, 교집합 없음)

**온라인 탭**
- URL 텍스트 입력창
- 빠른 선택 칩: `1688`, `도매꾹`, `코스트코 온라인`
  - 칩 클릭 시 해당 플랫폼 URL prefix를 입력창에 채움
- 저장 / 취소 버튼
- 기존 소싱 정보가 있으면 삭제 버튼도 노출

**오프라인 탭**
- 매장명 텍스트 입력창 (placeholder: `예: 코스트코`)
- 빠른 선택 칩: `코스트코`
  - 칩 클릭 시 입력창에 자동 채움
- 저장 / 취소 버튼
- 기존 소싱 정보가 있으면 삭제 버튼도 노출

### 상품 로드 시 소싱 정보 자동 조회

- `fetchCoupangProducts` 완료 후 → `fetchSourcing('coupang', ids)`
- `fetchNaverProducts` 완료 후 → `fetchSourcing('naver', ids)`
- ids가 0개면 API 호출 생략

---

## 파일 변경 목록

| 파일 | 변경 내용 |
|------|-----------|
| `src/app/api/listing/sourcing/route.ts` | 신규 — GET / PUT / DELETE 핸들러 |
| `src/store/useListingStore.ts` | `sourcingMap`, `fetchSourcing`, `saveSourcing`, `deleteSourcing` 추가 |
| `src/components/listing/browse/BrowseMode.tsx` | 소싱 출처 열 + `SourcingBadge` + `SourcingPopover` 컴포넌트 추가 |
| Render DB (직접 실행) | `product_sourcing` 테이블 CREATE |

---

## 엣지 케이스

- URL 입력 시 빈 문자열 저장 불가 (저장 버튼 disabled)
- URL 형식 유효성 검사 불필요 — 사용자가 직접 관리
- 더보기로 추가 상품 로드 시 → 새로 추가된 ids만 배치 조회
- 팝오버가 열린 상태에서 탭 전환 시 입력값 초기화
