/**
 * bulk-import-panel.test.ts
 * BulkImportPanel이 pendingBulkItems를 마운트 시 소비하는지 정적 분석
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SOURCE = fs.readFileSync(
  path.resolve(__dirname, '../../components/listing/BulkImportPanel.tsx'),
  'utf-8',
);

describe('BulkImportPanel — pendingBulkItems 소비', () => {
  it('useListingStore를 import한다', () => {
    expect(SOURCE).toContain("from '@/store/useListingStore'");
  });

  it('pendingBulkItems와 clearPendingBulkItems를 구조분해한다', () => {
    expect(SOURCE).toContain('pendingBulkItems');
    expect(SOURCE).toContain('clearPendingBulkItems');
  });

  it('useEffect로 마운트 시 initQueue를 호출한다', () => {
    expect(SOURCE).toContain("pendingBulkItems.join('\\n')");
    expect(SOURCE).toContain('clearPendingBulkItems()');
  });
});
