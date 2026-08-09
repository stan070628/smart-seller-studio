/**
 * ad-spend-paste-modal.test.tsx
 * AdSpendPasteModal — 쿠팡 광고 표 붙여넣기 → 미리보기 → 저장
 *
 * 커버 케이스:
 *   1. 표를 붙여넣으면 미리보기에 상품·광고비가 뜬다
 *   2. 미매칭 행은 경고와 함께 상품 연결 드롭다운을 낸다
 *   3. 저장 시 dry_run 없이 POST 하고 onSaved 를 부른다
 *   4. 여러 번 붙여넣으면 같은 상품이 합산된다
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import AdSpendPasteModal from '@/components/orders/AdSpendPasteModal';

const PASTED = [
  'ON/OFF\t상품명\t상태\t판매 방식\t키워드\t노출수\t클릭수\t클릭률\t광고 전환 판매수\t광고 전환 매출\t전환율\t집행 광고비\t광고수익률',
  'ON\t코스트코 커클랜드 다용도 극세사 타월 10장',
  'ID: 95373359497\t● 운영 중\t로켓그로스\t키워드 보기\t4,673 회\t47 회\t1.01 %\t3 회\t38,400원\t6.38 %\t5,016원\t765.55 %',
  'ON\t밀레 하이크업 트레킹화',
  'ID: 95841404577\t● 운영 중\t판매자배송\t키워드 보기\t521 회\t5 회\t0.96 %\t0 회\t0원\t0 %\t504원\t0 %',
].join('\n');

/** 95373359497만 매칭되고 95841404577은 연결 안 된 상태를 흉내낸다 */
function bulkHandler(onBody?: (body: Record<string, unknown>) => void) {
  return http.post('/api/cost-management/ad-spend/bulk', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    onBody?.(body);
    const items = (body.items ?? []) as { external_id: string; ad_spend: number }[];
    const matched = items
      .filter((i) => i.external_id === '95373359497')
      .map((i) => ({ external_id: i.external_id, product_id: 'p-1', product_name: '극세사 타월 10장', ad_spend: i.ad_spend }));
    const unmatched = items.filter((i) => i.external_id !== '95373359497');
    return HttpResponse.json({
      success: true,
      data: {
        ad_date: body.ad_date,
        dry_run: !!body.dry_run,
        matched,
        unmatched,
        saved_products: body.dry_run ? 0 : matched.length,
        matched_total: matched.reduce((s, m) => s + m.ad_spend, 0),
        unmatched_total: unmatched.reduce((s, m) => s + m.ad_spend, 0),
      },
    });
  });
}

function optionsHandler() {
  return http.get('/api/cost-management/products/options', () =>
    HttpResponse.json({ success: true, data: [{ id: 'p-9', product_name: '밀레 하이크업 트레킹화' }] }),
  );
}

/** textarea에 붙여넣기 이벤트를 흉내낸다 */
function pasteInto(el: HTMLElement, text: string) {
  fireEvent.paste(el, { clipboardData: { getData: () => text } });
}

describe('AdSpendPasteModal', () => {
  beforeEach(() => {
    server.use(optionsHandler());
  });

  it('표를 붙여넣으면 미리보기에 상품과 광고비가 뜬다', async () => {
    server.use(bulkHandler());
    render(<AdSpendPasteModal onClose={() => {}} onSaved={() => {}} />);

    pasteInto(screen.getByPlaceholderText(/Ctrl\+V/), PASTED);

    await waitFor(() => expect(screen.getByText('극세사 타월 10장')).toBeInTheDocument());
    // 행의 광고비와 하단 합계에 같은 금액이 나온다
    expect(screen.getAllByText('5,016원').length).toBeGreaterThan(0);
    expect(screen.getByText('504원')).toBeInTheDocument();
  });

  it('미매칭 행에 상품 연결 드롭다운을 낸다', async () => {
    server.use(bulkHandler());
    render(<AdSpendPasteModal onClose={() => {}} onSaved={() => {}} />);

    pasteInto(screen.getByPlaceholderText(/Ctrl\+V/), PASTED);

    await waitFor(() => expect(screen.getByText(/연결 안 됨/)).toBeInTheDocument());
    expect(screen.getByText(/원가관리 상품에 연결/)).toBeInTheDocument();
    // 판매자배송이므로 윙으로 읽혀야 한다
    expect(screen.getByText('윙')).toBeInTheDocument();
  });

  it('저장하면 dry_run 없이 POST하고 onSaved를 부른다', async () => {
    const bodies: Record<string, unknown>[] = [];
    const onSaved = vi.fn();
    server.use(bulkHandler((b) => bodies.push(b)));
    render(<AdSpendPasteModal onClose={() => {}} onSaved={onSaved} />);

    pasteInto(screen.getByPlaceholderText(/Ctrl\+V/), PASTED);
    await waitFor(() => expect(screen.getByRole('button', { name: /1개 상품 저장/ })).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: /1개 상품 저장/ }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const saveBody = bodies.find((b) => !b.dry_run);
    expect(saveBody).toBeDefined();
    expect(saveBody!.items).toHaveLength(2);
  });

  it('두 번 붙여넣으면 같은 상품 광고비를 합산한다', async () => {
    const bodies: Record<string, unknown>[] = [];
    server.use(bulkHandler((b) => bodies.push(b)));
    render(<AdSpendPasteModal onClose={() => {}} onSaved={() => {}} />);

    const area = screen.getByPlaceholderText(/Ctrl\+V/);
    pasteInto(area, PASTED);
    await waitFor(() => expect(screen.getByText('5,016원')).toBeInTheDocument());
    pasteInto(area, PASTED);

    await waitFor(() => expect(screen.getByText('10,032원')).toBeInTheDocument());
    expect(screen.getByText(/2번째 붙여넣기/)).toBeInTheDocument();
  });
});
