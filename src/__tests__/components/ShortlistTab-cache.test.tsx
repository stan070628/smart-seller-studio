/**
 * ShortlistTab-cache.test.tsx
 * 쇼트리스트가 캐시를 쓰는지 확인
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import ShortlistTab from '@/components/sourcing/ShortlistTab';
import { useCacheStore } from '@/store/useCacheStore';
import type { ShortlistItem } from '@/types/shortlist';

const mockFetch = vi.fn();

beforeEach(() => {
  useCacheStore.setState({ entries: {}, scroll: {} });
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ items: [] }),
  });
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('쇼트리스트 캐시', () => {
  it('마운트하면 캐시에 sourcing:shortlist 키가 생긴다', async () => {
    render(<ShortlistTab />);

    await waitFor(() =>
      expect(useCacheStore.getState().entries['sourcing:shortlist']).toBeDefined(),
    );
  });

  it('캐시가 있으면 두 번째 마운트에서 즉시 목록을 그린다', async () => {
    useCacheStore.getState().setEntry('sourcing:shortlist', {
      items: [
        {
          itemNo: 12345678,
          title: '테스트 상품',
          memo: null,
          addedAt: '2026-08-01T00:00:00.000Z',
          domeStatus: 'onsale',
          domePrice: 3300,
          domeInventory: 100,
          domeMoq: 1,
          deliIsFree: false,
          deliType: 'tiered',
          deliUnitQty: 30,
          deliFee: 3000,
          coupangP25: 9900,
          coupangSampleN: 91,
          orderQty: 10,
          unitDeliFee: 300,
          effectiveCost: 3600,
          logisticsSize: 'xsmall',
          breakEvenPrice: 8995,
          margin: 3506,
          marginRate: 35.4,
          verdict: 'pass',
          verifiedAt: '2026-08-01T00:00:00.000Z',
          buyKrwTotal: null,
          buyCnyTotal: null,
          orderQty1688: null,
          exchangeRate1688: null,
          intlShipPerUnit: null,
          pastedAt1688: null,
          isArchived: false,
        } satisfies ShortlistItem,
      ],
    });

    render(<ShortlistTab />);

    expect(screen.getByText('테스트 상품')).toBeInTheDocument();
  });
});
