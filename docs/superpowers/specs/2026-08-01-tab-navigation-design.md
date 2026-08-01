# 탭 내비게이션 + 화면 상태 캐시 설계

- 작성일: 2026-08-01
- 상태: 승인됨 (구현 계획 대기)

## 목적

화면을 옮겼다 돌아오면 작업 상태가 사라진다. 소싱에서 필터를 잡고 목록을 불러온 뒤 주문/매출을 확인하고 돌아오면, 필터도 목록도 처음부터다.

상단에 탭 바를 두어 열어둔 화면을 오가게 하고, 탭으로 돌아왔을 때 **API 재호출 없이 즉시 이전 모습**을 복원한다.

## 현재 구조와 제약

| 항목 | 현재 상태 | 영향 |
|---|---|---|
| 내비게이션 | `AppShell.tsx` 사이드바. 최상위 6개 + 하위 2개 | 탭 바를 얹을 위치는 메인 영역 최상단 |
| 레이아웃 | 라우트 10곳이 **각자 `layout.tsx`에서 `AppShell`을 감쌈** | 화면 전환 시 `AppShell` 재마운트 |
| 데이터 로딩 | `useEffect` + `fetch` (컴포넌트 56곳) | 재마운트되면 **무조건 API 재호출** |
| 클라이언트 라우터 캐시 | Next.js 16 기본 **꺼짐** (`staleTimes` 미설정) | 서버 응답도 매번 다시 가져옴 |
| 상태 관리 | `zustand` 5 사용 중 (`useEditorStore`, `useListingStore`) | 새 의존성 없이 캐시 계층 구축 가능 |
| `persist` 미들웨어 | 미사용 | 탭 영속에 새로 도입 (zustand 내장) |

`useListingStore`에 이미 *"탭 이동 시에도 입력값이 유지되도록 공통 필드를 스토어에서 관리"* 라는 주석이 있다. 같은 발상이 화면 내부에 부분 적용되어 있으며, 이 설계는 그것을 화면 사이로 확장한다.

### 라우팅 구조를 바꾸지 않는 이유

정석은 route group `(with-shell)/`으로 10개 라우트를 묶어 공통 레이아웃을 두는 것이다. 그러면 `AppShell`이 전환 간 유지된다. 그러나 라우트 폴더 10개를 옮겨야 한다.

탭 상태를 zustand에 두면 재마운트되어도 값이 그대로라 화면상 연속으로 보인다. 재마운트로 잃는 것은 탭 바의 가로 스크롤 위치뿐이며, 그마저 거의 발생하지 않는다.

> ⚠️ **"탭이 6개라 가로 스크롤이 안 생긴다"는 판단은 틀렸다.** 편집 중 탭은 상한 계산에서 빠지므로 **총 9개까지 정상적으로 존재할 수 있고**, 6개만으로도 1280px 화면에서 폭이 찬다(사이드바 220px 제외 시 탭당 약 173px × 6 = 1038px). 탭 바에 가로 스크롤은 **필요하다.**

**따라서 구조 변경 없이 진행한다.** 향후 다른 이유로 route group이 필요해지면 그때 옮긴다.

## 구성 요소

| 조각 | 경로 | 책임 | 의존 |
|---|---|---|---|
| `TabBar` | `src/components/TabBar.tsx` | 탭 렌더링, 클릭·닫기 처리 | `useTabStore` |
| `useTabStore` | `src/store/useTabStore.ts` | 탭 목록·활성 탭·LRU·영속 | zustand + persist |
| `useCacheStore` | `src/store/useCacheStore.ts` | 키별 데이터·타임스탬프 보관 | zustand |
| `useCachedFetch` | `src/hooks/useCachedFetch.ts` | SWR 조회 | `useCacheStore` |
| `useTabDirty` | `src/hooks/useTabDirty.ts` | 현재 탭을 편집 중으로 표시 | `useTabStore` |
| `useScrollRestore` | `src/hooks/useScrollRestore.ts` | 스크롤 위치 저장·복원 | `useCacheStore` |

각 조각은 독립적으로 테스트 가능하다. `TabBar`는 스토어만 알고 캐시를 모르며, `useCachedFetch`는 탭을 모른다. 둘을 잇는 것은 `AppShell`의 구독 코드 한 곳이다.

