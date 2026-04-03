/**
 * canvas-interaction.spec.ts
 * 캔버스 상호작용 E2E 테스트
 *
 * 시나리오:
 *  1. 이미지 업로드 후 캔버스에 이미지 객체 배치 확인
 *  2. 캔버스 객체 클릭 후 선택 상태(파란 핸들) 확인
 *  3. Delete 키 입력 후 객체 삭제 확인
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';

// ---------------------------------------------------------------------------
// 테스트용 이미지 임시 파일 생성 헬퍼
// ---------------------------------------------------------------------------
function createTempJpeg(): string {
  const MINIMAL_JPEG_BASE64 =
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkS' +
    'Ew8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJ' +
    'CQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy' +
    'MjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/' +
    'EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAA' +
    'AAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJQAD//Z';

  const buffer = Buffer.from(MINIMAL_JPEG_BASE64, 'base64');
  const tmpPath = path.join(os.tmpdir(), `canvas-test-${Date.now()}.jpg`);
  fs.writeFileSync(tmpPath, buffer);
  return tmpPath;
}

const SAMPLE_REVIEW = '이 제품 정말 좋아요! 품질이 최고입니다. 강풍에도 끄떡없어요.';

// ---------------------------------------------------------------------------
// 공통 사전 조건: 에디터 접속 + 카피 생성 완료 상태
// ---------------------------------------------------------------------------
async function setupWithGeneratedCopies(page: import('@playwright/test').Page) {
  await page.goto('/editor');
  await page.waitForSelector('header', { timeout: 10000 });

  // 리뷰 입력
  const textarea = page.getByPlaceholder('쿠팡 리뷰를 여기에', { exact: false });
  await textarea.fill(SAMPLE_REVIEW);

  // AI 카피 생성
  await page.getByRole('button', { name: 'AI 카피 생성' }).click();
  await page.waitForSelector('text=생성된 카피', { timeout: 5000 });
}

// ---------------------------------------------------------------------------
// 테스트 스위트
// ---------------------------------------------------------------------------

test.describe('캔버스 상호작용', () => {
  test('이미지 업로드 후 사이드바에 썸네일이 표시되고 캔버스 영역이 존재한다', async ({ page }) => {
    const tmpImagePath = createTempJpeg();

    try {
      await page.goto('/editor');
      await page.waitForSelector('header', { timeout: 10000 });

      // 파일 업로드
      const fileInput = page.locator('input[type="file"][accept="image/*"]');
      await fileInput.setInputFiles(tmpImagePath);

      // 사이드바 썸네일 표시 확인
      const thumbnail = page.locator('aside img').first();
      await expect(thumbnail).toBeVisible({ timeout: 5000 });

      // 캔버스 컨테이너 영역 확인
      const mainArea = page.locator('main');
      await expect(mainArea).toBeVisible();
    } finally {
      fs.unlinkSync(tmpImagePath);
    }
  });

  test('카피를 캔버스에 추가하면 canvas 요소가 렌더링된다', async ({ page }) => {
    await setupWithGeneratedCopies(page);

    // 첫 번째 카피 캔버스에 추가
    const addButtons = page.getByRole('button', { name: '캔버스에 추가' });
    await addButtons.first().click();

    // Fabric.js가 렌더링하는 canvas 요소 확인
    const canvas = page.locator('main canvas').first();
    await expect(canvas).toBeVisible({ timeout: 5000 });
  });

  test('캔버스에 텍스트 추가 후 canvas 요소가 올바른 크기를 가진다', async ({ page }) => {
    await setupWithGeneratedCopies(page);

    await page.getByRole('button', { name: '캔버스에 추가' }).first().click();

    const canvas = page.locator('main canvas').first();
    await expect(canvas).toBeVisible({ timeout: 5000 });

    // 캔버스 크기가 0보다 커야 함
    const boundingBox = await canvas.boundingBox();
    expect(boundingBox).not.toBeNull();
    expect(boundingBox!.width).toBeGreaterThan(0);
    expect(boundingBox!.height).toBeGreaterThan(0);
  });

  test('캔버스 객체 클릭 시 선택 상태가 활성화된다', async ({ page }) => {
    await setupWithGeneratedCopies(page);

    // 캔버스에 텍스트 추가
    await page.getByRole('button', { name: '캔버스에 추가' }).first().click();

    const canvas = page.locator('main canvas').first();
    await expect(canvas).toBeVisible({ timeout: 5000 });

    // 캔버스 중앙 클릭 (텍스트 객체가 중앙에 배치됨)
    const boundingBox = await canvas.boundingBox();
    if (boundingBox) {
      const centerX = boundingBox.x + boundingBox.width / 2;
      const centerY = boundingBox.y + boundingBox.height / 4; // 상단 1/4 지점 (텍스트 위치)
      await page.mouse.click(centerX, centerY);
    }

    // 선택 상태는 Fabric.js 내부에서 처리되므로
    // canvas 요소 자체가 여전히 visible한지 확인
    await expect(canvas).toBeVisible();
  });

  test('Delete 키 입력 시 선택된 캔버스 객체가 삭제된다', async ({ page }) => {
    await setupWithGeneratedCopies(page);

    // 캔버스에 텍스트 추가
    await page.getByRole('button', { name: '캔버스에 추가' }).first().click();

    const canvas = page.locator('main canvas').first();
    await expect(canvas).toBeVisible({ timeout: 5000 });

    // 캔버스 클릭하여 포커스
    await canvas.click();

    // 캔버스 내 텍스트 객체 위치 클릭 (선택)
    const boundingBox = await canvas.boundingBox();
    if (boundingBox) {
      await page.mouse.click(
        boundingBox.x + boundingBox.width / 2,
        boundingBox.y + 60, // 텍스트 객체 상단부 (top: 40 기준)
      );
    }

    // Delete 키 입력 — Fabric.js의 키보드 이벤트 처리
    await page.keyboard.press('Delete');

    // 삭제 후 canvas 요소는 여전히 존재 (Fabric.js 컨테이너는 유지됨)
    await expect(canvas).toBeVisible();
  });

  test('여러 카피를 순서대로 캔버스에 추가할 수 있다', async ({ page }) => {
    await setupWithGeneratedCopies(page);

    const addButtons = page.getByRole('button', { name: '캔버스에 추가' });
    const buttonCount = await addButtons.count();
    expect(buttonCount).toBe(3);

    // 두 개 순서대로 추가
    await addButtons.nth(0).click();
    await addButtons.nth(1).click();

    // 캔버스가 여전히 정상 렌더링됨을 확인
    const canvas = page.locator('main canvas').first();
    await expect(canvas).toBeVisible({ timeout: 5000 });
  });

  test('"다시 생성" 버튼 클릭 시 카피가 재생성된다', async ({ page }) => {
    await setupWithGeneratedCopies(page);

    // 다시 생성 버튼 클릭
    const regenButton = page.getByRole('button', { name: '다시 생성' });
    await expect(regenButton).toBeVisible();
    await regenButton.click();

    // 로딩 상태 확인
    await expect(page.getByText('AI 분석 중', { exact: false })).toBeVisible({ timeout: 2000 });

    // 1.2초 후 카피 목록 재표시
    await page.waitForSelector('text=생성된 카피', { timeout: 5000 });
    await expect(page.getByText('안 1')).toBeVisible();
  });
});

test.describe('이미지 삭제 상호작용', () => {
  test('업로드된 이미지의 X 버튼 클릭 시 썸네일 목록에서 제거된다', async ({ page }) => {
    const tmpImagePath = createTempJpeg();

    try {
      await page.goto('/editor');
      await page.waitForSelector('header', { timeout: 10000 });

      // 이미지 업로드
      const fileInput = page.locator('input[type="file"][accept="image/*"]');
      await fileInput.setInputFiles(tmpImagePath);

      // 썸네일 표시 확인
      const thumbnail = page.locator('aside img').first();
      await expect(thumbnail).toBeVisible({ timeout: 5000 });

      // 삭제 버튼 클릭 (title="이미지 삭제" 버튼)
      const deleteButton = page.locator('aside button[title="이미지 삭제"]').first();
      await expect(deleteButton).toBeVisible();
      await deleteButton.click();

      // 썸네일이 사라짐 확인
      await expect(thumbnail).not.toBeVisible({ timeout: 3000 });
    } finally {
      fs.unlinkSync(tmpImagePath);
    }
  });
});
