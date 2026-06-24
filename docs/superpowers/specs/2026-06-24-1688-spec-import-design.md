# 1688 URL → 스펙 가져오기 (Detail Maker 연동)

## 배경

Detail Maker에서 상세페이지를 만들 때 상품 스펙(크기, 재질 등)을 수동으로 입력해야 했다.
1688에서 사입한 상품의 경우, 해당 URL에서 스펙을 자동으로 가져와 `productSpecs`로 주입하면
Claude가 더 정확한 상세페이지 카피를 생성할 수 있다.
단, 1688에는 사입하지 않은 색상/사이즈 옵션도 존재하므로, 사용자가 원하는 항목만 선택할 수 있어야 한다.
이미지는 로컬 이미지(직접 촬영/캡쳐)를 업로드하는 기존 방식을 유지한다.

**범위**: 로컬 전용 (Playwright 사용). 프로덕션 배포 불필요.
이미지는 1688에서 가져오지 않음 — 기존처럼 직접 업로드(촬영/캡쳐본) 방식 유지.

---

## 아키텍처

### 데이터 흐름

```
사용자: 1688 URL 입력 → [가져오기]
  ↓
POST /api/listing/1688-scrape
  ↓
Playwright: 1688 페이지 렌더링 → 상품명 + 전체 스펙 추출
  ↓
DetailMakerClient: specs1688 state 저장 (checked: true 기본값)
  ↓
UI: 스펙 목록 + 체크박스 표시 (사용자가 사입한 옵션만 체크)
상품명 자동 채움 (편집 가능)
  ↓
[AI 상세페이지 생성] 클릭
  ↓
체크된 스펙만 productSpecs로 generate-detail-html에 전달
  ↓
Claude: 스펙을 이미지 분석보다 높은 우선순위로 카피에 반영
```

---

## 신규 파일

### `src/lib/scraping/1688-scraper.ts`

Playwright 기반 1688 스크래퍼.

```typescript
export interface Scrape1688Result {
  productName: string;
  specs: Array<{ label: string; value: string }>;
}

export async function scrape1688(url: string): Promise<Scrape1688Result>
```

- Chromium headless 실행 → URL 로드 → 네트워크 안정화 대기
- 상품명: `h1` 또는 `.offer-title` 셀렉터
- 스펙: `.detail-prop` 테이블 또는 속성 목록에서 추출
- 최대 대기 30초, 타임아웃 시 Error throw
- `finally`에서 반드시 browser.close()

### `src/app/api/listing/1688-scrape/route.ts`

```typescript
// POST /api/listing/1688-scrape
// Body: { url: string }
// Response: { success: true, productName: string, specs: Spec[] }
//         | { success: false, error: string }
```

- **로컬 전용**: `process.env.NODE_ENV !== 'development'`이면 501 반환
- URL 검증: 1688.com 도메인만 허용 (SSRF 방지)
- 인증 불필요 (로컬 전용)
- `scrape1688()` 호출 후 결과 반환

---

## 수정 파일

### `src/app/listing/detail-maker/DetailMakerClient.tsx`

**추가 state:**
```typescript
const [url1688, setUrl1688] = useState('');
const [specs1688, setSpecs1688] = useState<Array<{label: string; value: string; checked: boolean}>>([]);
const [isFetching1688, setIsFetching1688] = useState(false);
const [fetch1688Error, setFetch1688Error] = useState<string | null>(null);
```

**추가 핸들러:**
```typescript
async function handleFetch1688() {
  setIsFetching1688(true);
  setFetch1688Error(null);
  try {
    const res = await fetch('/api/listing/1688-scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url1688 }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    setSpecs1688(json.specs.map(s => ({ ...s, checked: true })));
    // 상품명이 비어있을 때만 자동 채움
    if (!productName.trim() && json.productName) setProductName(json.productName);
  } catch (e) {
    setFetch1688Error(e instanceof Error ? e.message : '가져오기 실패');
  } finally {
    setIsFetching1688(false);
  }
}
```

**`handleGenerate` 수정**: `productSpecs` 파라미터 추가
```typescript
const selectedSpecs = specs1688.filter(s => s.checked).map(({ label, value }) => ({ label, value }));
// fetch body에 추가:
productSpecs: selectedSpecs.length > 0 ? selectedSpecs : undefined,
```

**`DetailMakerInputPanel`에 props 추가:**
`url1688`, `setUrl1688`, `specs1688`, `setSpecs1688`, `isFetching1688`, `onFetch1688`, `fetch1688Error`

### `src/components/listing/detail-maker/DetailMakerInputPanel.tsx`

**추가 Props:**
```typescript
url1688: string;
setUrl1688: (v: string) => void;
specs1688: Array<{ label: string; value: string; checked: boolean }>;
setSpecs1688: React.Dispatch<React.SetStateAction<Array<{ label: string; value: string; checked: boolean }>>>;
isFetching1688: boolean;
onFetch1688: () => void;
fetch1688Error: string | null;
```

**추가 UI** (생성 버튼 바로 위에 배치):
- 접힘/펼침 토글 섹션 (`isOpen1688` 로컬 state)
- 펼쳐진 상태: URL 입력 + [가져오기] 버튼
- 로딩 중: 스피너
- 완료 후: 스펙 목록 (체크박스), 상품명 자동 채움 알림, 에러 메시지

---

## 에러 처리

| 상황 | 사용자에게 표시 |
|------|----------------|
| 1688.com 외 URL | "1688.com URL만 지원합니다" |
| Playwright 미설치 | "로컬 브라우저가 필요합니다. `npx playwright install chromium` 실행" |
| 페이지 로드 실패 | "페이지를 불러올 수 없습니다. URL을 확인해주세요" |
| 스펙 추출 0개 | "스펙을 찾지 못했습니다. 수동으로 입력해주세요" |
| 타임아웃 (30초) | "시간이 초과됐습니다. 다시 시도해주세요" |

---

## 검증 방법

1. `npx playwright install chromium` 설치 확인
2. 로컬 서버 실행 후 `/listing/detail-maker` 접속
3. 입력 패널 하단 "1688에서 스펙 가져오기" 섹션 펼치기
4. 실제 1688 상품 URL 입력 → [가져오기]
5. 스펙 목록 표시 확인, 일부 항목 체크 해제
6. 이미지 업로드 후 [AI 상세페이지 생성]
7. 생성된 상세페이지에 선택한 스펙이 정확히 반영되었는지 확인
8. `NODE_ENV=production` 환경에서 API 호출 시 501 반환 확인
