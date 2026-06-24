# 1688 URL → 스펙 가져오기 (Detail Maker 연동)

## 배경

Detail Maker에서 상세페이지를 만들 때 상품 스펙(크기, 재질 등)을 수동으로 입력해야 했다.
1688에서 사입한 상품의 경우, 해당 URL에서 스펙을 자동으로 가져와 `productSpecs`로 주입하면
Claude가 더 정확한 상세페이지 카피를 생성할 수 있다.
단, 1688에는 사입하지 않은 색상/사이즈 옵션도 존재하므로, 사용자가 원하는 항목만 선택할 수 있어야 한다.

**범위**: 로컬 전용 (`ENABLE_1688_SCRAPE=1` 환경변수로 활성화).
이미지는 1688에서 가져오지 않음 — 기존처럼 직접 업로드(촬영/캡쳐본) 방식 유지.
브라우저 자동화: 이미 설치된 `puppeteer-core` 재사용 (신규 의존성 없음).

---

## 아키텍처

### 데이터 흐름

```
사용자: 1688 URL 입력 → [가져오기]
  ↓
POST /api/listing/1688-scrape
  ↓
puppeteer-core: 1688 페이지 렌더링
  → window.__INIT_DATA__ 등 JSON state 파싱 (1순위)
  → DOM 셀렉터 fallback (2순위)
  → 상품명 + 전체 스펙 추출
  ↓
DetailMakerClient: specs1688 state 저장 (checked: true 기본값)
  ↓
UI: 스펙 목록 + 체크박스 (최대 20개 표시)
  사용자가 사입한 옵션만 체크 유지
  상품명 자동 채움 (편집 가능)
  ↓
[AI 상세페이지 생성] 클릭
  ↓
체크된 스펙 → .slice(0, 20) → productSpecs로 generate-detail-html 전달
  (백엔드 스키마 max(20) 제약 준수 — 스키마 변경 불필요)
  ↓
Claude: 스펙을 이미지 분석보다 높은 우선순위로 카피에 반영
```

---

## 신규 파일

### `src/lib/scraping/1688-scraper.ts`

puppeteer-core 기반 1688 스크래퍼.

```typescript
export interface Scrape1688Result {
  productName: string;
  specs: Array<{ label: string; value: string }>;
}

export async function scrape1688(url: string): Promise<Scrape1688Result>
```

**스크래핑 전략 (순서대로):**

1. **JSON state 파싱 (1순위)** — `window.__INIT_DATA__`, `window.__GLOBAL_DATA__`, `<script id="__NEXT_DATA__">` 등 페이지 내 임베드 JSON에서 상품명·스펙 추출. SPA 클래스 난독화와 무관하게 안정적.
2. **DOM 셀렉터 fallback (2순위)** — JSON state 파싱 실패 시 여러 후보 셀렉터를 순차 시도:
   - 상품명: `h1`, `.offer-title`, `[data-spm="offerTitle"]`
   - 스펙: `.detail-prop-group tr`, `[data-name][data-value]`, `dl dt+dd`

**대기 전략:**
- `networkidle2` 대신 스펙 요소가 나타날 때까지 `waitForSelector` (타임아웃 15초)
- 로그인/캡차 페이지 감지: 페이지 URL이 `login.1688.com` 또는 `passport.1688.com`을 포함하거나 스펙 추출 결과가 0개이고 제목에 "验证" 포함 시 캡차 에러 반환

**후처리:**
- 각 spec value: HTML 태그 제거, trim, 최대 200자 자르기
- label 최대 40자
- 중복 제거 (label 기준)
- 최대 20개 반환 (백엔드 스키마 제약)
- `finally`에서 반드시 `browser.close()`

**abort 처리:** 호출자가 AbortSignal을 넘길 수 있도록 옵션으로 지원. 신호 수신 시 browser.close() 후 AbortError throw.

### `src/app/api/listing/1688-scrape/route.ts`

```typescript
export const runtime = 'nodejs'; // puppeteer-core는 edge 불가

// POST /api/listing/1688-scrape
// Body: { url: string }
// Response: { success: true, productName: string, specs: Spec[] }
//         | { success: false, error: string }
```

**활성화 조건:** `process.env.ENABLE_1688_SCRAPE !== '1'`이면 501 반환.
(`NODE_ENV` 대신 명시적 플래그 — `npm run start` 로컬 실행 시에도 활성화 가능)

**URL 검증 (SSRF 방지):**
```typescript
const parsed = new URL(url); // 파싱 실패 시 throw
if (!parsed.hostname.endsWith('.1688.com') && parsed.hostname !== '1688.com') {
  return 400; // 문자열 포함 검사 금지 — hostname 파싱 후 검증
}
```

인증 불필요 (로컬 전용).

---

## 수정 파일

### `src/app/listing/detail-maker/DetailMakerClient.tsx`

