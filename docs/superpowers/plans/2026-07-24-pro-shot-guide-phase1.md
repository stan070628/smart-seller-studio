# PRO 촬영 가이드 (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PRO `result` 화면에서 레이아웃의 `detail_closeup` 슬롯들을 사람용 촬영 지시(리치 카드)로 변환해 보여주는 `shootguide` 화면을 추가한다. 표시 전용(업로드/보정/저장 없음).

**Architecture:** 순수 로직(추출·직렬화·파싱)을 `src/lib/detail-page/shot-guide.ts`로 분리해 테스트, 신규 API `POST /api/ai/generate-shot-guide`가 Claude(sonnet)로 변환, PRO 페이지에 `shootguide` 화면·버튼을 배선.

**Tech Stack:** Next.js(커스텀), TypeScript, vitest, Claude via `src/lib/ai/claude-cli.ts`.

> ⚠️ **환경 주의:** studio 기본 `vitest.config.ts`는 이 환경에서 MSW/jsdom로 행(hang). 순수 로직 테스트는 프로젝트 루트에 임시 config로 돌린다(각 Task에 recipe 포함). UI(JSX)는 순수 함수 분리로 커버하고 나머지는 tsc + 수동 스모크로 검증.
> **브랜치:** 구현 시작 시 studio에서 이 Phase용 feature 브랜치를 판다(현재 `feat-scene-image-quality`). 각 커밋은 targeted-add로 이 작업 파일만.

> 참고 사실(확인됨): `callClaude(systemPrompt, userPrompt, model='sonnet', maxTokens=4096): Promise<string>` (`src/lib/ai/claude-cli.ts:97`). `ScreenState = 'upload'|'review'|'generating'|'result'` (`page.tsx:9`). AI 라우트 보일러플레이트는 `generate-pro-layout/route.ts:77-102` 참고(requireAuth→checkRateLimit→zod→`{success,...}`). PRO 페이지 상태: `productName`, `productPoints`(개행구분), `generatedSections`(각 섹션에 `title`, `imageSlots:[{slotType,promptHint,imageRef}]`).

---

## Task 1: 타입 + 순수 로직 (추출·직렬화·파싱) + 테스트

**Files:**
- Create: `src/types/shot-guide.ts`
- Create: `src/lib/detail-page/shot-guide.ts`
- Test: `src/lib/detail-page/shot-guide.test.ts`

- [ ] **Step 1: 실패 테스트 작성 — `src/lib/detail-page/shot-guide.test.ts`**
```ts
import { describe, it, expect } from 'vitest';
import { extractDetailCloseupShots, serializeShotChecklist, parseShotGuideResponse } from './shot-guide';
import type { ShotCard } from '@/types/shot-guide';

describe('extractDetailCloseupShots', () => {
  it('detail_closeup 슬롯만 뽑고 섹션 제목/힌트를 매핑한다', () => {
    const sections = [
      { title: '디테일', imageSlots: [
        { slotType: 'detail_closeup', promptHint: '지퍼 접사' },
        { slotType: 'flux_lifestyle', promptHint: '침대 위 연출' },
      ]},
      { title: '옵션', imageSlots: [{ slotType: 'product_nukki', promptHint: '단독컷' }] },
      { title: '디테일2', imageSlots: [{ slotType: 'detail_closeup', promptHint: '원단 텍스처' }] },
    ];
    const out = extractDetailCloseupShots(sections);
    expect(out).toEqual([
      { sectionTitle: '디테일', promptHint: '지퍼 접사' },
      { sectionTitle: '디테일2', promptHint: '원단 텍스처' },
    ]);
  });
  it('슬롯/섹션이 비어도 안전하다', () => {
    expect(extractDetailCloseupShots([])).toEqual([]);
    expect(extractDetailCloseupShots([{ title: 'x' } as any])).toEqual([]);
  });
});

describe('serializeShotChecklist', () => {
  it('카드 필드를 텍스트 체크리스트로 만든다', () => {
    const cards: ShotCard[] = [{ sectionTitle: '디테일', subject: '지퍼', angle: '정면 45도',
      framing: '매크로', lighting: '창가 자연광', background: '무지 화이트', tip: '손떨림 주의' }];
    const txt = serializeShotChecklist(cards);
    expect(txt).toContain('지퍼');
    expect(txt).toContain('구도·각도: 정면 45도');
    expect(txt).toContain('배경: 무지 화이트');
  });
  it('빈 배열이면 안내 문구', () => {
    expect(serializeShotChecklist([])).toContain('촬영할');
  });
});

describe('parseShotGuideResponse', () => {
  it('코드펜스/잡텍스트가 섞여도 첫 JSON 배열을 파싱한다', () => {
    const text = '```json\n[{"sectionTitle":"디테일","subject":"지퍼","angle":"a","framing":"매크로","lighting":"l","background":"b","tip":"t"}]\n```';
    const cards = parseShotGuideResponse(text);
    expect(cards).toHaveLength(1);
    expect(cards[0].subject).toBe('지퍼');
    expect(cards[0].framing).toBe('매크로');
  });
  it('파싱 불가/비배열이면 빈 배열', () => {
    expect(parseShotGuideResponse('없음')).toEqual([]);
    expect(parseShotGuideResponse('{"a":1}')).toEqual([]);
  });
});
```

