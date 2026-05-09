import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';

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
  label_type: 'quality',
  fields: mockFields as unknown as Record<string, unknown>,
  created_at: '2026-05-05T00:00:00.000Z',
};

describe('getLabelTemplates', () => {
  beforeEach(() => {
    server.use(
      http.get('/api/label/templates', () => {
        return HttpResponse.json({ templates: [mockTemplate] });
      }),
    );
  });

  it('현재 유저의 템플릿 목록을 반환한다', async () => {
    const result = await getLabelTemplates('quality');
    expect(result).toEqual([mockTemplate]);
  });

  it('Supabase 에러 시 빈 배열을 반환한다', async () => {
    // 서버 에러 응답을 핸들러 오버라이드로 시뮬레이션
    server.use(
      http.get('/api/label/templates', () => {
        return HttpResponse.json({ error: 'DB error' }, { status: 500 });
      }),
    );
    const result = await getLabelTemplates('quality');
    expect(result).toEqual([]);
  });

  it('유저 없으면 빈 배열을 반환한다', async () => {
    server.use(
      http.get('/api/label/templates', () => {
        return HttpResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
      }),
    );
    const result = await getLabelTemplates('quality');
    expect(result).toEqual([]);
  });
});

describe('saveLabelTemplate', () => {
  beforeEach(() => {
    server.use(
      http.post('/api/label/templates', () => {
        return HttpResponse.json({ template: mockTemplate }, { status: 201 });
      }),
    );
  });

  it('템플릿을 저장하고 반환한다', async () => {
    const result = await saveLabelTemplate('기본 세차타월', 'quality', mockFields as unknown as Record<string, unknown>);
    expect(result).toEqual(mockTemplate);
  });

  it('유저 없으면 에러를 던진다', async () => {
    server.use(
      http.post('/api/label/templates', () => {
        return HttpResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
      }),
    );
    await expect(
      saveLabelTemplate('test', 'quality', mockFields as unknown as Record<string, unknown>),
    ).rejects.toThrow('로그인');
  });
});

describe('deleteLabelTemplate', () => {
  beforeEach(() => {
    server.use(
      http.delete('/api/label/templates', () => {
        return HttpResponse.json({ success: true });
      }),
    );
  });

  it('id로 템플릿을 삭제한다', async () => {
    await expect(deleteLabelTemplate('tmpl-1')).resolves.not.toThrow();
  });
});
