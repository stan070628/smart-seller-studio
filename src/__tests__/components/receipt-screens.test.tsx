import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import ReceiptList from '@/components/receipt/ReceiptList';
import ReceiptDetail from '@/components/receipt/ReceiptDetail';
import { server } from '../mocks/server';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

const DRAFT_ID = 'd-1';

/** 목록 카드 한 장 */
function card(over: Record<string, unknown> = {}) {
  return {
    id: DRAFT_ID,
    purchased_at: '2026-08-08',
    store_name: '양재점',
    receipt_total: 724310,
    image_count: 1,
    created_at: '2026-08-08T12:00:00Z',
    badge: { label: '검산 통과', tone: 'ok', busy: false },
    progress: { total: 3, confirmed: 1, ready: 1, blocked: 0, undecided: 1 },
    ...over,
  };
}

/** 상세 줄 하나 */
function line(over: Record<string, unknown> = {}) {
  return {
    id: 'l-1', line_no: 1, item_code: '713160', item_label: '라운드티',
    quantity: 1, amount: 32990, net_amount: 25990,
    is_discount: false, applies_to_line_no: null,
    decision: 'ingest', product_cost_id: 'p-1', entry_type: 'normal',
    items_per_box: null, subdivision_unit: null, cost_entry_id: null,
    ...over,
  };
}

function detail(over: Record<string, unknown> = {}) {
  return {
    id: DRAFT_ID, purchased_at: '2026-08-08', store_name: '양재점',
    receipt_total: 724310, total_item_count: 13,
    ocr_status: 'parsed', verify_status: 'matched', verify_detail: null,
    status: 'draft', image_urls: [],
    badge: { label: '검산 통과', tone: 'ok', busy: false },
    progress: { total: 1, confirmed: 0, ready: 1, blocked: 0, undecided: 0 },
    lines: [line()],
    ...over,
  };
}

beforeEach(() => {
  push.mockReset();
});

