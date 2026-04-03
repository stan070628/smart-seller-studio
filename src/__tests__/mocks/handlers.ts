/**
 * handlers.ts
 * MSW(Mock Service Worker) 핸들러 정의
 *
 * 테스트 환경에서 실제 API 호출 없이 응답을 모킹합니다.
 */

import { http, HttpResponse } from 'msw';

// ---------------------------------------------------------------------------
// 공통 픽스처
// ---------------------------------------------------------------------------

const MOCK_PROJECT = {
  id: 'proj-abc-456',
  user_id: 'user-test-123',
  name: '테스트 프로젝트',
  canvas_state: null,
  thumbnail_url: null,
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// POST /api/ai/generate-copy 핸들러
// ---------------------------------------------------------------------------

const generateCopyHandler = http.post('/api/ai/generate-copy', () => {
  return HttpResponse.json({
    success: true,
    data: {
      sellingPoints: [
        '바람에도 뒤집히지 않는 역풍 대응 구조',
        '버튼 하나로 손 다침 없이 접히는 자동 개폐',
        '카라비너 고리로 가방에 바로 걸 수 있는 편의성',
      ],
      bubbleCopies: [
        '바람도 두렵지 않아',
        '양손이 자유로워요',
        '어디든 걸 수 있어',
      ],
      titles: [
        '강풍 자동개폐 카라비너 우산 방수 경량 안전버튼 남녀공용',
        '역풍 방지 자동 우산 카라비너 걸이 자동개폐 경량 방수',
        '자동 개폐 우산 강풍 카라비너 휴대 경량 방수 안전버튼',
      ],
    },
  });
});

// ---------------------------------------------------------------------------
// POST /api/ai/analyze-image 핸들러
// ---------------------------------------------------------------------------

const analyzeImageHandler = http.post('/api/ai/analyze-image', () => {
  return HttpResponse.json({
    success: true,
    data: {
      material: '이중벽 구조의 스테인리스 스틸 소재로 무광 마감 처리되어 있습니다',
      shape: '원통형 텀블러 형태로 뚜껑이 일체형이며 하단이 넓어 안정적입니다',
      colors: ['무광 블랙', '실버'],
      keyComponents: ['이중벽 진공 단열 구조', '실리콘 그립 밴드', '원터치 잠금 뚜껑'],
      visualPrompt:
        'A cinematic slow-motion shot of a matte black stainless steel tumbler --ar 9:16',
    },
  });
});

// ---------------------------------------------------------------------------
// POST /api/storage/upload 핸들러
// ---------------------------------------------------------------------------

const storageUploadHandler = http.post('/api/storage/upload', () => {
  return HttpResponse.json(
    {
      success: true,
      data: {
        url: 'https://example.supabase.co/storage/v1/object/public/smart-seller-studio/users/user-123/project-456/raw_images/1700000000000_test.jpg',
        path: 'users/user-123/project-456/raw_images/1700000000000_test.jpg',
        size: 1024 * 1024, // 1MB
      },
    },
    { status: 201 },
  );
});

// ---------------------------------------------------------------------------
// POST /api/render 핸들러
// ---------------------------------------------------------------------------

const renderHandler = http.post('/api/render', () => {
  // 1x1 흰색 JPEG base64 (최소한의 유효한 이미지 데이터)
  const mockJpegBase64 =
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARC' +
    'AABAAEDASIA2gABAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAA' +
    'AAAAA/9oADAMBAAIRAxEAPwCwABmX/9k=';
  return HttpResponse.json(
    {
      success: true,
      dataUrl: `data:image/jpeg;base64,${mockJpegBase64}`,
      size: 512,
    },
    { status: 200 },
  );
});

// ---------------------------------------------------------------------------
// GET /api/projects 핸들러 — 프로젝트 목록 조회
// 실제 응답 형식: { success: true, data: { projects: Project[], total: number, page: number } }
// ---------------------------------------------------------------------------

const listProjectsHandler = http.get('/api/projects', () => {
  return HttpResponse.json({
    success: true,
    data: {
      projects: [MOCK_PROJECT],
      total: 1,
      page: 1,
    },
  });
});

// ---------------------------------------------------------------------------
// POST /api/projects 핸들러 — 프로젝트 생성
// 실제 응답 형식: { success: true, data: { project: Project } } status 201
// ---------------------------------------------------------------------------

const createProjectHandler = http.post('/api/projects', () => {
  return HttpResponse.json(
    {
      success: true,
      data: {
        project: {
          ...MOCK_PROJECT,
          id: 'proj-new-789',
          name: '새 프로젝트',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      },
    },
    { status: 201 },
  );
});

// ---------------------------------------------------------------------------
// GET /api/projects/:id 핸들러 — 단건 조회
// 실제 응답 형식: { success: true, data: { project: Project } }
// ---------------------------------------------------------------------------

const getProjectHandler = http.get('/api/projects/:id', ({ params }) => {
  const { id } = params;
  return HttpResponse.json({
    success: true,
    data: {
      project: {
        ...MOCK_PROJECT,
        id: id as string,
      },
    },
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/projects/:id/canvas 핸들러 — 캔버스 저장
// 실제 응답 형식: { success: true, data: { savedAt: string (ISO 8601) } }
// ---------------------------------------------------------------------------

const saveCanvasHandler = http.patch('/api/projects/:id/canvas', () => {
  return HttpResponse.json({
    success: true,
    data: {
      savedAt: new Date().toISOString(),
    },
  });
});

// ---------------------------------------------------------------------------
// 핸들러 배열 export
// ---------------------------------------------------------------------------

export const handlers = [
  generateCopyHandler,
  analyzeImageHandler,
  storageUploadHandler,
  renderHandler,
  listProjectsHandler,
  createProjectHandler,
  getProjectHandler,
  saveCanvasHandler,
];
