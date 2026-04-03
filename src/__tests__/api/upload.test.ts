/**
 * upload.test.ts
 * POST /api/storage/upload Route Handler 단위 테스트
 *
 * 실제 구현: src/app/api/storage/upload/route.ts
 * 의존성: @/lib/supabase/server → uploadToStorage 를 vi.mock으로 대체
 *
 * 주의: jsdom 환경에서 FormData + multipart/form-data 처리가 완전하지 않아
 * NextRequest를 직접 모킹하는 방식으로 테스트합니다.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Supabase 서버 모듈 Mock (실제 Supabase 호출 방지)
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/server', () => ({
  uploadToStorage: vi.fn(),
  STORAGE_BUCKET: 'smart-seller-studio',
}));

import { uploadToStorage } from '@/lib/supabase/server';
import { POST } from '@/app/api/storage/upload/route';

const mockUploadToStorage = uploadToStorage as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// 성공 응답 픽스처
// ---------------------------------------------------------------------------

const MOCK_UPLOAD_RESULT = {
  url: 'https://example.supabase.co/storage/v1/object/public/smart-seller-studio/users/user-123/project-456/raw_images/1700000000000_test.jpg',
  path: 'users/user-123/project-456/raw_images/1700000000000_test.jpg',
  size: 1024 * 1024,
};

// ---------------------------------------------------------------------------
// 헬퍼: NextRequest 모킹 (formData()를 직접 stub)
// ---------------------------------------------------------------------------

interface MockFileOptions {
  name?: string;
  type?: string;
  size?: number;
}

interface MockRequestOptions {
  fileOptions?: MockFileOptions;
  userId?: string | null;
  projectId?: string | null;
  /** Content-Type 헤더를 multipart/form-data로 설정할지 여부 (기본: true) */
  setMultipartHeader?: boolean;
}

/**
 * NextRequest를 생성하고 formData() 메서드를 stub합니다.
 * jsdom 환경에서 실제 multipart 파싱 없이 FormData를 제어할 수 있습니다.
 */
function makeUploadRequest(opts: MockRequestOptions = {}): NextRequest {
  const {
    fileOptions = {},
    userId = 'user-123',
    projectId = 'project-456',
    setMultipartHeader = true,
  } = opts;

  const {
    name = 'test.jpg',
    type = 'image/jpeg',
    size = 1024 * 1024, // 기본 1MB
  } = fileOptions;

  // FormData 준비
  const formData = new FormData();

  if (size > 0) {
    const fileContent = new Uint8Array(Math.min(size, 100)).fill(0xff); // 실제 바이트는 최소화
    const file = new File([fileContent], name, { type });
    // File.size를 원하는 값으로 오버라이드 (테스트 목적)
    Object.defineProperty(file, 'size', { value: size, writable: false });
    formData.append('file', file);
  }

  if (userId !== null) {
    formData.append('userId', userId);
  }
  if (projectId !== null) {
    formData.append('projectId', projectId);
  }

  const headers: Record<string, string> = {};
  if (setMultipartHeader) {
    // boundary는 실제로 필요 없으나 Content-Type 검증 통과를 위해 포함
    headers['content-type'] = 'multipart/form-data; boundary=----TestBoundary';
  } else {
    headers['content-type'] = 'application/json';
  }

  const request = new NextRequest('http://localhost:3000/api/storage/upload', {
    method: 'POST',
    headers,
    body: 'stub', // 실제 body는 사용하지 않음 (formData() stub 처리)
  });

  // formData() 메서드를 stub: 준비한 FormData를 반환
  vi.spyOn(request, 'formData').mockResolvedValue(formData);

  return request;
}

// ---------------------------------------------------------------------------
// 테스트
// ---------------------------------------------------------------------------

