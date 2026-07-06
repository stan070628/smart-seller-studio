# 마진 계산기 독립 로컬 프로그램 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `tools/margin-calculator/dist/index.html` 단일 파일로 열 수 있는 1688 마진 계산기 앱 빌드

**Architecture:** 메인 프로젝트에서 계산 로직(margin-1688.ts, channel-policy.ts)과 UI(MarginCalc.tsx)를 복사해 `tools/margin-calculator/`에 독립 Vite + React 앱으로 구성한다. `vite-plugin-singlefile`이 빌드 시 JS/CSS를 HTML에 인라인하여 단일 파일 결과물을 생성한다.

**Tech Stack:** Vite 5, React 18, TypeScript 5, Tailwind CSS 3, vite-plugin-singlefile

---

## 파일 구조

| 경로 | 역할 | 작업 |
|------|------|------|
| `tools/margin-calculator/package.json` | 의존성 정의 | 신규 |
| `tools/margin-calculator/vite.config.ts` | Vite + singlefile 설정 | 신규 |
| `tools/margin-calculator/tsconfig.json` | TypeScript 설정 | 신규 |
| `tools/margin-calculator/postcss.config.js` | PostCSS + Tailwind | 신규 |
| `tools/margin-calculator/tailwind.config.ts` | Tailwind content 경로 | 신규 |
| `tools/margin-calculator/index.html` | HTML 진입점 | 신규 |
| `tools/margin-calculator/src/index.css` | Tailwind directives | 신규 |
| `tools/margin-calculator/src/main.tsx` | ReactDOM.createRoot | 신규 |
| `tools/margin-calculator/src/App.tsx` | 페이지 레이아웃 | 신규 |
| `tools/margin-calculator/src/lib/channel-policy.ts` | 채널 수수료 테이블 | 메인 프로젝트에서 복사 |
| `tools/margin-calculator/src/lib/margin-1688.ts` | 마진 계산 로직 | 복사 + import 경로 수정 |
| `tools/margin-calculator/src/components/MarginCalc.tsx` | 계산기 UI | 복사 + 경로·지시문 수정 |

---

## Task 1: 프로젝트 설정 파일 생성

**Files:**
- Create: `tools/margin-calculator/package.json`
- Create: `tools/margin-calculator/vite.config.ts`
- Create: `tools/margin-calculator/tsconfig.json`
- Create: `tools/margin-calculator/postcss.config.js`
- Create: `tools/margin-calculator/tailwind.config.ts`
- Create: `tools/margin-calculator/index.html`

- [ ] **Step 1: package.json 생성**

```json
{
  "name": "margin-calculator",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.1",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.1",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.47",
    "tailwindcss": "^3.4.14",
    "typescript": "^5.6.3",
    "vite": "^5.4.10",
    "vite-plugin-singlefile": "^2.0.2"
  }
}
```

- [ ] **Step 2: vite.config.ts 생성**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  plugins: [react(), viteSingleFile()],
})
```

- [ ] **Step 3: tsconfig.json 생성**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: postcss.config.ts 생성**

```ts
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

- [ ] **Step 5: tailwind.config.ts 생성**

```ts
import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config
```

- [ ] **Step 6: index.html 생성**

```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>1688 사입 마진 계산기</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: 의존성 설치**

```bash
cd tools/margin-calculator
npm install
```

Expected: `node_modules/` 생성, lock 파일 생성, 에러 없음

- [ ] **Step 8: 커밋**

```bash
git add tools/margin-calculator/package.json tools/margin-calculator/package-lock.json tools/margin-calculator/vite.config.ts tools/margin-calculator/tsconfig.json tools/margin-calculator/postcss.config.ts tools/margin-calculator/tailwind.config.ts tools/margin-calculator/index.html
git commit -m "feat(tools/margin-calculator): scaffold Vite + React + Tailwind project"
```

---

## Task 2: 진입점 소스 파일 작성

**Files:**
- Create: `tools/margin-calculator/src/index.css`
- Create: `tools/margin-calculator/src/main.tsx`
- Create: `tools/margin-calculator/src/App.tsx`

- [ ] **Step 1: src/index.css 생성**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 2: src/main.tsx 생성**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 3: src/App.tsx 생성 (임시 스모크 테스트용)**

```tsx
export default function App() {
  return <div className="p-4 text-lg font-bold">마진 계산기 로딩 확인</div>
}
```

- [ ] **Step 4: 개발 서버 기동 확인**

```bash
cd tools/margin-calculator
npm run dev
```

Expected: `http://localhost:5173` 에서 "마진 계산기 로딩 확인" 텍스트가 표시됨. TypeScript 에러 없음.

서버 확인 후 `Ctrl+C`로 종료.

- [ ] **Step 5: 커밋**

```bash
git add tools/margin-calculator/src/
git commit -m "feat(tools/margin-calculator): add entry point files"
```

---

## Task 3: 계산 로직 복사

**Files:**
- Create: `tools/margin-calculator/src/lib/channel-policy.ts`
- Create: `tools/margin-calculator/src/lib/margin-1688.ts`

- [ ] **Step 1: channel-policy.ts 복사**

`src/lib/sourcing/shared/channel-policy.ts` 전체 내용을 그대로 `tools/margin-calculator/src/lib/channel-policy.ts`로 복사. 수정 없음.

- [ ] **Step 2: margin-1688.ts 복사 + import 경로 수정**

