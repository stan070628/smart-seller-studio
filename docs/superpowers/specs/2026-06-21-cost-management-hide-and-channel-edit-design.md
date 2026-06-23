# 수익·원가 탭 — 라인 숨김 & 채널 코드 팝오버 설계

**날짜:** 2026-06-21  
**범위:** `src/components/orders/CostManagementTab.tsx` 및 관련 API/컴포넌트  
**검토:** Opus 4.8 설계 검토 반영 (2026-06-21)

---

## 1. 라인 숨김 기능

### 목적
불필요한 상품 행을 숨겨 테이블을 간결하게 유지한다. 삭제와 달리 언제든 복원 가능하다.

### DB 변경
- **마이그레이션:** `supabase/migrations/078_product_costs_hidden.sql`
  ```sql
  ALTER TABLE product_costs
    ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;
  ```
- 기존 레코드는 `DEFAULT false`로 자동 처리되며, `NOT NULL` 제약으로 `IS NULL`인 행은 없다.

### API 변경

**`PATCH /api/cost-management/products/[id]`**
- `body`에 `hidden: boolean` 필드 추가
- **boolean 직렬화 주의:** `body.hidden === undefined ? null : body.hidden` 형태로 파라미터 생성.  
  `false`를 falsy 체크(`|| null`)로 변환하면 숨김 해제가 영구 불가해짐.
- SQL: `hidden = COALESCE($N, hidden)` — `false`는 NULL이 아니므로 기존 값 유지 패턴과 동일하게 동작
- 인증/소유권: 기존 `WHERE id = $1 AND user_id = $2` 조건 그대로 적용되므로 타 사용자 상품 숨김 방지됨

**`GET /api/cost-management/products`**
- 기본값: `WHERE hidden = false` (NOT NULL 컬럼이므로 `OR hidden IS NULL` 불필요)
- `?show_hidden=true` 시 전체 반환 (숨김 포함)
- 응답 `summary`에 `hidden_count: number` 추가 — **현재 채널 필터·기간 필터와 동일 조건** 하에서의 숨김 행 수
  - 구현: 메인 쿼리에서 `COUNT(*) FILTER (WHERE hidden = true)` 서브쿼리로 조건 공유
- **summary에서 숨김 행 집계 제외:** 기본 조회가 `hidden = false`만 반환하므로 summary 합계도 자동으로 숨김 행 제외됨

### UI 변경 (`CostManagementTab.tsx`)

**추가 상태**
```ts
const [showHidden, setShowHidden] = useState(false);
const [hiddenCount, setHiddenCount] = useState(0);
```

**데이터 로드 (`load` 함수)**
- `showHidden` 상태에 따라 `?show_hidden=true` 파라미터 포함
- 응답 `summary.hidden_count`로 `hiddenCount` 업데이트
- **상호작용 규칙:** `load()` 호출 시 `setChannelEditTarget(null)` — stale anchorEl/product 방지

**행 렌더링 (`renderProductRow`)**
- 삭제 버튼 왼쪽에 `Eye` / `EyeOff` 아이콘 추가 (lucide-react, 신규 import)
- `hidden = false` 행: `Eye` 아이콘 → 클릭 시:
  1. 낙관적 업데이트: products 배열에서 즉시 제거
  2. `PATCH { hidden: true }` 호출
  3. **실패 시:** 원래 배열 복원 + 에러 토스트 (예: `alert('숨김 처리 실패')` 또는 status 메시지)
- `hidden = true` 행 (`show_hidden` 모드): `EyeOff` 아이콘 + `opacity: 0.5` → 클릭 시 동일 패턴으로 복원
- **GroupRow:** Eye/EyeOff 아이콘 없음 (자식 행 단위로만 숨김). 그룹 내 일부 자식 숨김 시 그룹 헤더 집계는 서버 반환 데이터 기준이므로 자동으로 숨김 행 제외됨

**상단 토글 (테이블 섹션 바로 위)**
- `hiddenCount > 0`일 때 표시:
  ```
  숨김 N개 표시하기 ▾  /  숨김 N개 숨기기 ▴
  ```
- 클릭: `setShowHidden(!showHidden)` → `load()` 재호출
- **빈 상태:** 모든 행이 숨겨졌을 때 테이블 영역에 "상품이 없습니다. 숨김 N개 표시하기 버튼으로 복원할 수 있습니다." 표시

**`ProductRow` 인터페이스 추가**
```ts
hidden: boolean;
```

---

## 2. 채널 코드 팝오버

### 목적
현재 채널 셀이 커지며 테이블 레이아웃이 깨지는 인라인 폼 방식을 팝오버 모달로 교체한다.

### 새 컴포넌트: `ChannelEditPopover.tsx`

**위치:** `src/components/orders/ChannelEditPopover.tsx`

