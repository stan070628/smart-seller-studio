# Smart Seller Studio - 개발 현황

> 최종 업데이트: 2026-03-28

---

## 구현 완료 목록

### 프론트엔드

#### 페이지 (Next.js App Router)
- [x] `src/app/page.tsx` — 루트 랜딩 페이지
- [x] `src/app/layout.tsx` — 공통 레이아웃 (전역 폰트, 메타데이터)
- [x] `src/app/auth/login/page.tsx` — 로그인 페이지
- [x] `src/app/auth/signup/page.tsx` — 회원가입 페이지
- [x] `src/app/projects/page.tsx` — 프로젝트 목록 페이지
- [x] `src/app/editor/page.tsx` — 에디터 메인 페이지

#### 컴포넌트
- [x] `src/components/auth/AuthForm.tsx` — 로그인/회원가입 폼
- [x] `src/components/projects/ProjectCard.tsx` — 프로젝트 카드 UI
- [x] `src/components/projects/NewProjectButton.tsx` — 새 프로젝트 생성 버튼
- [x] `src/components/editor/Sidebar.tsx` — 에디터 사이드바 (이미지 업로드, 리뷰 입력, AI 카피 표시)
- [x] `src/components/editor/CanvasWorkspace.tsx` — Fabric.js 캔버스 작업공간
- [x] `src/components/editor/CanvasLoader.tsx` — 캔버스 동적 로딩 래퍼
- [x] `src/components/editor/CanvasToolbar.tsx` — 캔버스 도구모음
- [x] `src/components/editor/PropertiesPanel.tsx` — 선택 객체 속성 패널
- [x] `src/components/editor/PropertiesPanelLoader.tsx` — 속성 패널 동적 로딩 래퍼
- [x] `src/components/editor/ExportButton.tsx` — PNG 내보내기 버튼

#### 상태 관리 (Zustand)
- [x] `src/store/useEditorStore.ts` — 에디터 전역 상태 (이미지, 리뷰, 카피, 캔버스 객체, 로딩 상태)

#### 훅 / 미들웨어
- [x] `src/hooks/useAuth.ts` — 인증 상태 관리 훅
- [x] `src/middleware.ts` — Next.js 라우트 보호 미들웨어 (미인증 시 /login 리다이렉트)

#### 타입 정의
- [x] `src/types/project.ts` — Project 타입
- [x] `src/types/editor.ts` — 에디터 관련 타입

---

### 백엔드 (Next.js API Routes)

| 엔드포인트 | 메서드 | 파일 | 설명 |
|---|---|---|---|
| `/api/projects` | GET | `src/app/api/projects/route.ts` | 프로젝트 목록 조회 (페이지네이션) |
| `/api/projects` | POST | `src/app/api/projects/route.ts` | 프로젝트 생성 |
| `/api/projects/[id]` | GET | `src/app/api/projects/[id]/route.ts` | 단건 조회 |
| `/api/projects/[id]` | PATCH | `src/app/api/projects/[id]/route.ts` | 프로젝트 수정 (name, canvas_state, thumbnail_url) |
| `/api/projects/[id]` | DELETE | `src/app/api/projects/[id]/route.ts` | 프로젝트 삭제 |
| `/api/projects/[id]/canvas` | PATCH | `src/app/api/projects/[id]/canvas/route.ts` | 캔버스 자동저장 (5MB 제한) |
| `/api/storage/upload` | POST | `src/app/api/storage/upload/route.ts` | 이미지 업로드 (10MB, JPEG/PNG/WebP) |
| `/api/ai/generate-copy` | POST | `src/app/api/ai/generate-copy/route.ts` | AI 카피 생성 (Claude 3.5 Sonnet) |
| `/api/ai/analyze-image` | POST | `src/app/api/ai/analyze-image/route.ts` | 이미지 분석 (Gemini) |
| `/api/render` | POST | `src/app/api/render/route.ts` | 캔버스 렌더링 (Sharp PNG 변환) |

#### 라이브러리 / 유틸리티
- [x] `src/lib/rate-limit.ts` — 메모리 기반 Rate Limit (windowMs / maxRequests)
- [x] `src/lib/supabase/auth.ts` — Bearer 토큰 검증 (`verifyAuth`, `requireAuth`)
- [x] `src/lib/supabase/server.ts` — Supabase 서버 클라이언트, Storage 업로드
- [x] `src/lib/supabase/client.ts` — Supabase 브라우저 클라이언트
- [x] `src/lib/ai/claude.ts` — Claude API 래퍼 (`generateCopyFromReviews`)
- [x] `src/lib/ai/gemini.ts` — Gemini API 래퍼 (`analyzeImage`)
- [x] `src/lib/ai/schemas.ts` — AI 응답 Zod 스키마 (`parseCopyResponse`, `parseImageResponse`)
- [x] `src/lib/ai/prompts/copy-generation.ts` — 카피 생성 프롬프트
- [x] `src/lib/ai/prompts/image-analysis.ts` — 이미지 분석 프롬프트

---

### 테스트

#### Vitest 단위 테스트 — 12개 파일, 170개 테스트 (전부 통과)

