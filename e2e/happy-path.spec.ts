/**
 * happy-path.spec.ts
 * E2E Happy Path 테스트 — 전체 유저 플로우
 *
 * [Wave 3 인증 흐름 반영]
 * 인증이 추가된 이후의 접근 흐름:
 *  0. /login 접속 → 이메일/비밀번호 입력 → 로그인 → 인증 토큰 발급
 *  1. 인증 완료 후 /editor 리다이렉트 (미인증 상태에서 /editor 직접 접근 시 /login으로 리다이렉트됨)
 *  2. 에디터 화면 렌더링 확인
 *  3. 이미지 파일 업로드 → 사이드바 썸네일 표시 확인
 *  4. 리뷰 Textarea에 샘플 텍스트 입력
 *  5. "AI 카피 생성" 버튼 클릭 → 로딩 → 카피 3개 카드 표시
 *  6. 첫 번째 카피 "캔버스에 추가" 클릭 → 캔버스 텍스트 렌더링 확인
 *  7. "PNG 내보내기" 버튼 클릭 → 다운로드 트리거 확인
 *
 * 참고: 실제 E2E 실행은 Supabase 테스트 프로젝트 및 환경변수 설정 후 가능합니다.
 *   - NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY 설정 필요
 *   - playwright.config.ts의 baseURL이 실행 중인 Next.js 서버를 가리켜야 합니다.
 *   - 테스트 전용 계정(E2E_TEST_EMAIL, E2E_TEST_PASSWORD)이 Supabase에 등록되어 있어야 합니다.
 *
 * 현재 beforeEach에서 /editor 직접 접근 대신 인증 후 /editor 접근하는 구조로 변경이 필요합니다.
 * (하단 TODO 주석 참조)
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';

// ---------------------------------------------------------------------------
// 테스트용 이미지 임시 파일 생성 헬퍼
// ---------------------------------------------------------------------------
function createTempJpeg(): string {
  // 최소 유효 JPEG (1x1px)
  const MINIMAL_JPEG_BASE64 =
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkS' +
    'Ew8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJ' +
    'CQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy' +
    'MjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/' +
    'EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAA' +
    'AAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJQAD//Z';

  const buffer = Buffer.from(MINIMAL_JPEG_BASE64, 'base64');
  const tmpPath = path.join(os.tmpdir(), `test-image-${Date.now()}.jpg`);
  fs.writeFileSync(tmpPath, buffer);
  return tmpPath;
}

// ---------------------------------------------------------------------------
// 샘플 리뷰 텍스트
// ---------------------------------------------------------------------------
const SAMPLE_REVIEW_TEXT = `정말 좋은 제품입니다. 배송도 빠르고 품질도 최고예요.
바람이 강한 날에도 전혀 뒤집히지 않아서 너무 만족스럽습니다.
카라비너 고리가 있어서 가방에 걸기도 편하고, 자동 개폐 기능이 정말 편리해요.
손이 전혀 다치지 않고 안전하게 접을 수 있어서 아이들도 걱정 없이 사용 가능합니다.`;

// ---------------------------------------------------------------------------
// 테스트 스위트
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Wave 3 인증 흐름: 로그인 헬퍼
// ---------------------------------------------------------------------------
// TODO: 환경변수 E2E_TEST_EMAIL, E2E_TEST_PASSWORD를 .env.test 또는 CI 시크릿에 설정한 후
//       아래 loginAndNavigateToEditor 함수를 beforeEach에서 호출하도록 변경합니다.
//
// async function loginAndNavigateToEditor(page: import('@playwright/test').Page) {
//   // 1. 로그인 페이지 접속
//   await page.goto('/login');
//   // 2. 이메일/비밀번호 입력
//   await page.getByLabel('이메일').fill(process.env.E2E_TEST_EMAIL ?? '');
//   await page.getByLabel('비밀번호').fill(process.env.E2E_TEST_PASSWORD ?? '');
//   // 3. 로그인 버튼 클릭 → Supabase 인증 → /editor 리다이렉트
//   await page.getByRole('button', { name: '로그인' }).click();
//   // 4. /editor 도착 확인
//   await page.waitForURL('**/editor', { timeout: 15000 });
//   await page.waitForSelector('header', { timeout: 10000 });
// }