- [ ] **Step 2: FAIL 확인 (node 임시 config)**
```bash
cat > vitest.scratch.config.ts <<'EOF'
import { defineConfig } from 'vitest/config';
import path from 'path';
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: { environment: 'node', setupFiles: [], pool: 'threads', globals: true,
    include: ['src/lib/detail-page/shot-guide.test.ts'] },
});
EOF
timeout 90 npx vitest run --config vitest.scratch.config.ts; echo "EXIT=$?"
rm -f vitest.scratch.config.ts
```
Expected: FAIL — cannot resolve `./shot-guide`.

- [ ] **Step 3: 타입 작성 — `src/types/shot-guide.ts`**
```ts
export interface ShotCard {
  sectionTitle: string;
  subject: string;
  angle: string;
  framing: string;
  lighting: string;
  background: string;
  tip: string;
}

export interface ShotGuideInput {
  sectionTitle: string;
  promptHint: string;
}
```

- [ ] **Step 4: 순수 로직 작성 — `src/lib/detail-page/shot-guide.ts`**
```ts
import type { ShotCard, ShotGuideInput } from '@/types/shot-guide';

type LooseSection = { title?: string; imageSlots?: Array<{ slotType?: string; promptHint?: string }> };

/** generatedSections에서 detail_closeup 슬롯만 추출. */
export function extractDetailCloseupShots(sections: LooseSection[]): ShotGuideInput[] {
  const out: ShotGuideInput[] = [];
  for (const s of sections ?? []) {
    for (const slot of s?.imageSlots ?? []) {
      if (slot?.slotType === 'detail_closeup') {
        out.push({ sectionTitle: s.title ?? '(제목 없음)', promptHint: slot.promptHint ?? '' });
      }
    }
  }
  return out;
}

/** ShotCard[] → 폰으로 보며 촬영할 텍스트 체크리스트. */
export function serializeShotChecklist(cards: ShotCard[]): string {
  if (!cards.length) return '촬영할 디테일 컷이 없습니다.';
  const lines: string[] = ['📸 상세페이지 촬영 가이드', ''];
  cards.forEach((c, i) => {
    lines.push(`## ${i + 1}. ${c.subject}  [${c.sectionTitle}]`);
    lines.push(`- [ ] 구도·각도: ${c.angle}`);
    lines.push(`- [ ] 프레이밍: ${c.framing}`);
    lines.push(`- [ ] 조명: ${c.lighting}`);
    lines.push(`- [ ] 배경: ${c.background}`);
    lines.push(`- 팁: ${c.tip}`);
    lines.push('');
  });
  return lines.join('\n');
}

