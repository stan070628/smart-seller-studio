// src/__tests__/components/label-save-load.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';

import LabelSaveLoad from '@/components/label/LabelSaveLoad';

// ---------------------------------------------------------------------------
// 공통 픽스처
// ---------------------------------------------------------------------------

const MOCK_TEMPLATE = {
  id: 'tmpl-001',
  user_id: 'user-test-123',
  name: '기본 이벤트 템플릿',
  image_url: '',
  label_type: 'event' as const,
  fields: { title: '여름 특가', subtitle: '최대 50% 할인' },
  created_at: '2024-01-01T00:00:00.000Z',
};

const MOCK_SAVED_TEMPLATE = {
  id: 'tmpl-002',
  user_id: 'user-test-123',
  name: '새 템플릿',
  image_url: '',
  label_type: 'event' as const,
  fields: { foo: 'bar' },
  created_at: '2024-06-01T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// 헬퍼: 기본 GET 핸들러 등록
// ---------------------------------------------------------------------------

function setupGetHandler(templates = [MOCK_TEMPLATE]) {
  server.use(
    http.get('/api/label/templates', () => {
      return HttpResponse.json({ templates });
    }),
  );
}

// ---------------------------------------------------------------------------
// 테스트 스위트
// ---------------------------------------------------------------------------

describe('LabelSaveLoad', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // 테스트 1: 마운트 시 GET 호출 및 드롭다운에 템플릿 목록 표시
  // -------------------------------------------------------------------------

  it('마운트 시 GET /api/label/templates?type=event를 호출해 드롭다운에 템플릿 목록이 표시된다', async () => {
    setupGetHandler([MOCK_TEMPLATE]);

    render(
      <LabelSaveLoad
        labelType="event"
        currentData={{}}
        onLoad={vi.fn()}
      />,
    );

    // 초기에는 "저장된 템플릿 없음" 또는 "템플릿 선택..." placeholder가 있고
    // fetch 완료 후 템플릿 이름이 드롭다운에 나타난다
    await waitFor(() => {
      expect(screen.getByRole('option', { name: MOCK_TEMPLATE.name })).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // 테스트 2: 템플릿 선택 후 "불러오기" 클릭 시 onLoad가 merged data와 함께 호출된다
  // -------------------------------------------------------------------------

  it('템플릿 선택 후 "불러오기" 클릭 시 onLoad가 병합된 데이터와 함께 호출된다', async () => {
    setupGetHandler([MOCK_TEMPLATE]);

    const user = userEvent.setup();
    const onLoad = vi.fn();

    render(
      <LabelSaveLoad
        labelType="event"
        currentData={{}}
        onLoad={onLoad}
      />,
    );

    // 템플릿 목록 로드 완료 대기
    await waitFor(() => {
      expect(screen.getByRole('option', { name: MOCK_TEMPLATE.name })).toBeInTheDocument();
    });

    // 드롭다운에서 템플릿 선택
    await user.selectOptions(screen.getByRole('combobox'), MOCK_TEMPLATE.id);

    // "불러오기" 버튼 클릭
    await user.click(screen.getByRole('button', { name: '불러오기' }));

    // onLoad가 병합된 데이터와 함께 호출됐는지 확인
    // merged = { imageUrl: undefined, ...tmpl.fields }
    expect(onLoad).toHaveBeenCalledOnce();
    expect(onLoad).toHaveBeenCalledWith(
      expect.objectContaining(MOCK_TEMPLATE.fields),
    );
  });

  // -------------------------------------------------------------------------
  // 테스트 3: 이름 입력 후 "저장" 클릭 시 POST가 호출되고 목록에 추가된다
  // -------------------------------------------------------------------------

  it('이름 입력 후 "저장" 클릭 시 POST /api/label/templates가 호출되고 목록에 추가된다', async () => {
    // 초기 목록: 빈 배열
    setupGetHandler([]);

    // POST 핸들러 등록
    server.use(
      http.post('/api/label/templates', () => {
        return HttpResponse.json({ template: MOCK_SAVED_TEMPLATE }, { status: 201 });
      }),
    );

    const user = userEvent.setup();

    render(
      <LabelSaveLoad
        labelType="event"
        currentData={{ foo: 'bar' }}
        onLoad={vi.fn()}
      />,
    );

    // 이름 입력 필드에 텍스트 입력
    const nameInput = screen.getByPlaceholderText('이름 입력 후 저장');
    await user.type(nameInput, '새 템플릿');

    // "저장" 버튼 클릭
    await user.click(screen.getByRole('button', { name: '저장' }));

    // 저장 완료 메시지 확인
    await waitFor(() => {
      expect(screen.getByText('저장 완료!')).toBeInTheDocument();
    });

    // 새로 저장된 템플릿이 드롭다운에 추가됐는지 확인
    expect(screen.getByRole('option', { name: MOCK_SAVED_TEMPLATE.name })).toBeInTheDocument();
  });
});