## 탭 스토어

```ts
type Tab = {
  id: string;          // 라우트 기준 식별자. 예: 'sourcing'
  href: string;        // 쿼리 포함 전체 경로. 예: '/sourcing?tab=discovery&page=3'
  label: string;       // 표시명. NAV_ITEMS에서 유도
  lastActiveAt: number;
  isDirty: boolean;
};

type TabState = {
  tabs: Tab[];
  activeId: string | null;
  openTab(href: string): void;   // 진입 시. 없으면 생성, 있으면 href 갱신 + 활성화
  closeTab(id: string): void;
  setDirty(id: string, dirty: boolean): void;
};
```

`openTab`은 `AppShell`이 `usePathname()`·`useSearchParams()` 변화를 구독해 호출한다. 사이드바 클릭이든 코드상 `router.push`든 주소가 바뀌면 항상 반영되므로, 진입 경로마다 따로 처리할 필요가 없다.

**활성화 전용 액션은 두지 않는다.** 탭 클릭도 `router.push(tab.href)`를 거쳐 같은 `openTab`으로 수렴하므로, `lastActiveAt` 갱신 경로가 하나뿐이다. 별도 `touchTab`은 호출처 없는 중복이 된다.

### 규칙

| 규칙 | 동작 |
|---|---|
| 식별 단위 | **라우트 1개 = 탭 1개.** 같은 라우트를 다른 쿼리로 열면 새 탭이 아니라 기존 탭의 `href`를 갱신 |
| 자동 추가 | 사이드바 등으로 화면에 진입하면 탭이 없을 때 생성 |
| 최대 개수 | **`isDirty`가 아닌 탭 기준 6개.** 초과 시 그중 `lastActiveAt`이 가장 오래된 탭을 닫음 |
| 편집 보호 | `isDirty === true`인 탭은 **상한 계산과 밀어내기 양쪽에서 제외**한다. 편집 내용을 말없이 버리지 않는다 |
| 편집 종료 | `isDirty`가 `false`로 바뀌는 순간 상한을 다시 계산해, 초과 상태면 그때 밀어낸다 |
| 영속 | `persist` 미들웨어로 `localStorage`에 `tabs`·`activeId` 저장 |
| 복원 | 재시작 시 탭 목록과 `href`(쿼리 포함) 복원. `isDirty`는 항상 `false`로 초기화 |

`href`에 쿼리를 담기 때문에 재시작 후에도 필터·페이지가 살아난다. 캐시는 메모리라 사라지므로, 복원된 탭은 처음 클릭할 때 한 번 로딩한다.

### 영속의 알려진 한계

| 한계 | 내용 |
|---|---|
| **저장은 최선 노력** | `localStorage` 쓰기가 막히면(사파리 쿠키 차단·프라이빗 모드·용량 초과) 조용히 넘긴다. **탭 저장 실패가 화면 이동을 막아서는 안 된다** |
| **손상된 저장값은 버린다** | 형태가 맞지 않으면 복원을 포기하고 빈 상태로 시작한다. 탭 목록은 다시 만들 수 있는 데이터라 마이그레이션 경로를 두지 않는다 |
| **낡은 라벨** | `label`은 저장 시점 값이다. 메뉴 이름이 바뀌어도 방문하지 않은 복원 탭은 옛 이름을 유지한다 |
| **창을 여럿 띄우면 마지막 쓰기가 이긴다** | 두 창이 같은 키를 공유한다. 창 B에서 닫은 탭이 창 A의 다음 이동 때 되살아난다. 1인용 도구라 수용한다 |

### 라벨 유도

`AppShell`의 `NAV_ITEMS`에서 `href` 접두사 매칭으로 라벨을 얻는다. `NAV_ITEMS`를 `src/lib/nav-items.tsx`로 분리해 `TabBar`와 `AppShell`이 함께 쓴다. 매칭 실패 시 경로 첫 세그먼트를 라벨로 쓴다.

## 캐시 스토어와 훅