**Props**
```ts
interface ChannelEditPopoverProps {
  product: {
    id: string;
    seller_product_id: number | null;
    vendor_item_id: number | null;
    naver_channel_product_no: number | null;
  };
  anchorEl: HTMLElement;
  onClose: () => void;
  onSaved: (updates: { seller_product_id?: number | null; vendor_item_id?: number | null; naver_channel_product_no?: number | null }) => void;
}
```

**입력 상태 (string → number 변환)**
- 각 필드는 `string` state로 관리 (기존 인라인 폼과 동일)
- 저장 시: `parseInt(val, 10) || null` 로 변환 후 PATCH 호출
- 빈 문자열 → `null` (채널 연결 해제)

**위치 계산**
- `position: fixed`, `anchorEl.getBoundingClientRect()`로 초기 위치 계산
- 화면 우측 끝 넘침: `right < popoverWidth` 감지 후 왼쪽으로 flip
- **스크롤/리사이즈 처리:** `useEffect`에서 `scroll`·`resize` 이벤트 감지 시 `onClose()` 호출 — 위치 재계산보다 단순 닫기로 처리 (사용자가 다시 열면 됨)

**외부 클릭 닫힘**
- `mousedown` 이벤트로 외부 클릭 감지
- **anchor 충돌 방지:** `anchorEl.contains(e.target)`이면 닫힘 건너뜀 — 버튼 재클릭 토글 충돌 방지

**키보드**
- `Esc` 키로 닫힘 (`keydown` 이벤트)
- Tab 트랩은 이번 범위 외

**기타 동작**
- 필드: `seller_product_id`, `vendor_item_id`, `naver_channel_product_no`
- 저장: 기존 `PATCH /api/cost-management/products/[id]` 호출
- `variants 불러오기` 버튼: `seller_product_id` 있을 때만 표시 (기존 `fetchVariants` 함수 재활용)
- 저장 성공 시: `onSaved(updates)` → `onClose()`

**스타일**
- 흰색 배경, `border: 1px solid #e5e5e5`, `border-radius: 10px`, `box-shadow`
- 너비 260px 고정, `z-index: 1000`

### `CostManagementTab.tsx` 변경

**제거할 state (4개) + 관련 함수**
```ts
// 삭제
const [editChannelId, setEditChannelId] = useState<string | null>(null);
const [editSellerProductId, setEditSellerProductId] = useState('');
const [editVendorItemId, setEditVendorItemId] = useState('');
const [editNaverChannelProductNo, setEditNaverChannelProductNo] = useState('');
// 삭제: openEditChannel(), saveEditChannel() 함수
```

**추가할 state**
```ts
const [channelEditTarget, setChannelEditTarget] = useState<{
  product: ProductRow;
  anchorEl: HTMLElement;
} | null>(null);
```

**`ChannelCell` 변경**
- `onEditChannel` prop 타입: `(anchorEl: HTMLElement) => void`
- 연필 버튼 `onClick`: `(e) => onEditChannel(e.currentTarget as HTMLElement)`

**`renderProductRow` 변경**
- `editChannelId === p.id` 분기 제거
- `ChannelCell`의 `onEditChannel` → `(anchorEl) => setChannelEditTarget({ product: p, anchorEl })`

**렌더링**
- `CostManagementTab` 최하단:
  ```tsx
  {channelEditTarget && (
    <ChannelEditPopover
      product={channelEditTarget.product}
      anchorEl={channelEditTarget.anchorEl}
      onClose={() => setChannelEditTarget(null)}
      onSaved={(updates) => {
        setProducts(prev => prev.map(p => p.id === channelEditTarget.product.id ? { ...p, ...updates } : p));
        setChannelEditTarget(null);
      }}
    />
  )}
  ```

---

## 3. 파일 변경 목록

| 파일 | 변경 |
|------|------|
| `supabase/migrations/078_product_costs_hidden.sql` | 신규 |
| `src/app/api/cost-management/products/[id]/route.ts` | `hidden` 필드 PATCH 처리 추가 |
| `src/app/api/cost-management/products/route.ts` | `show_hidden` 파라미터, `hidden_count` 추가 |
| `src/components/orders/CostManagementTab.tsx` | 숨김 상태/토글/렌더링, 채널 편집 state 교체 |
| `src/components/orders/ChannelEditPopover.tsx` | 신규 |
| `src/components/orders/ChannelCell.tsx` | `onEditChannel` prop 타입 변경 |

---

## 4. 범위 외 (이번 작업에 포함 안 함)

- GroupRow 단위 숨김 (자식 전체 숨기기)
- 숨김 행 일괄 복원 버튼
- 팝오버 키보드 트랩 (Tab 순환)
- floating-ui 라이브러리 도입 (스크롤 중 위치 유지)
