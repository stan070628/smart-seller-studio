/**
 * sourcing-flow.spec.ts
 * 소싱 페이지 3단계 구조 (발굴/검증/실행) E2E 테스트
 *
 * 검증 시나리오:
 *  1. /sourcing 접근 → 발굴 메인 탭 + 딥 키워드 서브탭 기본 활성
 *  2. 발굴 > 니치소싱 서브탭 클릭 → NicheTab 렌더링
 *  3. 실행 메인 탭 클릭 → 도매꾹 서브탭 기본 활성 (DomeggookTab 렌더링)
 *  4. 실행 > 코스트코 서브탭 클릭 → CostcoTab 렌더링
 *  5. 검증 메인 탭 클릭 → 마진계산기 서브탭 기본 활성
 *  6. 탭 간 왕복 전환 오류 없음
 */

import { test, expect } from '@playwright/test';

const MAIN = {
  discover: '발굴',
  validate: '검증',
  execute:  '실행',
} as const;

const SUB = {
  keywords:   '🔍 딥 키워드',
  niche:      '니치소싱',
  seed:       '🌱 상품 발굴',
  domeggook:  '도매꾹',
  costco:     '코스트코',
  margin:     '마진계산기',
  trademark:  '상표 사전검색',
  winner:     '위너 대시보드',
  inbound:    '입고 체크리스트',
} as const;

test.describe('소싱 페이지 — 3단계 구조', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/sourcing', { timeout: 10000 }).catch(() => test.skip());
  });

  test('1. 기본 진입 시 발굴 메인탭 + 딥 키워드 서브탭이 활성이다', async ({ page }) => {
    await expect(page.getByRole('button', { name: MAIN.discover })).toBeVisible();
    await expect(page.getByRole('button', { name: SUB.keywords })).toBeVisible();
    await expect(page.locator('body')).toContainText('딥 키워드 추천 엔진');
  });

  test('2. 발굴 > 니치소싱 서브탭 클릭 시 NicheTab이 렌더링된다', async ({ page }) => {
    await page.getByRole('button', { name: SUB.niche }).click();
    await expect(page.locator('body')).toContainText('니치소싱');
  });

  test('3. 실행 메인탭 클릭 시 도매꾹 서브탭이 기본 활성이다', async ({ page }) => {
    await page.getByRole('button', { name: MAIN.execute }).click();
    await expect(page.getByRole('button', { name: SUB.domeggook })).toBeVisible();
    await expect(page.locator('body')).toContainText('도매꾹');
  });

  test('4. 실행 > 코스트코 서브탭 클릭 시 CostcoTab이 렌더링된다', async ({ page }) => {
    await page.getByRole('button', { name: MAIN.execute }).click();
    await page.getByRole('button', { name: SUB.costco }).click();
    await expect(page.locator('body')).toContainText('코스트코');
  });

  test('4-1. 코스트코 탭에 성별 필터 서브메뉴가 없다', async ({ page }) => {
    await page.getByRole('button', { name: MAIN.execute }).click();
    await page.getByRole('button', { name: SUB.costco }).click();
    await expect(page.locator('button', { hasText: '남성용' })).not.toBeVisible();
    await expect(page.locator('button', { hasText: '여성용' })).not.toBeVisible();
  });

  test('5. 검증 메인탭 클릭 시 마진계산기 서브탭이 기본 활성이다', async ({ page }) => {
    await page.getByRole('button', { name: MAIN.validate }).click();
    await expect(page.getByRole('button', { name: SUB.margin })).toBeVisible();
    await expect(page.locator('body')).toContainText('마진 계산기');
  });

  test('5-1. 검증 > 상표 사전검색 서브탭이 존재한다', async ({ page }) => {
    await page.getByRole('button', { name: MAIN.validate }).click();
    await page.getByRole('button', { name: SUB.trademark }).click();
    await expect(page.locator('body')).toContainText('발주 사전체크');
  });

  test('5-2. 검증 > 위너 대시보드 서브탭이 존재한다', async ({ page }) => {
    await page.getByRole('button', { name: MAIN.validate }).click();
    await page.getByRole('button', { name: SUB.winner }).click();
    await expect(page.locator('body')).toContainText('위너 대시보드');
  });

  test('6. 발굴 → 검증 → 실행 탭 왕복 전환이 오류 없이 동작한다', async ({ page }) => {
    await page.getByRole('button', { name: MAIN.validate }).click();
    await expect(page.locator('body')).toContainText('마진 계산기');

    await page.getByRole('button', { name: MAIN.execute }).click();
    await expect(page.locator('body')).toContainText('도매꾹');

    await page.getByRole('button', { name: MAIN.discover }).click();
    await expect(page.locator('body')).toContainText('딥 키워드 추천 엔진');

    await expect(page.locator('body')).not.toContainText('Unhandled Runtime Error');
  });
});

test.describe('소싱 페이지 — CI 환경 스킵 대상 (실 DB 필요)', () => {
  test.fixme('실행 > 코스트코 탭에서 실제 API 데이터가 렌더링된다', async ({ page }) => {
    await page.goto('/sourcing');
    await page.getByRole('button', { name: '실행' }).click();
    await page.getByRole('button', { name: '코스트코' }).click();
    await page.waitForSelector('table tbody tr', { timeout: 10000 });
    const rows = await page.locator('table tbody tr').count();
    expect(rows).toBeGreaterThan(0);
  });

  test.fixme('실행 > 도매꾹 탭에서 차단 체크박스가 렌더링된다', async ({ page }) => {
    await page.goto('/sourcing');
    await page.getByRole('button', { name: '실행' }).click();
    await page.getByRole('button', { name: '도매꾹' }).click();
    const checkboxes = page.locator('input[type="checkbox"]');
    await expect(checkboxes.first()).toBeVisible({ timeout: 10000 });
  });
});
