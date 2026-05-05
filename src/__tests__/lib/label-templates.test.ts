import { describe, it, expect, vi, beforeEach } from 'vitest';

// getBrowserClient 모킹
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockOrder = vi.fn();
const mockInsert = vi.fn();
const mockDelete = vi.fn();
const mockFrom = vi.fn();
const mockSingle = vi.fn();
const mockGetUser = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  getBrowserClient: () => ({
    from: mockFrom,
    auth: { getUser: mockGetUser },
  }),
}));

import {
  getLabelTemplates,
  saveLabelTemplate,
  deleteLabelTemplate,
  type QualityFields,
  type LabelTemplate,
} from '@/lib/label/label-templates';

const mockFields: QualityFields = {
  productName: '세차타월',
  material: '극세사 80% / 폴리아미드 20%',
  size: '40×40cm',
  country: '중국',
  importer: '㈜ 테스트',
  address: '서울시 강남구',
  phone: '02-000-0000',
  extra: '',
};

const mockTemplate: LabelTemplate = {
  id: 'tmpl-1',
  user_id: 'user-123',
  name: '기본 세차타월',
  image_url: 'https://example.com/logo.png',
  fields: mockFields,
  created_at: '2026-05-05T00:00:00.000Z',
};

describe('getLabelTemplates', () => {
  beforeEach(() => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-123' } } });
    mockFrom.mockReturnValue({
      select: mockSelect.mockReturnValue({
        eq: mockEq.mockReturnValue({
          order: mockOrder.mockResolvedValue({ data: [mockTemplate], error: null }),
        }),
      }),
    });
  });

  it('현재 유저의 템플릿 목록을 반환한다', async () => {
    const result = await getLabelTemplates();
    expect(result).toEqual([mockTemplate]);
    expect(mockFrom).toHaveBeenCalledWith('label_templates');
  });

  it('Supabase 에러 시 빈 배열을 반환한다', async () => {
    mockOrder.mockResolvedValueOnce({ data: null, error: { message: 'DB error' } });
    const result = await getLabelTemplates();
    expect(result).toEqual([]);
  });

  it('유저 없으면 빈 배열을 반환한다', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const result = await getLabelTemplates();
    expect(result).toEqual([]);
  });
});

describe('saveLabelTemplate', () => {
  beforeEach(() => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-123' } } });
    mockFrom.mockReturnValue({
      insert: mockInsert.mockReturnValue({
        select: mockSelect.mockReturnValue({
          single: mockSingle.mockResolvedValue({ data: mockTemplate, error: null }),
        }),
      }),
    });
  });

  it('템플릿을 저장하고 반환한다', async () => {
    const result = await saveLabelTemplate('기본 세차타월', 'https://example.com/logo.png', mockFields);
    expect(result).toEqual(mockTemplate);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ name: '기본 세차타월', user_id: 'user-123' })
    );
  });

  it('유저 없으면 에러를 던진다', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    await expect(saveLabelTemplate('test', '', mockFields)).rejects.toThrow('로그인');
  });
});

describe('deleteLabelTemplate', () => {
  beforeEach(() => {
    mockFrom.mockReturnValue({
      delete: mockDelete.mockReturnValue({
        eq: mockEq.mockResolvedValue({ error: null }),
      }),
    });
  });

  it('id로 템플릿을 삭제한다', async () => {
    await expect(deleteLabelTemplate('tmpl-1')).resolves.not.toThrow();
    expect(mockDelete).toHaveBeenCalled();
  });
});