**추가 state:**
```typescript
const [url1688, setUrl1688] = useState('');
const [specs1688, setSpecs1688] = useState<Array<{label: string; value: string; checked: boolean}>>([]);
const [isFetching1688, setIsFetching1688] = useState(false);
const [fetch1688Error, setFetch1688Error] = useState<string | null>(null);
const fetch1688AbortRef = useRef<AbortController | null>(null);
```

**추가 핸들러:**
```typescript
async function handleFetch1688() {
  // 진행 중 중복 요청 방지 (버튼 disabled와 이중 가드)
  if (isFetching1688) return;
  fetch1688AbortRef.current?.abort();
  const abortController = new AbortController();
  fetch1688AbortRef.current = abortController;

  setIsFetching1688(true);
  setFetch1688Error(null);
  try {
    const res = await fetch('/api/listing/1688-scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url1688 }),
      signal: abortController.signal,
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    // 재호출 시 기존 체크 상태 초기화 (의도적)
    setSpecs1688(json.specs.map(s => ({ ...s, checked: true })));
    // 상품명이 비어있을 때만 자동 채움
    if (!productName.trim() && json.productName) setProductName(json.productName);
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
    setFetch1688Error(e instanceof Error ? e.message : '가져오기 실패');
  } finally {
    setIsFetching1688(false);
  }
}

function handleToggleSpec(idx: number) {
  setSpecs1688(prev => prev.map((s, i) => i === idx ? { ...s, checked: !s.checked } : s));
}
```

**`handleGenerate` 수정:**
```typescript
const selectedSpecs = specs1688
  .filter(s => s.checked)
  .map(({ label, value }) => ({ label, value }))
  .slice(0, 20); // 백엔드 max(20) 제약
// fetch body에 추가:
productSpecs: selectedSpecs.length > 0 ? selectedSpecs : undefined,
```

**`DetailMakerInputPanel`에 props 추가:**
`url1688`, `setUrl1688`, `specs1688`, `onToggleSpec`, `isFetching1688`, `onFetch1688`, `fetch1688Error`

### `src/components/listing/detail-maker/DetailMakerInputPanel.tsx`

**추가 Props (기존 컨벤션 — 좁은 콜백 시그니처):**
```typescript
url1688: string;
setUrl1688: (v: string) => void;
specs1688: Array<{ label: string; value: string; checked: boolean }>;
onToggleSpec: (idx: number) => void;   // Dispatch 전체 노출 금지
isFetching1688: boolean;
onFetch1688: () => void;
fetch1688Error: string | null;
```

**추가 UI** (생성 버튼 바로 위, 접힘/펼침 토글):
- 로컬 state: `isOpen1688: boolean`
- 접힘: "🔗 1688에서 스펙 가져오기 ▼"
- 펼침:
  - URL input (`color: '#111'` 명시 — 다크모드 가시성)
  - [가져오기] 버튼 (`disabled={isFetching1688}`)
  - 로딩: 스피너
  - 완료: 스펙 체크박스 목록 (체크된 개수 표시), 상품명 자동 채움 배지
  - 에러: 인라인 에러 메시지
- 인라인 style + `C` 디자인 토큰 사용 (Tailwind 사용 금지)

---

## 환경변수

`.env.local`에 추가:
```
ENABLE_1688_SCRAPE=1
```

`.env.local.example`에도 주석과 함께 추가.

---

## 에러 처리

| 상황 | 사용자에게 표시 |
|------|----------------|
| 1688.com 외 URL | "1688.com URL만 지원합니다" |
| `ENABLE_1688_SCRAPE` 미설정 | "이 기능은 로컬 환경에서만 사용할 수 있습니다" |
| 로그인/캡차 페이지 감지 | "1688 로그인 또는 캡차가 감지됐습니다. 브라우저에서 직접 로그인 후 다시 시도해주세요" |
| 페이지 로드 실패 / 타임아웃 | "페이지를 불러올 수 없습니다. URL을 확인하거나 잠시 후 다시 시도해주세요" |
| 스펙 추출 0개 | 빈 배열 정상 반환 + UI에 "스펙을 찾지 못했습니다. 직접 입력해주세요" 안내 |

---

## 검증 방법

1. `.env.local`에 `ENABLE_1688_SCRAPE=1` 추가 후 개발 서버 재시작
2. `/listing/detail-maker` 접속 → 입력 패널 하단 "1688에서 스펙 가져오기" 펼치기
3. 실제 1688 상품 URL 입력 → [가져오기] — 스피너 표시 확인
4. 스펙 목록 표시 확인, 일부 항목 체크 해제
5. 상품명 자동 채움 확인 (이미 입력한 경우 덮어쓰기 안 됨)
6. 이미지 업로드 후 [AI 상세페이지 생성]
7. 생성된 상세페이지에 선택한 스펙이 정확히 반영됐는지 확인
8. `ENABLE_1688_SCRAPE` 미설정 상태에서 API 호출 시 501 확인
9. 1688.com 외 URL 입력 시 400 + 에러 메시지 확인