`src/lib/sourcing/margin-1688.ts` 내용을 `tools/margin-calculator/src/lib/margin-1688.ts`로 복사하되, 첫 번째 import 경로 한 줄만 수정:

```ts
// 변경 전
import {
  CHANNEL_FEE,
  VAT_RATE,
  getCategoryFeeRate,
  type Channel,
} from './shared/channel-policy';

// 변경 후
import {
  CHANNEL_FEE,
  VAT_RATE,
  getCategoryFeeRate,
  type Channel,
} from './channel-policy';
```

나머지 코드는 수정 없음.

- [ ] **Step 3: TypeScript 타입 체크**

```bash
cd tools/margin-calculator
npx tsc --noEmit
```

Expected: 에러 없음 (margin-1688.ts, channel-policy.ts에서 타입 에러가 없어야 함)

- [ ] **Step 4: 커밋**

```bash
git add tools/margin-calculator/src/lib/
git commit -m "feat(tools/margin-calculator): add margin calculation logic"
```

---

## Task 4: MarginCalc 컴포넌트 복사

**Files:**
- Create: `tools/margin-calculator/src/components/MarginCalc.tsx`

- [ ] **Step 1: MarginCalc.tsx 복사 + 수정**

`src/components/sourcing/MarginCalc.tsx` 내용을 `tools/margin-calculator/src/components/MarginCalc.tsx`로 복사하되 다음 두 곳만 수정:

1. 첫 줄 `'use client';` 제거
2. import 경로 변경:

```ts
// 변경 전
import {
  DEFAULT_EXCHANGE_RATE_KRW_PER_RMB,
  DEFAULT_TARIFF_RATE,
  calc1688Margin,
  compareWholesaleVsBuy,
  type Margin1688Input,
  type Margin1688Result,
  type CompareResult,
  type Channel,
} from '@/lib/sourcing/margin-1688';

// 변경 후
import {
  DEFAULT_EXCHANGE_RATE_KRW_PER_RMB,
  DEFAULT_TARIFF_RATE,
  calc1688Margin,
  compareWholesaleVsBuy,
  type Margin1688Input,
  type Margin1688Result,
  type CompareResult,
  type Channel,
} from '../lib/margin-1688';
```

- [ ] **Step 2: TypeScript 타입 체크**

```bash
cd tools/margin-calculator
npx tsc --noEmit
```

Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add tools/margin-calculator/src/components/MarginCalc.tsx
git commit -m "feat(tools/margin-calculator): add MarginCalc UI component"
```

---

## Task 5: App.tsx 완성 및 최종 빌드

**Files:**
- Modify: `tools/margin-calculator/src/App.tsx`

- [ ] **Step 1: App.tsx를 실제 계산기로 교체**

```tsx
import MarginCalc from './components/MarginCalc'

export default function App() {
  return (
    <main className="container mx-auto px-4 py-8">
      <h1 className="mb-2 text-2xl font-bold">1688 사입 마진 계산기</h1>
      <p className="mb-6 text-sm text-gray-600">
        1688 박스 위안가에 환율·관세·국제배송·쿠팡 그로스 운영비까지 모두 반영한
        실 마진을 계산합니다. 도매꾹 위탁 마진과 비교하여 사입 전환 권장 여부를 판단합니다.
      </p>
      <MarginCalc />
    </main>
  )
}
```

- [ ] **Step 2: 개발 서버에서 동작 확인**

```bash
cd tools/margin-calculator
npm run dev
```

`http://localhost:5173` 에서 직접 확인:
- 입력 폼이 정상 렌더링되는가
- 박스가 (위안), 입수, 환율, 판매가 등 모든 필드가 보이는가
- 값 입력 후 "계산" 버튼 클릭 시 "실 마진 결과" 카드가 나타나는가
- 위탁 비교 입력 시 추천 카드가 나타나는가

확인 후 `Ctrl+C`로 종료.

- [ ] **Step 3: 프로덕션 빌드**

```bash
cd tools/margin-calculator
npm run build
```

Expected:
```
✓ built in Xs
dist/index.html   XXX kB
```

`dist/` 폴더 안에 `index.html` 파일 하나만 생성되어야 함.

- [ ] **Step 4: 빌드 결과물 브라우저에서 열기**

```bash
open tools/margin-calculator/dist/index.html
```

확인 항목:
- 계산기 UI가 정상 표시되는가
- 브라우저 개발자 도구 콘솔에 에러가 없는가
- 값 입력 후 계산이 정상 작동하는가
- 네트워크 탭에서 외부 리소스 요청이 없는가 (CDN 로드 없음)

- [ ] **Step 5: .gitignore에 dist 추가**

`tools/margin-calculator/` 디렉토리에 `.gitignore` 생성:

```
node_modules
dist
```

단, `dist/index.html`을 배포용으로 커밋하고 싶다면 이 파일을 생략해도 됨.

- [ ] **Step 6: 최종 커밋**

```bash
git add tools/margin-calculator/src/App.tsx tools/margin-calculator/.gitignore
git commit -m "feat(tools/margin-calculator): complete standalone margin calculator build"
```

---

## 완료 기준

- [ ] `tools/margin-calculator/dist/index.html` 파일 하나로 브라우저에서 열림
- [ ] 1688 박스가·환율·관세·배송비·판매가 입력 후 마진 계산 정상 작동
- [ ] 위탁 마진 비교 카드 정상 표시
- [ ] 외부 서버·CDN 없이 파일만으로 동작
