/**
 * coupang-categories-synonym.test.ts
 * GET /api/listing/coupang/categories 동의어 확장 통합 테스트
 *
 * 가짜 카테고리 트리를 주입해 동의어 확장이 실제로 검색 결과에 반영되는지 검증한다.
 */

import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

// vi.mock은 hoisting되므로 import 전에 선언
vi.mock('@/lib/listing/coupang-client', () => {
  // 아웃도어 카테고리 아래 "등산가방"·"배낭"·"트레킹백" 세 말단 노드를 가진 최소 트리
  const fakeTree = {
    displayItemCategoryCode: 0,
    name: 'root',
    status: 'ACTIVE',
    child: [
      {
        displayItemCategoryCode: 100,
        name: '아웃도어',
        status: 'ACTIVE',
        child: [
          { displayItemCategoryCode: 1001, name: '등산가방', status: 'ACTIVE', child: [] },
          { displayItemCategoryCode: 1002, name: '배낭', status: 'ACTIVE', child: [] },
          { displayItemCategoryCode: 1003, name: '트레킹백', status: 'ACTIVE', child: [] },
        ],
      },
    ],
  };
  return {
    getCoupangClient: vi.fn(() => ({
      getCategoryTree: vi.fn().mockResolvedValue(fakeTree),
      predictCategory: vi.fn().mockResolvedValue(null),
    })),
  };
});

import { GET } from '@/app/api/listing/coupang/categories/route';

describe('GET /api/listing/coupang/categories — 동의어 확장', () => {
  it('동의어 매핑 있는 키워드: 원본 + 동의어 노드를 모두 반환', async () => {
    const req = new NextRequest(
      'http://localhost/api/listing/coupang/categories?keyword=등산가방',
    );
    const res = await GET(req);
    const body = await res.json();

    expect(body.success).toBe(true);
    const codes = (body.data as { code: number }[]).map((d) => d.code);
    expect(codes).toContain(1001); // 등산가방 (원본 키워드 매칭)
    expect(codes).toContain(1002); // 배낭 (동의어 매칭)
    expect(codes).toContain(1003); // 트레킹백 (동의어 매칭)
  });

  it('동의어 매핑 없는 키워드: 기존 트리 검색 결과만 반환', async () => {
    const req = new NextRequest(
      'http://localhost/api/listing/coupang/categories?keyword=없는키워드',
    );
    const res = await GET(req);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
  });

  it('중복 code 없음 — 동일 말단이 여러 검색에 걸려도 한 번만 포함', async () => {
    const req = new NextRequest(
      'http://localhost/api/listing/coupang/categories?keyword=등산가방',
    );
    const res = await GET(req);
    const body = await res.json();

    const codes = (body.data as { code: number }[]).map((d) => d.code);
    const uniqueCodes = [...new Set(codes)];
    expect(codes.length).toBe(uniqueCodes.length);
  });
});
