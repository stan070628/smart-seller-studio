/**
 * Strategy v2 신규 페이지 4종 Smoke Test
 *
 * 검증 대상 (전략 v2 spec 2026-04-27):
 *  - /sourcing/trademark-precheck    (P1 trademark-block-gate)
 *  - /sourcing/inbound-checklist     (P1 sourcing-checklist 입력)
 *  - /sourcing/inbound-checklist/print (P1 sourcing-checklist 인쇄)
 *  - /sourcing/margin-calculator     (P2 1688-margin-calculator)
 *
 * 외부 KIPRIS API와 DB는 page.route + sessionStorage로 stub.
 */

import { test, expect, type Page } from '@playwright/test';
import { SignJWT } from 'jose';

function attachConsoleErrorCollector(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

async function makeAuthToken(): Promise<string> {
  const secret = new TextEncoder().encode(
    process.env.JWT_SECRET ?? 'fallback-secret-change-me'
  );
  return new SignJWT({ userId: 'e2e-smoke', email: 'smoke@e2e.local' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secret);
}

test.describe('Strategy v2 — 4 page smoke test', () => {
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

  test('/sourcing/trademark-precheck — 폼 표시 + 모킹 API 호출 + 결과 카드', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);

    // API mock — KIPRIS DB 의존성 제거
    await page.route('**/api/sourcing/trademark-precheck', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          results: [
            {
              title: '일반 텀블러 500ml',
              status: 'safe',
              canProceed: true,
              brandCandidate: null,
              issue: null,
            },
            {
              title: 'XYZ 정품 운동화',
              status: 'blocked',
              canProceed: false,
              brandCandidate: 'XYZ',
              issue: {
                severity: 'RED',
                code: 'TRADEMARK_BLOCK',
                message: "[발주차단] 등록상표 충돌: 'XYZ'",
              },
            },
          ],
        }),
      });
    });

    await page.goto('/sourcing/trademark-precheck');

    await expect(page.getByRole('heading', { name: '1688 발주 사전체크' })).toBeVisible();
    await expect(page.getByRole('button', { name: '1688 발주 사전체크' })).toBeVisible();

    await page.locator('textarea').fill('일반 텀블러 500ml\nXYZ 정품 운동화');
    await page.getByRole('button', { name: '1688 발주 사전체크' }).click();

    await expect(page.getByText('총 2건 검사')).toBeVisible();
    await expect(page.getByText('발주 가능')).toBeVisible();
    await expect(page.getByText('발주 차단')).toBeVisible();
    await expect(page.getByRole('link', { name: /1688 검색/ }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: '1688 검색 차단' })).toBeDisabled();

    expect(errors, `console errors: ${errors.join('; ')}`).toEqual([]);
  });

  test('/sourcing/inbound-checklist — 입력 후 print 페이지 이동', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);

    await page.goto('/sourcing/inbound-checklist');

    await expect(page.getByRole('heading', { name: '1688 입고 체크리스트' })).toBeVisible();

    // SKU #1 입력
    await page.getByLabel('상품명 *').fill('테스트 텀블러 500ml');
    await page.getByLabel('1688 URL *').fill('https://detail.1688.com/offer/123.html');
    await page.getByLabel('단가 (위안) *').fill('12.5');
    await page.getByLabel('발주수량 *').fill('100');
    await page.getByLabel('최장변 (cm) *').fill('20');
    await page.getByLabel('무게 (kg) *').fill('0.4');

    await page.getByRole('button', { name: /체크리스트 생성/ }).click();

    await page.waitForURL('**/sourcing/inbound-checklist/print');

    await expect(page.getByRole('heading', { name: '테스트 텀블러 500ml' })).toBeVisible();
    await expect(page.getByText('포장 (회송 1편)')).toBeVisible();
    await expect(page.getByText('사이즈 (회송 2편)')).toBeVisible();
    await expect(page.getByText('바코드 (회송 3편)')).toBeVisible();
    await expect(page.getByRole('button', { name: /인쇄.*PDF 저장/ })).toBeVisible();

    expect(errors, `console errors: ${errors.join('; ')}`).toEqual([]);
  });

  test('/sourcing/inbound-checklist/print — sessionStorage 비어있을 때 안내', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);

    await page.goto('/sourcing/inbound-checklist/print');

    await expect(page.getByText('SKU 데이터가 없습니다')).toBeVisible();
    await expect(page.getByRole('link', { name: /입력 페이지로 이동/ })).toBeVisible();

    expect(errors, `console errors: ${errors.join('; ')}`).toEqual([]);
  });

  test('/sourcing/margin-calculator — 입력 + 계산 + 결과/비교 카드', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);

    await page.goto('/sourcing/margin-calculator');

    await expect(page.getByRole('heading', { name: '1688 사입 마진 계산기' })).toBeVisible();
    await expect(page.getByText('입력값을 채우고 계산을 실행하세요.')).toBeVisible();

    await page.getByLabel('1688 박스가 (위안)').fill('10');
    await page.getByLabel('판매가 (원)').fill('10000');
    await page.getByLabel('도매꾹 위탁 개당 마진 (원)').fill('1500');
    await page.getByLabel('월 판매량 (개)').fill('30');

    await page.getByRole('button', { name: '계산' }).click();

    // 결과 카드
    await expect(page.getByRole('heading', { name: '실 마진 결과' })).toBeVisible();
    await expect(page.getByText('환율 적용 원가')).toBeVisible();
    await expect(page.getByText('순이익')).toBeVisible();

    // 비교 카드 — wholesale + monthly 입력했으므로 표시 (heading만 좁혀서 매칭)
    await expect(
      page.getByRole('heading', { name: /사입.*권장|위탁 유지|전환 보류|데이터 부족/ })
    ).toBeVisible();

    expect(errors, `console errors: ${errors.join('; ')}`).toEqual([]);
  });
});
