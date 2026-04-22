/**
 * domeggook-tab-bulk.test.ts
 * DomeggookTab 소싱탭→대량등록 연결 기능 정적 분석
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SOURCE = fs.readFileSync(
  path.resolve(__dirname, '../../components/sourcing/DomeggookTab.tsx'),
  'utf-8',
);

describe('DomeggookTab — 대량등록 연결', () => {
  it('CHECKBOX_COL_W 상수가 정의되어 있다', () => {
    expect(SOURCE).toContain('CHECKBOX_COL_W');
  });

  it('useListingStore를 import한다', () => {
    expect(SOURCE).toContain("from '@/store/useListingStore'");
  });

  it('selectedIds 상태가 Set으로 선언된다', () => {
    expect(SOURCE).toContain('selectedIds');
    expect(SOURCE).toContain('new Set()');
  });

  it('bulkToast 상태가 선언된다', () => {
    expect(SOURCE).toContain('bulkToast');
  });

  it('handleBulkSend 함수가 정의되어 있다', () => {
    expect(SOURCE).toContain('handleBulkSend');
    expect(SOURCE).toContain('addPendingBulkItems');
  });

  it('체크박스 thead th가 추가되어 있다', () => {
    expect(SOURCE).toContain('type="checkbox"');
    expect(SOURCE).toContain('allCurrentSelected');
  });

  it('대량등록 버튼이 filterbar에 존재한다', () => {
    expect(SOURCE).toContain('대량등록');
    expect(SOURCE).toContain('selectedCount');
  });

  it('toast overlay가 존재한다', () => {
    expect(SOURCE).toContain('bulkToast.visible');
    expect(SOURCE).toContain('등록탭 바로가기');
  });

  it('# th의 sticky left가 CHECKBOX_COL_W를 사용한다', () => {
    expect(SOURCE).toContain('left: CHECKBOX_COL_W');
  });

  it('상품명 th/td의 sticky left가 CHECKBOX_COL_W + NUM_COL_W를 사용한다', () => {
    expect(SOURCE).toContain('CHECKBOX_COL_W + NUM_COL_W');
  });
});