describe('POST /api/storage/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('정상 업로드: 유효한 JPEG 파일(1MB) 전송 시 201과 url/path/size를 반환한다', async () => {
    mockUploadToStorage.mockResolvedValueOnce(MOCK_UPLOAD_RESULT);

    const request = makeUploadRequest();
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.data).toHaveProperty('url');
    expect(json.data).toHaveProperty('path');
    expect(json.data).toHaveProperty('size');
    expect(typeof json.data.url).toBe('string');
    expect(typeof json.data.path).toBe('string');
    expect(typeof json.data.size).toBe('number');
  });

  it('파일 크기 초과: 11MB 파일 전송 시 413과 에러 메시지를 반환한다', async () => {
    const elevenMB = 11 * 1024 * 1024;

    const request = makeUploadRequest({
      fileOptions: { size: elevenMB, name: 'big.jpg', type: 'image/jpeg' },
    });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(413);
    expect(json.success).toBe(false);
    expect(json.error).toContain('10MB');
    // 파일 크기 초과 시 업로드는 호출되지 않아야 함
    expect(mockUploadToStorage).not.toHaveBeenCalled();
  });

  it('파일 크기 경계값: 정확히 10MB(허용 최대) 파일은 정상 처리된다', async () => {
    mockUploadToStorage.mockResolvedValueOnce(MOCK_UPLOAD_RESULT);
    const tenMB = 10 * 1024 * 1024;

    const request = makeUploadRequest({
      fileOptions: { size: tenMB, name: 'max.jpg', type: 'image/jpeg' },
    });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json.success).toBe(true);
  });

  it('허용되지 않는 MIME 타입(PDF): 415와 에러 메시지를 반환한다', async () => {
    const request = makeUploadRequest({
      fileOptions: { name: 'document.pdf', type: 'application/pdf', size: 500 * 1024 },
    });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(415);
    expect(json.success).toBe(false);
    expect(json.error).toContain('application/pdf');
    expect(json.error).toContain('image/jpeg');
    expect(mockUploadToStorage).not.toHaveBeenCalled();
  });

  it('허용되지 않는 MIME 타입(GIF): 415를 반환한다', async () => {
    const request = makeUploadRequest({
      fileOptions: { name: 'animation.gif', type: 'image/gif', size: 1024 },
    });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(415);
    expect(json.success).toBe(false);
    expect(mockUploadToStorage).not.toHaveBeenCalled();
  });

  it('PNG 파일: 허용된 MIME 타입이므로 정상 처리된다', async () => {
    mockUploadToStorage.mockResolvedValueOnce(MOCK_UPLOAD_RESULT);

    const request = makeUploadRequest({
      fileOptions: { name: 'image.png', type: 'image/png', size: 2 * 1024 * 1024 },
    });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json.success).toBe(true);
  });

  it('WebP 파일: 허용된 MIME 타입이므로 정상 처리된다', async () => {
    mockUploadToStorage.mockResolvedValueOnce(MOCK_UPLOAD_RESULT);

    const request = makeUploadRequest({
      fileOptions: { name: 'image.webp', type: 'image/webp', size: 512 * 1024 },
    });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json.success).toBe(true);
  });

  it('userId 누락: FormData에 userId 없이 전송 시 400을 반환한다', async () => {
    const request = makeUploadRequest({ userId: null });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('userId');
    expect(mockUploadToStorage).not.toHaveBeenCalled();
  });

  it('userId 빈 문자열: 빈 userId 전송 시 400을 반환한다', async () => {
    const request = makeUploadRequest({ userId: '' });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('userId');
    expect(mockUploadToStorage).not.toHaveBeenCalled();
  });

  it('projectId 누락: FormData에 projectId 없이 전송 시 400을 반환한다', async () => {
    const request = makeUploadRequest({ projectId: null });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('projectId');
    expect(mockUploadToStorage).not.toHaveBeenCalled();
  });

  it('projectId 빈 문자열: 빈 projectId 전송 시 400을 반환한다', async () => {
    const request = makeUploadRequest({ projectId: '' });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('projectId');
    expect(mockUploadToStorage).not.toHaveBeenCalled();
  });

  it('Content-Type이 multipart/form-data가 아닐 때 400을 반환한다', async () => {
    const request = makeUploadRequest({ setMultipartHeader: false });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('multipart/form-data');
    expect(mockUploadToStorage).not.toHaveBeenCalled();
  });

  it('경로 인젝션 시도: userId에 특수문자 포함 시 400을 반환한다', async () => {
    const request = makeUploadRequest({ userId: '../admin/secret' });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('허용되지 않는 문자');
    expect(mockUploadToStorage).not.toHaveBeenCalled();
  });

  it('경로 인젝션 시도: projectId에 슬래시 포함 시 400을 반환한다', async () => {
    const request = makeUploadRequest({ projectId: 'proj/hack' });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('허용되지 않는 문자');
    expect(mockUploadToStorage).not.toHaveBeenCalled();
  });

  it('Supabase 업로드 실패: uploadToStorage가 Error를 throw하면 500을 반환한다', async () => {
    mockUploadToStorage.mockRejectedValueOnce(
      new Error('[Supabase Storage] 업로드 실패: Storage quota exceeded'),
    );

    const request = makeUploadRequest();
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.error).toContain('Supabase Storage');
  });

  it('Supabase URL 누락: NEXT_PUBLIC_SUPABASE_URL 포함 오류 시 503을 반환한다', async () => {
    mockUploadToStorage.mockRejectedValueOnce(
      new Error('[Supabase] 환경변수 NEXT_PUBLIC_SUPABASE_URL이 설정되지 않았습니다.'),
    );

    const request = makeUploadRequest();
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(503);
    expect(json.success).toBe(false);
    expect(json.error).toContain('Supabase 연결 정보');
  });

  it('Supabase 서비스 롤 키 누락: SUPABASE_SERVICE_ROLE_KEY 포함 오류 시 503을 반환한다', async () => {
    mockUploadToStorage.mockRejectedValueOnce(
      new Error('[Supabase] 환경변수 SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다.'),
    );

    const request = makeUploadRequest();
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(503);
    expect(json.success).toBe(false);
    expect(json.error).toContain('Supabase 연결 정보');
  });

  it('Supabase 버킷 미존재: Bucket not found 오류 시 503을 반환한다', async () => {
    mockUploadToStorage.mockRejectedValueOnce(
      new Error('Bucket not found'),
    );

    const request = makeUploadRequest();
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(503);
    expect(json.success).toBe(false);
    expect(json.error).toContain('버킷');
  });

  it('파일명에 특수문자 포함: sanitize 후 정상 업로드된다', async () => {
    mockUploadToStorage.mockResolvedValueOnce(MOCK_UPLOAD_RESULT);

    const request = makeUploadRequest({
      fileOptions: {
        name: '상품 이미지 (1).jpg',
        type: 'image/jpeg',
        size: 1024,
      },
    });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json.success).toBe(true);
    // uploadToStorage 호출 시 path에 sanitize된 파일명이 포함되어야 함
    const callArgs = mockUploadToStorage.mock.calls[0];
    const storagePath: string = callArgs[0];
    // 공백과 괄호는 언더스코어로 치환됨
    expect(storagePath).not.toContain(' ');
    expect(storagePath).not.toContain('(');
  });

  it('정상 업로드: uploadToStorage에 올바른 경로 패턴이 전달된다', async () => {
    mockUploadToStorage.mockResolvedValueOnce(MOCK_UPLOAD_RESULT);

    const request = makeUploadRequest({
      fileOptions: { name: 'photo.jpg', type: 'image/jpeg', size: 500 * 1024 },
      userId: 'testUser',
      projectId: 'proj-001',
    });
    await POST(request);

    expect(mockUploadToStorage).toHaveBeenCalledTimes(1);
    const storagePath: string = mockUploadToStorage.mock.calls[0][0];
    // 저장 경로 패턴: users/{userId}/{projectId}/raw_images/{timestamp}_{filename}
    expect(storagePath).toMatch(/^users\/testUser\/proj-001\/raw_images\/\d+_photo\.jpg$/);
  });
});