```ts
type CacheEntry = {
  data: unknown;
  fetchedAt: number;
  error: string | null;
};

type CacheState = {
  entries: Record<string, CacheEntry>;
  scroll: Record<string, number>;
  set(key: string, data: unknown): void;
  invalidate(pattern: string): void;   // 'orders:*' 형태 지원
};
```

```ts
function useCachedFetch<T>(
  key: string,
  url: string,
  opts?: { enabled?: boolean; select?: (json: unknown) => T },
): {
  data: T | undefined;
  isLoading: boolean;       // 캐시가 없어 처음 불러오는 중
  isRevalidating: boolean;  // 캐시를 보여주며 뒤에서 갱신 중
  error: string | null;
  fetchedAt: number | null;
  refetch(): void;
};
```

### 동작 순서

| 상황 | 동작 |
|---|---|
| 캐시 있음 | 즉시 반환. `isRevalidating = true`로 백그라운드 요청 → 도착 시 교체 |
| 캐시 없음 | `isLoading = true` → 완료 시 저장 |
| 같은 키 동시 요청 | 진행 중인 Promise를 공유 (in-flight dedup) |
| 요청 실패 | **캐시를 지우지 않는다.** `error`만 세우고 이전 데이터를 계속 보여줌 |
| 저장·수정 후 | 호출 측이 `invalidate('orders:*')` 실행 |

응답 형태가 라우트마다 다르다 (`{success, data}` · `{success, items}` · `{success, rows}`). 훅은 파싱한 JSON 전체를 보관하고, `select`로 호출 측이 꺼내 쓴다.

### 키 규칙

```
<라우트>:<세부>
예) orders:list · orders:costs · sourcing:shortlist · sourcing:discovery
```

접두사가 라우트와 일치해야 한다. **탭이 닫힐 때 해당 라우트 접두사의 캐시를 일괄 해제**하기 때문이다.

스크롤 위치는 같은 스토어의 `scroll`에 **라우트 단위**로 담는다 (`'sourcing'`처럼 접두사만). 화면 하나에 스크롤 컨테이너가 여럿이면 `'sourcing#list'` 형태로 뒤에 붙인다.

### 캐시 생명주기

```
탭 닫힘 (수동 ✕ 또는 LRU 밀어내기)
  → invalidate('<라우트>:*')
  → 해당 엔트리와 스크롤 위치 제거
```

메모리 상한은 탭 6개 제한이 대신한다. 별도의 TTL이나 용량 관리는 두지 않는다.

## 화면 적용 방법

기존 코드를 한 줄로 치환한다.

```ts
// 전
const [rows, setRows] = useState<Order[]>([]);
const [loading, setLoading] = useState(true);
useEffect(() => {
  fetch('/api/orders')
    .then((r) => r.json())
    .then((j) => { if (j.success) setRows(j.rows); })
    .finally(() => setLoading(false));
}, []);

// 후
const { data: rows = [], isLoading: loading, isRevalidating } =
  useCachedFetch('orders:list', '/api/orders', {
    select: (j) => (j as { rows: Order[] }).rows,
  });
```

**치환하지 않은 화면은 기존대로 동작한다.** 캐시가 없을 뿐 깨지지 않으므로 점진 적용이 안전하다.

## 탭 바 UI

사이드바 오른쪽, 메인 영역 최상단에 높이 36px 가로 바를 둔다. `AppShell`의 메인 영역 `div` 안 최상단이며, 기존 `mainOverflow`·`mainDisplay` 동작은 그대로 둔다.

```
┌────────────┬──────────────────────────────────────────────┐
│            │ [소싱 · 방금 ↻][주문/매출 · 3분 전 ✕][대시보드 ✕]│
│  사이드바   ├──────────────────────────────────────────────┤
│            │                                              │
│            │              기존 화면 내용                    │
└────────────┴──────────────────────────────────────────────┘
```

