import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LegalIssue } from '../legal/types';

// checkTrademark mock
vi.mock('../legal/kipris', async () => {
  const actual = await vi.importActual<typeof import('../legal/kipris')>('../legal/kipris');
  return {
    ...actual,
    checkTrademark: vi.fn(),
  };
});

import { checkTrademark } from '../legal/kipris';
import { precheckTrademark } from '../legal/precheck';

const mockedCheckTrademark = vi.mocked(checkTrademark);

describe('precheckTrademark — 1688 발주 사전체크 RED 격상', () => {
  beforeEach(() => {
    mockedCheckTrademark.mockReset();
  });

  it('등록상표 발견 (TRADEMARK_CAUTION YELLOW) → RED 격상', async () => {
    mockedCheckTrademark.mockResolvedValue({
      layer: 'trademark',
      severity: 'YELLOW',
      code: 'TRADEMARK_CAUTION',
      message: "등록상표 발견: 'XYZ' (출원번호: 12345)",
      detail: { word: 'XYZ', applicationNumber: '12345' },
    } satisfies LegalIssue);

    const result = await precheckTrademark('XYZ 텀블러');

    expect(result.status).toBe('blocked');
    expect(result.issue?.severity).toBe('RED');
    expect(result.issue?.code).toBe('TRADEMARK_BLOCK');
    expect(result.canProceed).toBe(false);
  });

  it('출원 중 상표 (TRADEMARK_PENDING YELLOW) → YELLOW 유지', async () => {
    mockedCheckTrademark.mockResolvedValue({
      layer: 'trademark',
      severity: 'YELLOW',
      code: 'TRADEMARK_PENDING',
      message: "출원 중: 'XYZ'",
      detail: {},
    } satisfies LegalIssue);

    const result = await precheckTrademark('XYZ 텀블러');

    expect(result.status).toBe('warning');
    expect(result.issue?.severity).toBe('YELLOW');
    expect(result.canProceed).toBe(true);
  });

  it('상표 없음 → safe', async () => {
    mockedCheckTrademark.mockResolvedValue(null);

    const result = await precheckTrademark('일반 텀블러 500ml');

    expect(result.status).toBe('safe');
    expect(result.issue).toBeNull();
    expect(result.canProceed).toBe(true);
  });

  it('extractBrandCandidate가 null 반환 → safe (조사할 단어 없음)', async () => {
    mockedCheckTrademark.mockResolvedValue(null);
    const result = await precheckTrademark('세트 팩 매');
    expect(result.status).toBe('safe');
  });
});
