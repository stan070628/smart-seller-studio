/**
 * e2e/info-shot-guide.spec.ts
 *
 * PRO 상세페이지의 "정보 사진 가이드"와 "라벨 판독"이 실제 화면에서 동작하는지 본다.
 *
 * 컴포넌트 테스트가 아니라 e2e가 필요한 이유: 두 기능 모두 PRO 업로드 화면에
 * 배선돼야 의미가 있는데, 컴포넌트 단위 테스트는 그 배선을 검증하지 못한다.
 * (2026-08-02 탭 캐시 브리지에서 같은 함정을 겪었다 — 로직은 맞고 배선이 빠졌는데
 * 테스트가 초록불이었다.)
 */
import { test, expect } from '@playwright/test';
import { SignJWT } from 'jose';

async function makeAuthToken(): Promise<string> {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? 'fallback-secret-change-me');
  return new SignJWT({ userId: 'e2e-info-shot', email: 'info-shot@e2e.local' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secret);
}

test.describe('PRO 정보 사진 가이드', () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies([{
      name: 'auth_token',
      value: await makeAuthToken(),
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    }]);
  });

  test('상품명을 입력하면 찍어야 할 사진이 나타나고 펼칠 수 있다', async ({ page }) => {
    await page.goto('/listing/e2e-info-shot/detail-maker-pro');

    const nameInput = page.getByPlaceholder('예: 덴프스 엔엠엔 NMN 250');
    await expect(nameInput).toBeVisible();

    // 상품명이 비어 있으면 가이드가 없어야 한다
    await expect(page.getByText(/먼저 찍어야 할 정보 사진/)).toHaveCount(0);

    await nameInput.fill('남성 반바지');

    // 의류로 판정되어 5장(필수 2)이 안내된다
    const header = page.getByText(/먼저 찍어야 할 정보 사진 5장/);
    await expect(header).toBeVisible();
    await expect(page.getByText(/필수 2/)).toBeVisible();

    // 접힌 상태로 시작한다
    await expect(page.getByText('케어라벨 (품질표시 라벨)')).toHaveCount(0);

    await header.click();

    // 무엇을·어디서·무엇을 얻는지가 함께 보여야 한다
    await expect(page.getByText('케어라벨 (품질표시 라벨)')).toBeVisible();
    await expect(page.getByText(/왼쪽 옆선 밑단/)).toBeVisible();
    await expect(page.getByText(/소재 혼용률/)).toBeVisible();
    await expect(page.getByText(/체크리스트 복사/)).toBeVisible();
  });

  test('상품명을 바꾸면 카테고리에 맞게 안내가 바뀐다', async ({ page }) => {
    await page.goto('/listing/e2e-info-shot/detail-maker-pro');
    const nameInput = page.getByPlaceholder('예: 덴프스 엔엠엔 NMN 250');

    await nameInput.fill('남성 반바지');
    await page.getByText(/먼저 찍어야 할 정보 사진/).click();
    await expect(page.getByText('케어라벨 (품질표시 라벨)')).toBeVisible();

    await nameInput.fill('유기농 견과류 간식');
    await expect(page.getByText('케어라벨 (품질표시 라벨)')).toHaveCount(0);
    await expect(page.getByText('유통기한 각인')).toBeVisible();
  });

  test('라벨 판독 UI가 함께 배선되어 있다', async ({ page }) => {
    await page.goto('/listing/e2e-info-shot/detail-maker-pro');

    await expect(page.getByText(/라벨 사진에서 정보 읽기/)).toBeVisible();
    // 사진이 없으면 읽기 버튼이 잠겨 있어야 한다
    await expect(page.getByRole('button', { name: '읽기' })).toBeDisabled();
    await expect(page.getByText(/라벨 사진 선택 \(0\/6\)/)).toBeVisible();
  });
});