| 요소 | 처리 |
|---|---|
| 활성 탭 | 배경 `C.card`, 하단 2px `C.accent` |
| 비활성 탭 | 배경 `C.bg`, 텍스트 `C.textSub` |
| 갱신 시각 | 라벨 옆 작게 "방금"·"3분 전". 30초마다 갱신 |
| 갱신 중 | 시각 자리에 회전 아이콘 |
| 편집 중(`isDirty`) | 라벨 앞 ● 표시 |
| 닫기 | `✕`. 활성 탭은 hover 없이도 표시, 나머지는 hover 시 |
| 활성 탭 닫기 | 바로 왼쪽 탭으로 이동. 탭이 없으면 `/dashboard` |
| 활성 탭이 **첫 번째**일 때 닫기 | 왼쪽 이웃이 없으므로 **오른쪽 탭**으로 이동. 브라우저 탭과 같은 거동이다 |
| 표시 조건 | **탭이 1개여도 항상 표시한다.** 개수에 따라 숨기면 두 번째 화면을 열 때 본문이 36px 밀려 내려가는 레이아웃 점프가 생긴다 |

색은 전부 `src/lib/design-tokens.ts`의 `C`를 쓴다. 새 색을 만들지 않는다.

## 단계 구성

| 단계 | 범위 | 완료 시 체감 |
|---|---|---|
| **1** | `nav-items` 분리 · `useTabStore` · `TabBar` · `AppShell` 연결 · localStorage 복원 | 탭으로 이동·복원 (캐시 없음) |
| **2** | `useCacheStore` · `useCachedFetch` · 탭 닫힘 시 무효화 · **소싱·주문 적용** | 두 화면 즉시 전환 |
| **3** | 나머지 화면 점진 치환 | 전 화면 즉시 전환 |
| **4** | `useScrollRestore` · `useTabDirty` 적용 (에디터·상품등록) | 스크롤·편집 보호 |

1단계만으로도 독립적으로 쓸 수 있다. 각 단계는 이전 단계를 깨지 않는다.

## 검증

`vitest`(단위)와 `playwright`(e2e)가 이미 설정되어 있다.

| 대상 | 방식 | 확인 항목 |
|---|---|---|
| `useTabStore` | 단위 | 자동 추가, 같은 라우트 재방문 시 `href` 갱신, non-dirty 6개 초과 시 LRU 밀어내기, `isDirty` 탭이 상한·밀어내기에서 빠지는지, dirty 해제 시 재계산되어 밀려나는지, 활성 탭 닫기 후 이동 대상 |
| `persist` | 단위 | 저장·복원, `isDirty` 초기화 |
| `useCachedFetch` | 단위 | 캐시 히트 시 즉시 반환, 백그라운드 갱신 후 교체, in-flight dedup, 실패 시 이전 데이터 유지, `invalidate` 패턴 매칭 |
| 연결 | 단위 | 탭 닫힘 → 해당 접두사 캐시 해제 |
| 전체 흐름 | e2e | 소싱에서 필터 지정 → 주문 이동 → 소싱 복귀 시 **API 호출 없이** 필터·목록 유지 → 새로고침 후 탭 복원 |

e2e에서 "API 호출 없이"는 `page.route()`로 요청 수를 세어 확인한다.

## 위험과 대응

| 위험 | 대응 |
|---|---|
| **낡은 값으로 판정** — 판매 임포트가 수동이라 원래도 있던 위험을 캐시가 키운다 | SWR로 매번 갱신 + 탭에 마지막 갱신 시각 상시 표시 + 갱신 중 표시 |
| 쓰기 후 목록이 낡음 | 저장·삭제 경로에서 `invalidate` 호출. 3단계 치환 시 화면별로 확인 |
| 메모리 증가 | 탭 6개 상한 + 닫힘 시 해제 |
| 캐시 키 충돌 | `<라우트>:<세부>` 규칙 강제. 치환 시 접두사가 라우트와 일치하는지 확인 |
| 폴링 화면과 충돌 | 발굴 탭 등 자체 폴링이 있는 화면은 **치환 대상에서 제외**한다. 폴링이 이미 최신성을 보장한다 |

## 범위 밖

| 항목 | 이유 |
|---|---|
| route group으로 레이아웃 통합 | 현 설계로 불필요. 다른 이유가 생기면 그때 |
| 탭 순서 드래그 변경 | 최대 6개라 이득이 작다 |
| 탭 분할 화면 | 요구에 없다 |
| 서버 동기화(기기 간 탭 공유) | `localStorage`로 충분 |
| 전역 `fetch` 가로채기 | 폴링·재고조회까지 캐시될 위험 |
