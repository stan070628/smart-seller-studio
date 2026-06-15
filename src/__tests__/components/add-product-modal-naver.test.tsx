/**
 * add-product-modal-naver.test.tsx
 * AddProductModal — 네이버 탭 동작 검증
 *
 * MSW로 /api/listing/naver 와 /api/cost-management/products 를 모킹한다.
 *
 * 커버 케이스:
 *   1. 네이버 탭 클릭 → 로딩 → 상품 목록 렌더
 *   2. API 오류(success=false) → 오류 메시지 표시
 *   3. 네트워크 실패 → '네트워크 오류' 메시지 표시
 *   4. 상품 선택 전 '상품 추가' 버튼 비활성화
 *   5. 상품 선택 후 버튼 활성화 → POST body에 product_name 포함 / naver 전용 ID 미포함
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import AddProductModal from '@/components/orders/AddProductModal';

// window.alert 는 jsdom 에서 undefined → mock
global.alert = vi.fn();

const MOCK_NAVER_ITEMS = [
  { originProductNo: 1001, name: '테스트 네이버 상품 A' },
  { originProductNo: 1002, name: '테스트 네이버 상품 B' },
];

function naverSuccessHandler() {
  return http.get('/api/listing/naver', () =>
    HttpResponse.json({ success: true, data: { items: MOCK_NAVER_ITEMS } }),
  );
}

function naverErrorHandler() {
  return http.get('/api/listing/naver', () =>
    HttpResponse.json({ success: false, error: '네이버 API 오류' }),
  );
}

function naverNetworkErrorHandler() {
  return http.get('/api/listing/naver', () => HttpResponse.error());
}

function productsPostHandler(spy: ReturnType<typeof vi.fn>) {
  return http.post('/api/cost-management/products', async ({ request }) => {
    const body = await request.json();
    (spy as unknown as (arg: unknown) => void)(body);
    return HttpResponse.json({ success: true }, { status: 201 });
  });
}

describe('AddProductModal — 네이버 탭', () => {
  const onClose = vi.fn();
  const onAdded = vi.fn();

  beforeEach(() => {
    onClose.mockClear();
    onAdded.mockClear();
    (global.alert as unknown as ReturnType<typeof vi.fn>).mockClear();

    // 쿠팡 상품 목록(초기 로드) 기본 mock
    server.use(
      http.get('/api/cost-management/coupang-products', () =>
        HttpResponse.json({ success: true, data: [] }),
      ),
    );
  });

  // ── 1. 상품 목록 렌더 ──────────────────────────────────────────────────────
  it('네이버 탭 클릭 시 상품 목록을 로드해 렌더한다', async () => {
    server.use(naverSuccessHandler());
    render(<AddProductModal onClose={onClose} onAdded={onAdded} />);

    fireEvent.click(screen.getByRole('button', { name: '네이버 상품' }));

    expect(screen.getByText('네이버 상품 조회중...')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('테스트 네이버 상품 A')).toBeInTheDocument();
      expect(screen.getByText('테스트 네이버 상품 B')).toBeInTheDocument();
    });
  });

  // ── 2. API 오류 ────────────────────────────────────────────────────────────
  it('API가 success=false 를 반환하면 오류 메시지를 표시한다', async () => {
    server.use(naverErrorHandler());
    render(<AddProductModal onClose={onClose} onAdded={onAdded} />);

    fireEvent.click(screen.getByRole('button', { name: '네이버 상품' }));

    await waitFor(() => {
      expect(screen.getByText('네이버 상품 조회 실패')).toBeInTheDocument();
      expect(screen.getByText('네이버 API 오류')).toBeInTheDocument();
    });
  });

  // ── 3. 네트워크 실패 ────────────────────────────────────────────────────────
  it('네트워크 오류 시 "네트워크 오류" 메시지를 표시한다', async () => {
    server.use(naverNetworkErrorHandler());
    render(<AddProductModal onClose={onClose} onAdded={onAdded} />);

    fireEvent.click(screen.getByRole('button', { name: '네이버 상품' }));

    await waitFor(() => {
      expect(screen.getByText('네트워크 오류가 발생했습니다.')).toBeInTheDocument();
    });
  });

  // ── 4. 선택 전 버튼 비활성화 ───────────────────────────────────────────────
  it('상품을 선택하지 않으면 "상품 추가" 버튼이 비활성화 상태다', async () => {
    server.use(naverSuccessHandler());
    render(<AddProductModal onClose={onClose} onAdded={onAdded} />);

    fireEvent.click(screen.getByRole('button', { name: '네이버 상품' }));

    await waitFor(() => {
      expect(screen.getByText('테스트 네이버 상품 A')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: '상품 추가' })).toBeDisabled();
  });

  // ── 5. 선택 후 POST body 검증 ──────────────────────────────────────────────
  it('상품 선택 후 추가 시 product_name 을 포함하고 naver_product_no 는 포함하지 않는다', async () => {
    const postSpy = vi.fn();
    server.use(naverSuccessHandler(), productsPostHandler(postSpy));

    render(<AddProductModal onClose={onClose} onAdded={onAdded} />);
    fireEvent.click(screen.getByRole('button', { name: '네이버 상품' }));

    await waitFor(() => {
      expect(screen.getByText('테스트 네이버 상품 A')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('테스트 네이버 상품 A'));
    expect(screen.getByRole('button', { name: '상품 추가' })).not.toBeDisabled();

    // 수수료율 입력 (네이버 탭은 기본값 비워짐 → 입력 필요)
    // spinbutton 역할의 input이 두 개(수수료율, 소분갯수) — 첫 번째가 수수료율
    const [feeInput] = screen.getAllByRole('spinbutton');
    await userEvent.clear(feeInput);
    await userEvent.type(feeInput, '5');

    await userEvent.click(screen.getByRole('button', { name: '상품 추가' }));

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledOnce();
    });

    const body = postSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(body.product_name).toBe('테스트 네이버 상품 A');
    expect(body).not.toHaveProperty('seller_product_id');
    expect(body).not.toHaveProperty('vendor_item_id');
    expect(body).not.toHaveProperty('naver_product_no');
    expect(body.platform_fee_rate).toBe(0.05);
  });
});