| 파일 | 테스트 수 | 범주 |
|---|---|---|
| `src/__tests__/api/upload.test.ts` | 20 | API 단위 |
| `src/__tests__/api/projects.test.ts` | 24 | API 단위 |
| `src/__tests__/api/generate-copy.test.ts` | 15 | API 단위 |
| `src/__tests__/api/analyze-image.test.ts` | 12 | API 단위 |
| `src/__tests__/api/render.test.ts` | 10 | API 단위 |
| `src/__tests__/store/useEditorStore.test.ts` | 26 | 스토어 단위 |
| `src/__tests__/lib/schemas.test.ts` | 14 | 라이브러리 단위 |
| `src/__tests__/lib/rate-limit.test.ts` | 9 | 라이브러리 단위 |
| `src/__tests__/lib/supabase-auth.test.ts` | 9 | 라이브러리 단위 |
| `src/__tests__/security/security.test.ts` | 17 | 보안 테스트 |
| `src/__tests__/components/Sidebar.test.tsx` | 9 | 컴포넌트 단위 |
| `src/__tests__/integration/sidebar-api.test.tsx` | 5 | 통합 테스트 |

**단위/통합 테스트 총계: 170 passed / 170 total**

#### Playwright E2E 테스트 — 2개 파일, 16개 시나리오 (실행 환경 필요)

| 파일 | 시나리오 수 | 내용 |
|---|---|---|
| `e2e/happy-path.spec.ts` | 8 | 전체 유저 플로우 (로그인 → 에디터 → AI 카피 → 내보내기) |
| `e2e/canvas-interaction.spec.ts` | 8 | 캔버스 상호작용 (이미지 배치, 선택, 삭제) |

> E2E 실행을 위해서는 Supabase 테스트 계정과 Next.js 서버가 필요합니다.

---

## 환경 설정 필요 항목

### `.env.local` 설정 방법

프로젝트 루트에 `.env.local` 파일을 생성하고 아래 값을 채웁니다:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>

# AI APIs
ANTHROPIC_API_KEY=<claude-api-key>
GOOGLE_AI_API_KEY=<gemini-api-key>

# E2E 테스트 전용 계정 (Playwright)
E2E_TEST_EMAIL=test@example.com
E2E_TEST_PASSWORD=test-password
```

### Supabase 설정 방법

1. [Supabase 대시보드](https://supabase.com)에서 새 프로젝트를 생성합니다.
2. SQL 에디터에서 `projects` 테이블을 생성합니다:
   ```sql
   CREATE TABLE projects (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
     name TEXT NOT NULL DEFAULT '새 프로젝트',
     canvas_state JSONB,
     thumbnail_url TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );
   -- RLS 활성화
   ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
   -- 사용자 자신의 데이터만 접근 허용
   CREATE POLICY "Users can manage their own projects"
     ON projects FOR ALL USING (auth.uid() = user_id);
   -- updated_at 자동 갱신 트리거
   CREATE TRIGGER trg_projects_updated_at
     BEFORE UPDATE ON projects
     FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);
   ```
3. Storage 버킷 `smart-seller-studio`를 생성합니다 (Public 버킷).
4. Supabase Auth에서 이메일/비밀번호 로그인을 활성화합니다.

---

## 실행 방법

```bash
# 개발 서버 실행
npm run dev

# 단위/통합 테스트 실행 (Vitest)
npm run test

# 테스트 (watch 모드 종료, 결과만 출력)
npx vitest run --reporter=verbose

# 커버리지 리포트 생성
npm run test:coverage

# E2E 테스트 실행 (Playwright, 개발 서버 선행 필요)
npm run test:e2e

# E2E 테스트 UI 모드
npm run test:e2e:ui
```

---

## 다음 단계 (미구현 / 개선 권장)

### 기능 미구현
- [ ] 프로젝트 목록 페이지 — Supabase에서 실제 목록 fetch 연결 (현재 UI만 존재)
- [ ] 에디터 자동저장 — `canvas.on('object:modified')` 이벤트에서 `/api/projects/[id]/canvas` 호출 연결
- [ ] 이미지 업로드 → Supabase Storage 연결 — 현재 로컬 프리뷰만 동작, 실제 업로드 플로우 미연결
- [ ] 캔버스 thumbnail 생성 — 저장 시 `canvas.toDataURL()`로 썸네일 생성 후 `thumbnail_url` 업데이트
- [ ] 로그아웃 기능 — `supabase.auth.signOut()` 호출 UI 버튼 누락

### 보안 개선 권장
- [ ] `productName` 길이 제한 추가 — generate-copy API에서 현재 무제한 (200자 제한 권장)
- [ ] X-Forwarded-For 신뢰 범위 제한 — Rate Limit에서 프록시 헤더 스푸핑 방지를 위해 신뢰 IP 범위 설정 권장
- [ ] Supabase Rate Limit — Supabase Auth의 기본 요청 제한 확인 및 조정

### 인프라 / 운영
- [ ] Redis 기반 Rate Limit — 현재 메모리 Map 구현은 Vercel 서버리스 재시작 시 초기화됨
- [ ] 환경변수 유효성 검사 — 서버 시작 시 필수 환경변수 누락 여부 조기 확인
- [ ] E2E CI 파이프라인 — GitHub Actions에서 Playwright E2E 자동 실행 설정
- [ ] `.env.local.example` 파일 추가 — 온보딩 편의를 위한 환경변수 템플릿 생성