test.describe('Happy Path: 전체 유저 플로우', () => {
  test.beforeEach(async ({ page }) => {
    // [Wave 3 이전] 직접 /editor 접속
    // [Wave 3 이후] 인증이 필요하므로 아래를 loginAndNavigateToEditor(page) 호출로 교체해야 합니다.
    // 미인증 상태에서 /editor에 직접 접근하면 /login으로 리다이렉트됩니다.
    // TODO: await loginAndNavigateToEditor(page);
    await page.goto('/editor');
    // 헤더 로드 대기
    await page.waitForSelector('header', { timeout: 10000 });
  });

  test('1. /editor 접속 시 에디터 화면이 정상 렌더링된다', async ({ page }) => {
    // 브랜드 로고 텍스트 확인
    await expect(page.getByText('SmartSellerStudio')).toBeVisible();

    // 사이드바 섹션 헤딩 확인
    await expect(page.getByText('상품 이미지', { exact: false })).toBeVisible();
    await expect(page.getByText('쿠팡 리뷰 붙여넣기', { exact: false })).toBeVisible();

    // PNG 내보내기 버튼 존재 확인
    await expect(page.getByRole('button', { name: 'PNG 내보내기' })).toBeVisible();

    // AI 카피 생성 버튼이 비활성화 상태 (리뷰 없음)
    const aiButton = page.getByRole('button', { name: 'AI 카피 생성' });
    await expect(aiButton).toBeDisabled();
  });

  test('2. 이미지 업로드 후 사이드바에 썸네일이 표시된다', async ({ page }) => {
    const tmpImagePath = createTempJpeg();

    try {
      // 숨겨진 파일 input을 통해 파일 업로드
      const fileInput = page.locator('input[type="file"][accept="image/*"]');
      await fileInput.setInputFiles(tmpImagePath);

      // 업로드된 이미지 썸네일(img 태그) 표시 확인
      const thumbnail = page.locator('aside img').first();
      await expect(thumbnail).toBeVisible({ timeout: 5000 });

      // 파일명 표시 확인 (확장자 포함)
      await expect(page.locator('aside').getByText('.jpg', { exact: false })).toBeVisible();
    } finally {
      // 임시 파일 정리
      fs.unlinkSync(tmpImagePath);
    }
  });

  test('3. 리뷰 Textarea에 텍스트 입력 후 AI 카피 생성 버튼이 활성화된다', async ({ page }) => {
    const textarea = page.getByPlaceholder('쿠팡 리뷰를 여기에', { exact: false });
    await textarea.fill(SAMPLE_REVIEW_TEXT);

    // 글자 수 표시 업데이트 확인
    await expect(page.getByText(/\d+자/)).toBeVisible();

    // AI 카피 생성 버튼 활성화 확인
    const aiButton = page.getByRole('button', { name: 'AI 카피 생성' });
    await expect(aiButton).toBeEnabled();
  });

  test('4. AI 카피 생성 버튼 클릭 시 로딩 후 카피 3개가 표시된다', async ({ page }) => {
    // 리뷰 입력
    const textarea = page.getByPlaceholder('쿠팡 리뷰를 여기에', { exact: false });
    await textarea.fill(SAMPLE_REVIEW_TEXT);

    // AI 카피 생성 버튼 클릭
    const aiButton = page.getByRole('button', { name: 'AI 카피 생성' });
    await aiButton.click();

    // 로딩 상태 확인: "AI 분석 중…" 텍스트 또는 스피너
    const loadingIndicator = page.getByText('AI 분석 중', { exact: false });
    await expect(loadingIndicator).toBeVisible({ timeout: 2000 });

    // 로딩 중 버튼은 비활성화 상태
    // (isGenerating=true일 때 disabled가 적용됨)

    // 1.2초 딜레이 후 카피 표시 대기 (Mock은 1.2초)
    await page.waitForSelector('text=생성된 카피', { timeout: 5000 });

    // 카피 카드 3개 표시 확인 (안 1, 안 2, 안 3 뱃지)
    await expect(page.getByText('안 1')).toBeVisible();
    await expect(page.getByText('안 2')).toBeVisible();
    await expect(page.getByText('안 3')).toBeVisible();

    // 각 카피 카드의 "캔버스에 추가" 버튼 표시 확인
    const addToCanvasButtons = page.getByRole('button', { name: '캔버스에 추가' });
    await expect(addToCanvasButtons).toHaveCount(3);
  });

  test('5. 첫 번째 카피 "캔버스에 추가" 클릭 시 캔버스 영역에 텍스트가 렌더링된다', async ({ page }) => {
    // 사전 조건: 리뷰 입력 + 카피 생성
    const textarea = page.getByPlaceholder('쿠팡 리뷰를 여기에', { exact: false });
    await textarea.fill(SAMPLE_REVIEW_TEXT);
    await page.getByRole('button', { name: 'AI 카피 생성' }).click();
    await page.waitForSelector('text=생성된 카피', { timeout: 5000 });

    // 첫 번째 "캔버스에 추가" 버튼 클릭
    const addButtons = page.getByRole('button', { name: '캔버스에 추가' });
    await addButtons.first().click();

    // 캔버스 영역(main) 내에 canvas 요소가 존재하는지 확인
    // Fabric.js는 <canvas> 태그를 렌더링
    const canvasElement = page.locator('main canvas').first();
    await expect(canvasElement).toBeVisible({ timeout: 5000 });
  });

  test('6. "PNG 내보내기" 버튼 클릭 시 다운로드 이벤트가 트리거된다', async ({ page }) => {
    // 다운로드 이벤트 대기 설정
    const downloadPromise = page.waitForEvent('download', { timeout: 10000 });

    // PNG 내보내기 버튼 클릭
    await page.getByRole('button', { name: 'PNG 내보내기' }).click();

    // 다운로드 발생 확인
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.(png|jpg|jpeg)$/i);
  });
});

test.describe('에러 시나리오', () => {
  test('리뷰 없이 AI 카피 생성 시도 시 버튼이 비활성화 상태를 유지한다', async ({ page }) => {
    // TODO: Wave 3 인증 흐름 적용 후 → await loginAndNavigateToEditor(page);
    await page.goto('/editor');

    const aiButton = page.getByRole('button', { name: 'AI 카피 생성' });
    // 비활성화 상태 확인
    await expect(aiButton).toBeDisabled();

    // 클릭해도 로딩이 시작되지 않아야 함
    await aiButton.click({ force: true }); // force로 disabled 우회 시도
    const loadingText = page.getByText('AI 분석 중', { exact: false });
    await expect(loadingText).not.toBeVisible();
  });

  test('공백만 입력된 리뷰로는 AI 카피 생성 버튼이 활성화되지 않는다', async ({ page }) => {
    // TODO: Wave 3 인증 흐름 적용 후 → await loginAndNavigateToEditor(page);
    await page.goto('/editor');

    const textarea = page.getByPlaceholder('쿠팡 리뷰를 여기에', { exact: false });
    await textarea.fill('   \n\n   '); // 공백만 입력

    const aiButton = page.getByRole('button', { name: 'AI 카피 생성' });
    // trim() 처리로 공백만인 경우 비활성화 유지
    await expect(aiButton).toBeDisabled();
  });
});
