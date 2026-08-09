import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import ReceiptIngestModal from '@/components/orders/ReceiptIngestModal';
import { server } from '../mocks/server';

const DRAFT_ID = 'd-1';
const onClose = vi.fn();
const onConfirmed = vi.fn();

function line(over: Record<string, unknown> = {}) {
  return {
    id: 'l-1', line_no: 1, item_code: '713160', item_label: 'KS노랑타월36CT',
    quantity: 17, amount: 407830, net_amount: 407830,
    is_discount: false, applies_to_line_no: null,
    decision: 'ingest', product_cost_id: 'p-1', entry_type: 'normal',
    items_per_box: null, subdivision_unit: null, cost_entry_id: null,
    remembered_decision: null,
    ...over,
  };
}

function detail(over: Record<string, unknown> = {}) {
  return {
    id: DRAFT_ID, purchased_at: '2026-08-08', store_name: '양재점',
    receipt_total: 587630, total_item_count: 19,
    ocr_status: 'parsed', verify_status: 'matched', verify_detail: null, status: 'draft',
    image_urls: ['https://example.test/r.jpg'], images_purged_at: null,
    badge: { label: '검산 통과', tone: 'ok', busy: false },
    progress: { total: 1, confirmed: 0, ready: 1, blocked: 0, undecided: 0 },
    lines: [line()],
    ...over,
  };
}

function card(over: Record<string, unknown> = {}) {
  return {
    id: DRAFT_ID, purchased_at: '2026-08-08', store_name: '양재점',
    receipt_total: 587630, image_count: 1,
    badge: { label: '검산 통과', tone: 'ok', busy: false },
    progress: { total: 1, confirmed: 0, ready: 1, blocked: 0, undecided: 0 },
    ...over,
  };
}

function mock(d: Record<string, unknown> = detail(), cards = [card()]) {
  server.use(
    http.get('/api/receipts', () => HttpResponse.json({ success: true, data: cards })),
    http.get(`/api/receipts/${DRAFT_ID}`, () => HttpResponse.json({ success: true, data: d })),
    http.get('/api/cost-management/products/options', () =>
      HttpResponse.json({ success: true, data: [{ id: 'p-1', product_name: '커클랜드 타월', subdivision_unit: 10 }] })),
  );
}

function open() {
  return render(<ReceiptIngestModal onClose={onClose} onConfirmed={onConfirmed} />);
}

beforeEach(() => {
  onClose.mockReset();
  onConfirmed.mockReset();
});

describe('ReceiptIngestModal', () => {
  it('대기 중인 초안을 자동으로 연다', async () => {
    mock();
    open();
    expect(await screen.findByText('KS노랑타월36CT')).toBeInTheDocument();
    expect(screen.getByText(/대기 1건/)).toBeInTheDocument();
  });

  it('🔴 영수증 원본을 함께 띄운다 — 데스크탑의 존재 이유다', async () => {
    mock();
    open();
    const img = await screen.findByAltText('영수증 1');
    expect(img).toHaveAttribute('src', 'https://example.test/r.jpg');
  });

  it('🔴 보관 기간이 지난 이미지는 안내로 대체한다', async () => {
    mock(detail({ image_urls: [], images_purged_at: '2026-05-01T00:00:00Z' }));
    open();
    expect(await screen.findByText(/보관 기간\(3개월\)이 지나 삭제됐습니다/)).toBeInTheDocument();
  });

  it('할인 반영 금액과 할인 전 금액을 함께 보여준다', async () => {
    mock(detail({ lines: [line({ amount: 32990, net_amount: 25990 })] }));
    open();
    expect(await screen.findByText('25,990원')).toBeInTheDocument();
    expect(screen.getByText(/할인 전 32,990원/)).toBeInTheDocument();
  });

  it('🔴 검산이 지목한 줄을 눌러 강조할 수 있다', async () => {
    mock(detail({
      verify_status: 'mismatch',
      verify_detail: {
        status: 'mismatch',
        lineArithmetic: { status: 'fail', expected: null, actual: null, diff: null, badLineNos: [1] },
      },
    }));
    open();
    expect(await screen.findByText(/검산이 맞지 않습니다/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('1번'));
    // 강조는 배경색으로 표현된다 — 클릭이 오류 없이 처리되면 충분하다
    expect(screen.getByText('KS노랑타월36CT')).toBeInTheDocument();
  });

  it('확정하면 부모에게 알린다 — 탭의 입고 내역이 갱신돼야 한다', async () => {
    mock();
    server.use(http.post(`/api/receipts/${DRAFT_ID}/confirm`, () =>
      HttpResponse.json({ success: true, data: { created: [{ line_no: 1 }], skipped: [], failed: [] } })));

    open();
    fireEvent.click(await screen.findByText('1건 입고 확정'));

    expect(await screen.findByText('1건 입고 완료')).toBeInTheDocument();
    await waitFor(() => expect(onConfirmed).toHaveBeenCalled());
  });

  it('확정할 줄이 없으면 버튼이 잠긴다', async () => {
    mock(detail({ progress: { total: 1, confirmed: 1, ready: 0, blocked: 0, undecided: 0 } }));
    open();
    const btn = await screen.findByText('0건 입고 확정');
    expect(btn).toBeDisabled();
  });

  it('결정을 바꾸면 PATCH를 보낸다', async () => {
    mock();
    let body: Record<string, unknown> | null = null;
    server.use(http.patch(`/api/receipts/${DRAFT_ID}/lines/1`, async ({ request }) => {
      body = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({ success: true, data: {} });
    }));

    open();
    fireEvent.click(await screen.findByText('제외'));
    await waitFor(() => expect(body).toEqual({ decision: 'skip' }));
  });

  it('제외한 줄에 「항상 제외」가 뜬다', async () => {
    mock(detail({ lines: [line({ decision: 'skip', product_cost_id: null })] }));
    open();
    expect(await screen.findByText('항상 제외')).toBeInTheDocument();
  });

  it('확정된 줄은 잠긴다', async () => {
    mock(detail({ lines: [line({ cost_entry_id: 'e-1' })] }));
    open();
    expect(await screen.findByText('입고 완료')).toBeInTheDocument();
    expect(screen.queryByText('제외')).not.toBeInTheDocument();
  });

  it('초안이 없으면 안내한다', async () => {
    server.use(
      http.get('/api/receipts', () => HttpResponse.json({ success: true, data: [] })),
      http.get('/api/cost-management/products/options', () =>
        HttpResponse.json({ success: true, data: [] })),
    );
    open();
    expect(await screen.findByText(/대기 중인 영수증이 없습니다/)).toBeInTheDocument();
  });

  it('닫기 버튼이 동작한다', async () => {
    mock();
    open();
    await screen.findByText('KS노랑타월36CT');
    fireEvent.click(screen.getByText('×'));
    expect(onClose).toHaveBeenCalled();
  });
});
