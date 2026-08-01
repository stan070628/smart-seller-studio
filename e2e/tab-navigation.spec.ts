/**
 * tab-navigation.spec.ts
 * 탭 이동 · 재시작 복원 · 닫기 · 밀어내기 전체 흐름
 */

import { test, expect } from '@playwright/test';
import { SignJWT } from 'jose';

/** 사이드바 링크. 탭 바에도 같은 이름이 있으므로 aside로 범위를 좁힌다 */
function sidebarLink(page: import('@playwright/test').Page, name: string) {
  return page.locator('aside').getByRole('link', { name });
}

/** 라벨 → 경로. 다음 클릭 전 라우팅 완료를 기다리는 데 쓴다 (아래 ROUTE_HREF 주석 참고) */
const ROUTE_HREF: Record<string, string> = {
  소싱: '/sourcing',
  상품등록: '/listing',
  '라벨 인쇄': '/label',
  '주문/매출': '/orders',
  플랜: '/plan',
  에디터: '/editor',
};

/**
 * src/proxy.ts가 auth_token 쿠키를 요구해 미인증 접근을 /login으로 리다이렉트한다.
 * e2e/strategy-v2-smoke.spec.ts와 같은 방식으로 유효한 JWT를 직접 쿠키에 심어 우회한다.
 * JWT_SECRET은 playwright.config.ts가 loadEnvConfig로 .env.local을 미리 읽어두므로
 * process.env에서 바로 얻는다 — 실행 중인 dev 서버(src/proxy.ts)와 같은 값이 보장된다.
 */
async function makeAuthToken(): Promise<string> {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? 'fallback-secret-change-me');
  return new SignJWT({ userId: 'e2e-tab-nav', email: 'tab-nav@e2e.local' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secret);
}

test.describe('탭 내비게이션', () => {
  test.beforeEach(async ({ context }) => {
    const token = await makeAuthToken();
    await context.addCookies([
      {
        name: 'auth_token',
        value: token,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
    ]);
  });

  test('화면을 오가면 탭이 쌓이고 클릭으로 돌아간다', async ({ page }) => {
    await page.goto('/sourcing');
    await expect(page.getByTestId('tab-bar')).toBeVisible();

    await sidebarLink(page, '주문/매출').click();
    await expect(page).toHaveURL(/\/orders/);

    const bar = page.getByTestId('tab-bar');
    await expect(bar.getByText('소싱')).toBeVisible();
    await expect(bar.getByText('주문/매출')).toBeVisible();

    await bar.getByText('소싱').click();
    await expect(page).toHaveURL(/\/sourcing/);
  });

  test('탭 하나만 있어도 탭 바가 보인다', async ({ page }) => {
    await page.goto('/dashboard');

    await expect(page.getByTestId('tab-bar')).toBeVisible();
    await expect(page.getByTestId('tab-bar').getByText('대시보드')).toBeVisible();
  });

  test('새로고침해도 탭이 복원된다', async ({ page }) => {
    await page.goto('/sourcing');
    await sidebarLink(page, '주문/매출').click();
    await expect(page).toHaveURL(/\/orders/);

    await page.reload();

    const bar = page.getByTestId('tab-bar');
    await expect(bar.getByText('소싱')).toBeVisible();
    await expect(bar.getByText('주문/매출')).toBeVisible();
  });

  test('탭을 닫으면 사라진다', async ({ page }) => {
    await page.goto('/sourcing');
    await sidebarLink(page, '주문/매출').click();

    await page.getByLabel('소싱 탭 닫기').click();

    await expect(page.getByTestId('tab-bar').getByText('소싱')).toHaveCount(0);
  });

  test('7번째 화면을 열면 가장 오래된 탭이 밀려난다', async ({ page }) => {
    await page.goto('/dashboard');
    // 클릭을 대기 없이 연속으로 쏘면 중간 라우트는 커밋 전에 React가 중단시켜
    // 그 화면의 TabSync effect가 아예 실행되지 않는다 — 결함이 아니라 옳은 동작이다.
    // 사용자가 실제로 본 적 없는 화면에 탭이 생기지 않아야 하기 때문이다.
    // (실측: waitForURL 없이 6연속 클릭하면 마지막 클릭이 가리킨 화면에는
    // 정확히 도착하지만 중간 화면 3개는 탭이 열리지 않았다.)
    // 이 테스트는 각 화면에 실제로 탭이 열리는지를 보는 것이므로, 클릭마다
    // URL 전환을 기다린다 — 이는 우회책이 아니라 올바른 테스트 작성법이다.
    for (const name of ['소싱', '상품등록', '라벨 인쇄', '주문/매출', '플랜', '에디터']) {
      await sidebarLink(page, name).click();
      await expect(page).toHaveURL(new RegExp(ROUTE_HREF[name].replace('/', '\\/')));
    }

    const bar = page.getByTestId('tab-bar');
    await expect(bar.getByText('대시보드')).toHaveCount(0);
    await expect(bar.getByText('에디터')).toBeVisible();
  });
});
