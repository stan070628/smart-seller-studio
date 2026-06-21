# 수익·원가 탭 — 라인 숨김 & 채널 코드 팝오버 설계

**날짜:** 2026-06-21
**범위:** `src/components/orders/CostManagementTab.tsx` 및 관련 API/컴포넌트

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
- 기존 레코드는 `DEFAULT false`로 자동 처리된다.

### API 변경

**`PATCH /api/cost-management/products/[id]`**
- `body`에 `hidden: boolean` 필드 추가
- 유효성: boolean 타입이어야 하며, `undefined`이면 기존 값 유지
- SQL: `hidden = COALESCE($N, hidden)` (`false`는 NULL이 아니므로 COALESCE가 올바르게 동작)

**`GET /api/cost-management/products`**
- 기본값: `hidden = false` 인 행만 반환 (`WHERE hidden = false OR hidden IS NULL`)
- `?show_hidden=true` 쿼리 파라미터 추가 시 전체 반환 (숨김 포함)
- 응답 `summary` 객체에 `hidden_count: number` 추가 (별도 COUNT 쿼리 또는 서브쿼리)
  — 토글 버튼의 "숨김 N개" 카운트에 사용하며, `show_hidden=false` 모드에서도 항상 포함

### UI 변경 (`CostManagementTab.tsx`)

**상태**
```ts
const [showHidden, setShowHidden] = useState(false);
```

**데이터 로드**
- `load()` 함수: `showHidden` 상태에 따라 `?show_hidden=true` 파라미터 포함

**행 렌더링 (`renderProductRow`)**
- 삭제 버튼 왼쪽에 Eye/EyeOff 아이콘 추가 (lucide-react `Eye`, `EyeOff`)
- `hidden = false` 행: `Eye` 아이콘 → 클릭 시 `PATCH { hidden: true }` + 낙관적 업데이트로 즉시 목록에서 제거
- `hidden = true` 행 (show_hidden 모드): `EyeOff` 아이콘 + 행 전체 50% 불투명도 → 클릭 시 `PATCH { hidden: false }` + 복원

**상단 토글 (테이블 바로 위)**
- `hiddenCount > 0`일 때 표시:
  ```
  숨김 N개 표시하기 ▾  (또는 "숨김 N개 숨기기 ▴")
  ```
- `showHidden` 토글 → `load()` 재호출

**`ProductRow` 인터페이스**
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
  anchorEl: HTMLElement;        // 연필 버튼 DOM 엘리먼트 (위치 계산용)
  onClose: () => void;
  onSaved: (updates: Partial<ProductRow>) => void;
}
```

**동작**
- `position: fixed`, `anchorEl.getBoundingClientRect()`로 팝오버 위치 계산
- 화면 우측 끝 넘침 감지 후 왼쪽으로 뒤집기 (flip)
- 외부 클릭(`mousedown` 이벤트) 시 자동 닫힘
- 필드: `seller_product_id`, `vendor_item_id`, `naver_channel_product_no`
- 저장: 기존 `PATCH /api/cost-management/products/[id]` 호출
- `variants 불러오기` 버튼 포함 (seller_product_id 있을 때만)

**스타일**
- 배경 흰색, 테두리 `#e5e5e5`, border-radius 10px, box-shadow
- 너비 260px 고정
- z-index: 1000

### `CostManagementTab.tsx` 변경

**제거할 state (5개)**
```ts
// 삭제
const [editChannelId, setEditChannelId] = useState<string | null>(null);
const [editSellerProductId, setEditSellerProductId] = useState('');
const [editVendorItemId, setEditVendorItemId] = useState('');
const [editNaverChannelProductNo, setEditNaverChannelProductNo] = useState('');
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
- 연필 버튼의 `onClick`에서 `e.currentTarget`을 anchorEl로 넘김
  ```ts
  <button onClick={(e) => onEditChannel(e.currentTarget)}>✏</button>
  ```
- 별도 ref 불필요 — currentTarget이 곧 anchorEl

**렌더링**
- `CostManagementTab` 최하단에 `channelEditTarget` 있을 때 `ChannelEditPopover` 렌더
- `onSaved`: products 배열 낙관적 업데이트 후 `setChannelEditTarget(null)`

---

## 3. 파일 변경 목록

| 파일 | 변경 |
|------|------|
| `supabase/migrations/078_product_costs_hidden.sql` | 신규 |
| `src/app/api/cost-management/products/[id]/route.ts` | `hidden` 필드 PATCH 처리 추가 |
| `src/app/api/cost-management/products/route.ts` | `show_hidden` 쿼리 파라미터 처리 추가 |
| `src/components/orders/CostManagementTab.tsx` | 숨김 상태/토글/렌더링, 팝오버 state 교체 |
| `src/components/orders/ChannelEditPopover.tsx` | 신규 |
| `src/components/orders/ChannelCell.tsx` | `onEditChannel` prop 타입 변경 |

---

## 4. 범위 외 (이번 작업에 포함 안 함)

- 그룹 행(GroupRow) 숨김: 자식 행이 모두 숨겨질 때 그룹도 숨길지 — 별도 논의
- 숨김 행 일괄 복원 버튼
- 팝오버 키보드 트랩 (Tab 순환)