/** Claude 응답 텍스트 → ShotCard[] (코드펜스 무관, 첫 '[' ~ 마지막 ']'). */
export function parseShotGuideResponse(text: string): ShotCard[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];
  let arr: unknown;
  try { arr = JSON.parse(text.slice(start, end + 1)); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map(x => ({
      sectionTitle: String(x.sectionTitle ?? ''),
      subject: String(x.subject ?? ''),
      angle: String(x.angle ?? ''),
      framing: String(x.framing ?? ''),
      lighting: String(x.lighting ?? ''),
      background: String(x.background ?? ''),
      tip: String(x.tip ?? ''),
    }));
}
```

- [ ] **Step 5: PASS 확인** (Step 2의 recipe 재사용, include 동일)
Expected: PASS (6 tests).

- [ ] **Step 6: 커밋 (targeted)**
```bash
git add src/types/shot-guide.ts src/lib/detail-page/shot-guide.ts src/lib/detail-page/shot-guide.test.ts
git commit -m "feat(shot-guide): ShotCard 타입 + 추출/직렬화/파싱 순수 로직"
```

---

## Task 2: API 라우트 `generate-shot-guide`

**Files:**
- Create: `src/app/api/ai/generate-shot-guide/route.ts`

- [ ] **Step 1: 라우트 작성**
```ts
/**
 * POST /api/ai/generate-shot-guide
 * detail_closeup 슬롯(promptHint)들을 사람용 폰 촬영 지시(ShotCard[])로 변환.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { callClaude } from '@/lib/ai/claude-cli';
import { parseShotGuideResponse } from '@/lib/detail-page/shot-guide';

export const maxDuration = 60;

const RATE_LIMIT = { windowMs: 60_000, maxRequests: 5 };

const RequestSchema = z.object({
  productInfo: z.object({
    name: z.string().min(1).max(200),
    points: z.array(z.string().transform(s => s.slice(0, 200))).default([]).transform(a => a.slice(0, 30)),
    category: z.string().max(100).default(''),
  }),
  shots: z.array(z.object({
    sectionTitle: z.string().max(200),
    promptHint: z.string().max(600).default(''),
  })).min(1).max(20),
});

const SYSTEM = `당신은 이커머스 상품 상세페이지용 "실사 촬영 가이드" 코치입니다.
입력으로 각 컷의 섹션 제목과 AI 연출 지시문(promptHint)이 주어집니다. 각 컷을, 판매자가 스마트폰으로 직접 찍을 수 있는 구체적 촬영 지시로 변환하세요.

각 컷마다 아래 JSON 객체를 정확히 하나 만드세요:
{ "sectionTitle": 입력의 섹션 제목 그대로, "subject": 무엇을 찍을지(제품의 어느 부위·특징), "angle": 구도·각도, "framing": 프레이밍(접사/매크로/풀샷 등), "lighting": 조명, "background": 배경, "tip": 실전 팁 한두 줄 }

규칙:
- 개인이 폰으로 재현 가능한 지시만(매크로/접사, 자연광, 깔끔한 무지/원목 배경 등). 스튜디오 장비·모델·복잡한 세팅 요구 금지.
- 상품명/포인트/promptHint에 없는 특징을 지어내지 마세요.
- 한국어, 구체적·실전적. "특별한 순간" 같은 추상 클리셰 금지.
- 입력 컷 개수와 순서를 그대로 1:1 유지.
- 출력은 JSON 배열만. 설명·코드펜스 없이: [ {...}, {...} ]`;

export async function POST(req: NextRequest): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown';
  const rl = checkRateLimit(getRateLimitKey(ip, 'generate-shot-guide'), RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: '요청 형식이 올바르지 않습니다.', _debug: parsed.error.issues[0]?.message },
      { status: 400 }
    );
  }

  const { productInfo, shots } = parsed.data;
  const userPrompt = [
    `상품명: ${productInfo.name}`,
    productInfo.category ? `카테고리: ${productInfo.category}` : '',
    productInfo.points.length ? `핵심 포인트:\n${productInfo.points.map(p => `- ${p}`).join('\n')}` : '',
    '',
    '변환할 컷 목록:',
    ...shots.map((s, i) => `${i + 1}. [섹션: ${s.sectionTitle}] 연출지시: ${s.promptHint}`),
  ].filter(Boolean).join('\n');

  try {
    const raw = await callClaude(SYSTEM, userPrompt, 'sonnet', 4096);
    const cards = parseShotGuideResponse(raw);
    if (cards.length === 0) {
      return NextResponse.json({ success: false, error: '가이드 생성에 실패했습니다. 다시 시도해주세요.' }, { status: 502 });
    }
    return NextResponse.json({ success: true, data: { shots: cards } });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: '가이드 생성 중 오류가 발생했습니다.', _debug: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: 타입체크 (touched 파일 한정)**
```bash
timeout 240 npx tsc --noEmit 2>&1 | grep -E "generate-shot-guide|shot-guide" || echo "no type errors in touched files"
```
Expected: `no type errors in touched files`.

- [ ] **Step 3: 커밋**
```bash
git add src/app/api/ai/generate-shot-guide/route.ts
git commit -m "feat(shot-guide): POST /api/ai/generate-shot-guide (Claude sonnet 변환)"
```

---

## Task 3: PRO 페이지 UI 배선 (`shootguide` 화면)

**Files:**
- Modify: `src/app/listing/[id]/detail-maker-pro/page.tsx`

먼저 파일을 읽고 아래 지점을 확인한다: `type ScreenState`(L9), 상태 선언부(L53~), `result` 화면 블록(`if (screen === 'result') {`), 그 안의 "에디터에서 편집" 버튼.

- [ ] **Step 1: import + ScreenState + 상태 추가**
(a) 상단 import에 추가:
```ts
import { extractDetailCloseupShots, serializeShotChecklist } from '@/lib/detail-page/shot-guide';
import type { ShotCard } from '@/types/shot-guide';
```
(b) `ScreenState`에 `'shootguide'` 추가:
```ts
type ScreenState = 'upload' | 'review' | 'generating' | 'result' | 'shootguide';
```
(c) 상태 선언부(다른 useState들 근처)에 추가:
```ts
const [shotGuide, setShotGuide] = useState<ShotCard[] | null>(null);
const [shotGuideLoading, setShotGuideLoading] = useState(false);
```

- [ ] **Step 2: 핸들러 + 유틸 추가** (다른 핸들러들 근처, 컴포넌트 함수 본문 내)
```ts
async function handleShotGuide() {
  const shots = extractDetailCloseupShots(generatedSections as unknown as { title?: string; imageSlots?: { slotType?: string; promptHint?: string }[] }[]);
  if (shots.length === 0) {
    alert('이 레이아웃엔 디테일 접사(detail_closeup) 컷이 없어요.');
    return;
  }
  setShotGuideLoading(true);
  try {
    const res = await fetch('/api/ai/generate-shot-guide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productInfo: {
          name: productName,
          points: productPoints.split('\n').map(s => s.trim()).filter(Boolean),
          category: '',
        },
        shots,
      }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || '가이드 생성 실패');
    setShotGuide(json.data.shots as ShotCard[]);
    setScreen('shootguide');
  } catch (e) {
    alert(e instanceof Error ? e.message : '가이드 생성 실패');
  } finally {
    setShotGuideLoading(false);
  }
}

function copyShotChecklist() {
  navigator.clipboard?.writeText(serializeShotChecklist(shotGuide ?? []));
}

function downloadShotChecklist() {
  const blob = new Blob([serializeShotChecklist(shotGuide ?? [])], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '촬영가이드.txt';
  a.click();
  URL.revokeObjectURL(url);
}
```
> 주의: `generatedSections`/`productName`/`productPoints`의 실제 이름을 파일에서 확인해 일치시킬 것(이 계획은 확인된 이름을 사용). 상품 카테고리 상태가 있으면 `category`에 전달.

- [ ] **Step 3: result 화면에 버튼 추가**
`result` 화면 블록에서 "에디터에서 편집" 버튼 **바로 옆/위**에 추가:
```tsx
<button
  type="button"
  onClick={handleShotGuide}
  disabled={shotGuideLoading}
  className="px-4 py-2 rounded-lg border border-gray-300 text-gray-800 disabled:opacity-50"
>
  {shotGuideLoading ? '가이드 생성 중…' : '📸 촬영 가이드 만들기'}
</button>
```
(className은 주변 버튼 스타일에 맞춰 조정 가능.)

- [ ] **Step 4: `shootguide` 화면 블록 추가**
`if (screen === 'result') { ... }` 블록 **바로 다음**에 추가:
```tsx
if (screen === 'shootguide') {
  const cards = shotGuide ?? [];
  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">📸 촬영 가이드</h1>
        <button type="button" onClick={() => setScreen('result')} className="text-sm text-gray-500">← 뒤로</button>
      </div>
      <p className="text-sm text-gray-600">아래 디테일 컷들을 폰으로 직접 찍어보세요. (라이프스타일 씬은 AI가 생성합니다.)</p>

      <div className="space-y-3">
        {cards.map((c, i) => (
          <div key={i} className="rounded-lg border border-gray-200 p-4">
            <div className="font-semibold mb-1">{i + 1}. {c.subject} <span className="text-xs text-gray-400">[{c.sectionTitle}]</span></div>
            <ul className="text-sm text-gray-700 space-y-0.5">
              <li>· 구도·각도: {c.angle}</li>
              <li>· 프레이밍: {c.framing}</li>
              <li>· 조명: {c.lighting}</li>
              <li>· 배경: {c.background}</li>
              <li className="text-gray-500">· 팁: {c.tip}</li>
            </ul>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 pt-2">
        <button type="button" onClick={copyShotChecklist} className="px-3 py-2 rounded-lg border border-gray-300 text-sm">체크리스트 복사</button>
        <button type="button" onClick={downloadShotChecklist} className="px-3 py-2 rounded-lg border border-gray-300 text-sm">다운로드 (.txt)</button>
      </div>
      <p className="text-xs text-gray-400">촬영·업로드·보정은 다음 단계에서 추가됩니다. 지금은 "에디터로 계속"으로 진행하세요.</p>
    </div>
  );
}
```
> "에디터로 계속" 버튼은 기존 result 화면의 "에디터에서 편집" 흐름을 그대로 쓰면 되므로 Phase 1에서는 `shootguide` 화면에 별도 배치하지 않고 뒤로가서 진행해도 된다. 원하면 기존 apply 핸들러를 호출하는 버튼을 여기에 추가(핸들러명은 파일에서 확인).

- [ ] **Step 5: 타입체크**
```bash
timeout 240 npx tsc --noEmit 2>&1 | grep -E "detail-maker-pro/page" || echo "no type errors in touched file"
```
Expected: `no type errors in touched file`.

- [ ] **Step 6: 커밋**
```bash
git add "src/app/listing/[id]/detail-maker-pro/page.tsx"
git commit -m "feat(shot-guide): PRO result에 촬영 가이드 버튼 + shootguide 화면"
```

---

## Task 4: 통합 검증

- [ ] **Step 1: 순수 로직 테스트 전체**
```bash
cat > vitest.scratch.config.ts <<'EOF'
import { defineConfig } from 'vitest/config';
import path from 'path';
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: { environment: 'node', setupFiles: [], pool: 'threads', globals: true,
    include: ['src/lib/detail-page/shot-guide.test.ts'] },
});
EOF
timeout 90 npx vitest run --config vitest.scratch.config.ts; echo "EXIT=$?"
rm -f vitest.scratch.config.ts
```
Expected: 6 passed, EXIT=0.

- [ ] **Step 2: 수동 스모크 (dev 서버)**
`npm run dev` → PRO 흐름으로 레이아웃 생성(`result`) → "📸 촬영 가이드 만들기" → `detail_closeup`이 있으면 카드가 뜨는지, 복사/다운로드 동작, 없으면 안내 alert. → "뒤로" 후 기존 "에디터에서 편집"이 여전히 정상인지.

---

## 참고
- Phase 1은 표시 전용. 업로드(Phase 3)·보정/삽입(Phase 4)·저장재개(Phase 2)는 별도 spec.
- `generate-pro-layout` 프롬프트/출력은 건드리지 않음(가이드는 별도 패스).
- 순수 로직(추출·직렬화·파싱)만 자동 테스트, 화면/네트워크는 tsc + 수동 스모크로 커버(studio vitest 기본설정 행 이슈 때문).
