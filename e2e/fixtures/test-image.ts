/**
 * test-image.ts
 * Playwright 테스트용 이미지 픽스처
 *
 * 최소 유효 JPEG 바이너리(1x1px)를 Buffer로 제공합니다.
 * 실제 이미지 파일 없이 파일 업로드 시나리오를 테스트할 때 사용합니다.
 */

import { test as base } from '@playwright/test';

// ---------------------------------------------------------------------------
// 1x1px JPEG 최소 유효 바이너리 (Base64 인코딩)
// 실제 JPEG SOI → JFIF 헤더 → 퀀트 테이블 → SOF0 → DHT → SOS → EOI 구조
// ---------------------------------------------------------------------------
const MINIMAL_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkS' +
  'Ew8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJ' +
  'CQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy' +
  'MjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/' +
  'EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAA' +
  'AAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJQAD//Z';

// ---------------------------------------------------------------------------
// 픽스처 타입 정의
// ---------------------------------------------------------------------------
export interface TestImageFixtures {
  /** 테스트용 1x1px JPEG Buffer */
  testJpegBuffer: Buffer;
  /** 테스트용 PNG Buffer (8바이트 PNG 시그니처 + 최소 IHDR) */
  testPngBuffer: Buffer;
}

// ---------------------------------------------------------------------------
// Playwright test.extend로 픽스처 등록
// ---------------------------------------------------------------------------
export const test = base.extend<TestImageFixtures>({
  testJpegBuffer: async ({}, use) => {
    const buffer = Buffer.from(MINIMAL_JPEG_BASE64, 'base64');
    await use(buffer);
  },

  testPngBuffer: async ({}, use) => {
    // 최소 유효 PNG: 시그니처(8) + IHDR(25) + IDAT(20) + IEND(12) = 65 bytes
    // 실제 1x1 투명 PNG 바이너리 (Base64)
    const MINIMAL_PNG_BASE64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const buffer = Buffer.from(MINIMAL_PNG_BASE64, 'base64');
    await use(buffer);
  },
});

export { expect } from '@playwright/test';
