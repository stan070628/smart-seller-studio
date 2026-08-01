/**
 * ShortlistTab-cache.test.tsx
 * 쇼트리스트가 캐시를 쓰는지 확인
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ShortlistTab from '@/components/sourcing/ShortlistTab';
import { useCacheStore } from '@/store/useCacheStore';
import type { ShortlistItem } from '@/types/shortlist';

/** 낙관적 갱신 테스트용 픽스처 팩토리. itemNo·title·logisticsSize만 바꿔가며 쓴다. */
function makeItem(overrides: Partial<ShortlistItem> & Pick<ShortlistItem, 'itemNo' | 'title'>): ShortlistItem {
  return {
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
    ...overrides,
  };
}

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

describe('낙관적 갱신 (patchItem → mutate)', () => {
  const itemA = makeItem({ itemNo: 111, title: '상품A', logisticsSize: 'xsmall' });
  const itemB = makeItem({ itemNo: 222, title: '상품B', logisticsSize: 'xsmall' });

  beforeEach(() => {
    useCacheStore.getState().setEntry('sourcing:shortlist', { items: [itemA, itemB] });
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ item: { ...itemA, logisticsSize: 'small' } }),
        });
      }
      // 마운트 시 배경 재검증(GET)이 한 번 뜨는 것은 정상이다 — 이 값을 돌려준다.
      return Promise.resolve({ ok: true, json: async () => ({ items: [itemA, itemB] }) });
    });
  });

  it('사이즈를 바꾸면 GET 없이 캐시의 해당 행만 바뀐다', async () => {
    const user = userEvent.setup();
    render(<ShortlistTab />);

    // 마운트 시의 배경 재검증(GET)이 끝나길 기다린 뒤 호출 기록을 지운다.
    // 이후 사이즈 변경에서 GET이 또 뜨지 않는지를 보려는 것이므로 마운트 몫은 셈에서 뺀다.
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    mockFetch.mockClear();

    await user.selectOptions(screen.getByLabelText('상품A 물류 사이즈'), 'small');

    await waitFor(() => {
      const entry = useCacheStore.getState().entries['sourcing:shortlist'];
      const items = (entry.data as { items: ShortlistItem[] }).items;
      expect(items[0].logisticsSize).toBe('small');
    });

    // PATCH 한 건만 나갔고 GET은 다시 뜨지 않았다
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe('/api/sourcing/shortlist/111');
    expect(calledInit.method).toBe('PATCH');

    // 나머지 행은 그대로다
    const entry = useCacheStore.getState().entries['sourcing:shortlist'];
    const items = (entry.data as { items: ShortlistItem[] }).items;
    expect(items[1].logisticsSize).toBe('xsmall');
  });

  it('로컬 수정은 마지막 갱신 시각을 바꾸지 않는다', async () => {
    const user = userEvent.setup();
    render(<ShortlistTab />);

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const fetchedAtBefore = useCacheStore.getState().entries['sourcing:shortlist'].fetchedAt;

    await user.selectOptions(screen.getByLabelText('상품A 물류 사이즈'), 'small');

    await waitFor(() => {
      const entry = useCacheStore.getState().entries['sourcing:shortlist'];
      const items = (entry.data as { items: ShortlistItem[] }).items;
      expect(items[0].logisticsSize).toBe('small');
    });

    // 서버 GET이 확인한 시각이 아니므로 로컬 수정으로는 바뀌면 안 된다
    expect(useCacheStore.getState().entries['sourcing:shortlist'].fetchedAt).toBe(fetchedAtBefore);
  });
});