describe('ReceiptList', () => {
  it('초안이 없으면 안내를 보여준다', async () => {
    server.use(http.get('/api/receipts', () => HttpResponse.json({ success: true, data: [] })));
    render(<ReceiptList />);
    expect(await screen.findByText(/대기 중인 영수증이 없습니다/)).toBeInTheDocument();
  });

  it('카드에 날짜·매장·합계·배지를 그린다', async () => {
    server.use(http.get('/api/receipts', () => HttpResponse.json({ success: true, data: [card()] })));
    render(<ReceiptList />);

    expect(await screen.findByText('2026-08-08')).toBeInTheDocument();
    expect(screen.getByText(/양재점/)).toBeInTheDocument();
    expect(screen.getByText(/724,310원/)).toBeInTheDocument();
    expect(screen.getByText('검산 통과')).toBeInTheDocument();
  });

  it('진행률에서 확정 대기와 미정을 구분해 보여준다', async () => {
    server.use(http.get('/api/receipts', () => HttpResponse.json({ success: true, data: [card()] })));
    render(<ReceiptList />);

    expect(await screen.findByText(/확정 대기 1/)).toBeInTheDocument();
    expect(screen.getByText(/미정 1/)).toBeInTheDocument();
  });

  it('카드를 누르면 상세로 이동한다', async () => {
    server.use(http.get('/api/receipts', () => HttpResponse.json({ success: true, data: [card()] })));
    render(<ReceiptList />);

    fireEvent.click(await screen.findByText('2026-08-08'));
    expect(push).toHaveBeenCalledWith(`/m/receipt/${DRAFT_ID}`);
  });

  it('조회 실패는 화면에 드러낸다 — 조용히 빈 목록으로 두지 않는다', async () => {
    server.use(http.get('/api/receipts', () =>
      HttpResponse.json({ success: false, error: '조회할 수 없습니다' })));
    render(<ReceiptList />);

    expect(await screen.findByRole('alert')).toHaveTextContent('조회할 수 없습니다');
  });

  it('🔴 업로드는 files 필드로 보내고, 끝나면 목록을 다시 읽는다', async () => {
    // multipart 본문은 jsdom에서 request.text()/formData()로 역직렬화되지 않는다
    // (핸들러에는 도달하지만 읽기가 멎는다). 직렬화 **전**의 FormData를 잡는다 —
    // 서버가 formData.getAll('files')로 받으므로 필드명이 틀리면 업로드가 400으로 죽는다
    let uploaded = 0;
    let sent: FormData | null = null;
    const realFetch = global.fetch;
    const spy = vi.spyOn(global, 'fetch').mockImplementation((input, init) => {
      if (init?.method === 'POST' && init.body instanceof FormData) sent = init.body;
      return realFetch(input, init);
    });

    server.use(
      http.get('/api/receipts', () =>
        HttpResponse.json({ success: true, data: uploaded > 0 ? [card()] : [] })),
      http.post('/api/receipts', () => {
        uploaded++;
        return HttpResponse.json({ success: true, data: { id: DRAFT_ID } });
      }),
    );

    try {
      const { container } = render(<ReceiptList />);
      await screen.findByText(/대기 중인 영수증이 없습니다/);

      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(['x'], 'r.jpg', { type: 'image/jpeg' });
      fireEvent.change(input, { target: { files: [file] } });

      await waitFor(() => expect(uploaded).toBe(1), { timeout: 5000 });

      const files = (sent as FormData | null)?.getAll('files') ?? [];
      expect(files).toHaveLength(1);
      expect((files[0] as File).name).toBe('r.jpg');

      // 업로드 후 목록을 다시 읽어 새 초안이 나타난다
      expect(await screen.findByText('2026-08-08')).toBeInTheDocument();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('ReceiptDetail', () => {
  function mockDetail(data: Record<string, unknown>) {
    server.use(
      http.get(`/api/receipts/${DRAFT_ID}`, () => HttpResponse.json({ success: true, data })),
      http.get('/api/cost-management/products/options', () =>
        HttpResponse.json({ success: true, data: [
          { id: 'p-1', product_name: '커클랜드 타월', subdivision_unit: 10 },
        ] })),
    );
  }

  it('🔴 할인 반영 금액을 보여주고 할인 전 금액을 함께 밝힌다', async () => {
    mockDetail(detail());
    render(<ReceiptDetail draftId={DRAFT_ID} />);

    // 원가로 들어갈 값
    expect(await screen.findByText('25,990원')).toBeInTheDocument();
    // 할인 전 값은 참고로만
    expect(screen.getByText(/할인 전 32,990원/)).toBeInTheDocument();
  });

  it('할인 줄은 어느 줄에 붙는지 밝힌다', async () => {
    mockDetail(detail({
      lines: [line(), line({ id: 'l-2', line_no: 2, is_discount: true, amount: -7000,
                             applies_to_line_no: 1, decision: 'skip', product_cost_id: null })],
    }));
    render(<ReceiptDetail draftId={DRAFT_ID} />);

    expect(await screen.findByText(/1번 줄에 반영됨/)).toBeInTheDocument();
  });

  it('확정 가능한 줄이 있으면 확정 버튼이 뜬다', async () => {
    mockDetail(detail());
    render(<ReceiptDetail draftId={DRAFT_ID} />);
    expect(await screen.findByText('1건 입고 확정')).toBeInTheDocument();
  });

  it('확정할 줄이 없으면 버튼을 감춘다', async () => {
    mockDetail(detail({ progress: { total: 1, confirmed: 1, ready: 0, blocked: 0, undecided: 0 } }));
    render(<ReceiptDetail draftId={DRAFT_ID} />);
    await screen.findByText('라운드티');
    expect(screen.queryByText(/입고 확정/)).not.toBeInTheDocument();
  });

  it('확정하면 결과 건수를 보여준다', async () => {
    mockDetail(detail());
    server.use(http.post(`/api/receipts/${DRAFT_ID}/confirm`, () =>
      HttpResponse.json({ success: true, data: { created: [{ line_no: 1 }], skipped: [], failed: [] } })));

    render(<ReceiptDetail draftId={DRAFT_ID} />);
    fireEvent.click(await screen.findByText('1건 입고 확정'));

    expect(await screen.findByText('1건 입고 완료')).toBeInTheDocument();
  });

  it('🔴 일부 실패하면 어느 줄이 왜 실패했는지 보여준다', async () => {
    mockDetail(detail());
    server.use(http.post(`/api/receipts/${DRAFT_ID}/confirm`, () =>
      HttpResponse.json({ success: true, data: {
        created: [], skipped: [],
        failed: [{ line_no: 1, error: '팩을 완성하기에 수량이 부족합니다.' }],
      } })));

    render(<ReceiptDetail draftId={DRAFT_ID} />);
    fireEvent.click(await screen.findByText('1건 입고 확정'));

    expect(await screen.findByText(/1번 팩을 완성하기에 수량이 부족합니다/)).toBeInTheDocument();
  });

  it('확정된 줄은 잠기고 수정 버튼이 사라진다', async () => {
    mockDetail(detail({ lines: [line({ cost_entry_id: 'e-1' })] }));
    render(<ReceiptDetail draftId={DRAFT_ID} />);

    expect(await screen.findByText(/입고 완료 — 수정할 수 없습니다/)).toBeInTheDocument();
    expect(screen.queryByText('제외')).not.toBeInTheDocument();
  });

  it('결정을 바꾸면 PATCH를 보낸다', async () => {
    mockDetail(detail());
    let body: Record<string, unknown> | null = null;
    server.use(http.patch(`/api/receipts/${DRAFT_ID}/lines/1`, async ({ request }) => {
      body = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({ success: true, data: {} });
    }));

    render(<ReceiptDetail draftId={DRAFT_ID} />);
    fireEvent.click(await screen.findByText('제외'));

    await waitFor(() => expect(body).toEqual({ decision: 'skip' }));
  });

  it('소분을 고르면 박스당 개수와 소분 단위를 묻는다', async () => {
    mockDetail(detail({ lines: [line({ entry_type: 'subdivision', items_per_box: 36, subdivision_unit: 10 })] }));
    render(<ReceiptDetail draftId={DRAFT_ID} />);

    expect(await screen.findByText('박스당 개수')).toBeInTheDocument();
    expect(screen.getByText('소분 단위')).toBeInTheDocument();
  });

  it('검산이 깨지면 어느 검사가 얼마나 어긋났는지 보여준다', async () => {
    mockDetail(detail({
      verify_status: 'mismatch',
      verify_detail: {
        status: 'mismatch',
        totalSum: { status: 'fail', expected: 724310, actual: 720000, diff: 4310 },
        lineArithmetic: { status: 'fail', expected: null, actual: null, diff: null, badLineNos: [3, 7] },
        itemCount: { status: 'pass', expected: 13, actual: 13, diff: 0 },
      },
    }));
    render(<ReceiptDetail draftId={DRAFT_ID} />);

    expect(await screen.findByText(/품목 합계 — 차액 4,310원/)).toBeInTheDocument();
    expect(screen.getByText(/줄별 수량×단가 — 3, 7번 줄/)).toBeInTheDocument();
    // 통과한 검사는 표시하지 않는다
    expect(screen.queryByText(/총 상품수/)).not.toBeInTheDocument();
  });

  it('검산 불일치라도 확정을 막지는 않는다 — 판단은 사람이 한다', async () => {
    mockDetail(detail({
      verify_status: 'mismatch',
      verify_detail: { status: 'mismatch', totalSum: { status: 'fail', expected: 1, actual: 2, diff: 1 } },
    }));
    render(<ReceiptDetail draftId={DRAFT_ID} />);
    expect(await screen.findByText('1건 입고 확정')).toBeInTheDocument();
  });

  it('판독 실패는 재판독 버튼을 준다', async () => {
    mockDetail(detail({
      ocr_status: 'failed', lines: [],
      badge: { label: '판독 실패', tone: 'danger', busy: false },
      progress: { total: 0, confirmed: 0, ready: 0, blocked: 0, undecided: 0 },
    }));
    let retried = false;
    server.use(http.post(`/api/receipts/${DRAFT_ID}/retry`, () => {
      retried = true;
      return HttpResponse.json({ success: true });
    }));

    render(<ReceiptDetail draftId={DRAFT_ID} />);
    fireEvent.click(await screen.findByText('다시 판독'));
    await waitFor(() => expect(retried).toBe(true));
  });

  it('🔴 폐기는 두 번 눌러야 한다 — 한 번에 지워지지 않는다', async () => {
    mockDetail(detail());
    let deleted = 0;
    server.use(http.delete(`/api/receipts/${DRAFT_ID}`, () => {
      deleted++;
      return HttpResponse.json({ success: true });
    }));

    render(<ReceiptDetail draftId={DRAFT_ID} />);
    const btn = await screen.findByText('이 영수증 폐기');

    fireEvent.click(btn);
    expect(deleted).toBe(0);   // 첫 클릭은 확인만
    expect(await screen.findByText('한 번 더 누르면 폐기됩니다')).toBeInTheDocument();

    fireEvent.click(screen.getByText('한 번 더 누르면 폐기됩니다'));
    await waitFor(() => expect(deleted).toBe(1));
    expect(push).toHaveBeenCalledWith('/m/receipt');
  });

  it('폐기가 거절되면 사유를 보여주고 되돌린다', async () => {
    mockDetail(detail());
    server.use(http.delete(`/api/receipts/${DRAFT_ID}`, () =>
      HttpResponse.json({ success: false, error: '폐기할 수 있는 초안이 아닙니다.' }, { status: 409 })));

    render(<ReceiptDetail draftId={DRAFT_ID} />);
    fireEvent.click(await screen.findByText('이 영수증 폐기'));
    fireEvent.click(screen.getByText('한 번 더 누르면 폐기됩니다'));

    expect(await screen.findByText('폐기할 수 있는 초안이 아닙니다.')).toBeInTheDocument();
    expect(screen.getByText('이 영수증 폐기')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('완료된 초안에는 폐기 버튼이 없다', async () => {
    mockDetail(detail({ status: 'done', progress: { total: 1, confirmed: 1, ready: 0, blocked: 0, undecided: 0 } }));
    render(<ReceiptDetail draftId={DRAFT_ID} />);
    await screen.findByText('라운드티');
    expect(screen.queryByText('이 영수증 폐기')).not.toBeInTheDocument();
  });

  it('판독 중이면 자동 처리 안내를 보여준다', async () => {
    mockDetail(detail({
      ocr_status: 'pending', lines: [],
      badge: { label: '판독 대기', tone: 'neutral', busy: true },
      progress: { total: 0, confirmed: 0, ready: 0, blocked: 0, undecided: 0 },
    }));
    render(<ReceiptDetail draftId={DRAFT_ID} />);
    expect(await screen.findByText(/10분 주기로 자동 처리됩니다/)).toBeInTheDocument();
  });
});
