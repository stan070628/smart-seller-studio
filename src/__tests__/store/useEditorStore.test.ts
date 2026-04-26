/**
 * useEditorStore.test.ts
 * Zustand 에디터 스토어 단위 테스트
 *
 * 실제 구현: src/store/useEditorStore.ts
 * 타입 정의: src/types/editor.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import useEditorStore from '@/store/useEditorStore';
import type { UploadedImage, ImageAnalysisResult } from '@/types/editor';

// ---------------------------------------------------------------------------
// 테스트 헬퍼: 스토어 초기화
// ---------------------------------------------------------------------------

// 각 테스트 전 스토어를 완전히 초기화합니다
beforeEach(() => {
  useEditorStore.setState({
    uploadedImages: [],
    reviewText: '',
    isGenerating: false,
    imageAnalysis: null,
    isAnalyzing: false,
    productExtract: null,
    isExtracting: false,
  });
});

// ---------------------------------------------------------------------------
// 픽스처 팩토리 함수
// ---------------------------------------------------------------------------

function makeImage(overrides?: Partial<UploadedImage>): UploadedImage {
  return {
    id: 'img-1',
    url: 'blob:http://localhost/test-image-1',
    name: 'test.jpg',
    size: 1024 * 500,
    uploadedAt: '2024-01-01T00:00:00.000Z',
    uploadStatus: 'pending',
    ...overrides,
  };
}

function makeImageAnalysis(overrides?: Partial<ImageAnalysisResult>): ImageAnalysisResult {
  return {
    material: '스테인리스 스틸',
    shape: '원통형',
    colors: ['블랙', '실버'],
    keyComponents: ['이중벽 구조', '원터치 뚜껑'],
    visualPrompt: 'A cinematic shot of a matte black tumbler',
    ...overrides,
  };
}


// ---------------------------------------------------------------------------
// 1. 이미지 관리
// ---------------------------------------------------------------------------

describe('이미지 관리', () => {
  it('addImage: 이미지 추가 후 uploadedImages 배열 길이가 증가한다', () => {
    const { result } = renderHook(() => useEditorStore());

    act(() => {
      result.current.addImage(makeImage({ id: 'img-1' }));
    });
    expect(result.current.uploadedImages).toHaveLength(1);

    act(() => {
      result.current.addImage(makeImage({ id: 'img-2', url: 'blob:http://localhost/img-2' }));
    });
    expect(result.current.uploadedImages).toHaveLength(2);
    expect(result.current.uploadedImages[1].id).toBe('img-2');
  });

  it('addImage: 동일 id 중복 추가 시 배열에 모두 누적된다 (중복 허용 동작 확인)', () => {
    // 실제 구현은 중복 id를 별도로 막지 않으므로 두 개가 쌓인다
    const { result } = renderHook(() => useEditorStore());
    const image = makeImage({ id: 'dup-id' });

    act(() => {
      result.current.addImage(image);
      result.current.addImage(image);
    });

    // 중복 방지 로직 없으므로 2개가 되어야 함
    expect(result.current.uploadedImages).toHaveLength(2);
    expect(result.current.uploadedImages.every((img) => img.id === 'dup-id')).toBe(true);
  });

  it('removeImage: 특정 id 이미지 삭제 후 배열에서 제거된다', () => {
    const { result } = renderHook(() => useEditorStore());

    // URL.revokeObjectURL mock 처리 (jsdom 미지원)
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    act(() => {
      result.current.addImage(makeImage({ id: 'keep' }));
      result.current.addImage(makeImage({ id: 'del', url: 'blob:http://localhost/del' }));
    });
    expect(result.current.uploadedImages).toHaveLength(2);

    act(() => {
      result.current.removeImage('del');
    });

    expect(result.current.uploadedImages).toHaveLength(1);
    expect(result.current.uploadedImages[0].id).toBe('keep');
    // ObjectURL 해제가 호출되었는지 확인
    expect(revokeSpy).toHaveBeenCalledWith('blob:http://localhost/del');

    revokeSpy.mockRestore();
  });

  it('removeImage: 존재하지 않는 id 삭제 시 에러 없이 배열이 변경되지 않는다', () => {
    const { result } = renderHook(() => useEditorStore());

    act(() => {
      result.current.addImage(makeImage({ id: 'img-1' }));
    });

    // 존재하지 않는 id 삭제 → 에러 없이 동작
    expect(() => {
      act(() => {
        result.current.removeImage('non-existent-id');
      });
    }).not.toThrow();

    // 기존 이미지는 그대로 유지
    expect(result.current.uploadedImages).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 2. 리뷰 텍스트 관리
// ---------------------------------------------------------------------------

describe('리뷰 텍스트 관리', () => {
  it('setReviewText: 텍스트 업데이트 후 상태에 반영된다', () => {
    const { result } = renderHook(() => useEditorStore());
    const sampleReview = '이 제품 정말 좋아요! 배송도 빠르고 품질도 최고입니다.';

    act(() => {
      result.current.setReviewText(sampleReview);
    });

    expect(result.current.reviewText).toBe(sampleReview);
  });

  it('setReviewText: 빈 문자열로 업데이트가 가능하다', () => {
    const { result } = renderHook(() => useEditorStore());

    act(() => {
      result.current.setReviewText('초기 텍스트');
    });
    expect(result.current.reviewText).toBe('초기 텍스트');

    act(() => {
      result.current.setReviewText('');
    });
    expect(result.current.reviewText).toBe('');
  });

  it('setReviewText: 여러 번 호출 시 마지막 값만 유지된다', () => {
    const { result } = renderHook(() => useEditorStore());

    act(() => {
      result.current.setReviewText('첫 번째');
      result.current.setReviewText('두 번째');
      result.current.setReviewText('세 번째');
    });

    expect(result.current.reviewText).toBe('세 번째');
  });
});

// ---------------------------------------------------------------------------
// 3. isGenerating 토글
// ---------------------------------------------------------------------------

describe('isGenerating 토글', () => {
  it('setIsGenerating: 로딩 상태를 토글할 수 있다', () => {
    const { result } = renderHook(() => useEditorStore());
    expect(result.current.isGenerating).toBe(false);

    act(() => {
      result.current.setIsGenerating(true);
    });
    expect(result.current.isGenerating).toBe(true);

    act(() => {
      result.current.setIsGenerating(false);
    });
    expect(result.current.isGenerating).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. 이미지 상태 업데이트 (Wave 2A: updateImageStatus)
// ---------------------------------------------------------------------------

describe('이미지 상태 업데이트', () => {
  it('updateImageStatus: storageUrl을 업데이트할 수 있다', () => {
    const { result } = renderHook(() => useEditorStore());

    act(() => {
      result.current.addImage(makeImage({ id: 'img-storage' }));
    });

    const storageUrl = 'https://example.supabase.co/storage/v1/object/public/test.jpg';

    act(() => {
      result.current.updateImageStatus('img-storage', { storageUrl });
    });

    const updated = result.current.uploadedImages.find((img) => img.id === 'img-storage');
    expect(updated).toBeDefined();
    expect(updated!.storageUrl).toBe(storageUrl);
    // 기존 속성 유지 확인
    expect(updated!.name).toBe('test.jpg');
  });

  it('updateImageStatus: uploadStatus를 변경할 수 있다', () => {
    const { result } = renderHook(() => useEditorStore());

    act(() => {
      result.current.addImage(makeImage({ id: 'img-status', uploadStatus: 'pending' }));
    });

    act(() => {
      result.current.updateImageStatus('img-status', { uploadStatus: 'uploading' });
    });

    const uploading = result.current.uploadedImages.find((img) => img.id === 'img-status');
    expect(uploading!.uploadStatus).toBe('uploading');

    act(() => {
      result.current.updateImageStatus('img-status', { uploadStatus: 'done' });
    });

    const done = result.current.uploadedImages.find((img) => img.id === 'img-status');
    expect(done!.uploadStatus).toBe('done');
  });

  it('updateImageStatus: 존재하지 않는 id는 무시되고 다른 이미지에 영향 없다', () => {
    const { result } = renderHook(() => useEditorStore());

    act(() => {
      result.current.addImage(makeImage({ id: 'img-A', uploadStatus: 'pending' }));
    });

    // 존재하지 않는 id로 업데이트 시도
    expect(() => {
      act(() => {
        result.current.updateImageStatus('non-existent-id', {
          uploadStatus: 'done',
          storageUrl: 'https://example.com/img.jpg',
        });
      });
    }).not.toThrow();

    // 기존 이미지는 변경되지 않아야 함
    const imgA = result.current.uploadedImages.find((img) => img.id === 'img-A');
    expect(imgA!.uploadStatus).toBe('pending');
    expect(imgA!.storageUrl).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 6. 이미지 분석 상태 관리 (Wave 2A: setImageAnalysis / setIsAnalyzing)
// ---------------------------------------------------------------------------

describe('이미지 분석 상태 관리', () => {
  it('setImageAnalysis: 분석 결과를 저장할 수 있다', () => {
    const { result } = renderHook(() => useEditorStore());
    const analysis = makeImageAnalysis();

    // 초기값은 null
    expect(result.current.imageAnalysis).toBeNull();

    act(() => {
      result.current.setImageAnalysis(analysis);
    });

    expect(result.current.imageAnalysis).toEqual(analysis);
    expect(result.current.imageAnalysis!.material).toBe('스테인리스 스틸');
    expect(result.current.imageAnalysis!.colors).toEqual(['블랙', '실버']);
  });

  it('setImageAnalysis: null로 초기화할 수 있다', () => {
    const { result } = renderHook(() => useEditorStore());

    act(() => {
      result.current.setImageAnalysis(makeImageAnalysis());
    });
    expect(result.current.imageAnalysis).not.toBeNull();

    act(() => {
      result.current.setImageAnalysis(null);
    });
    expect(result.current.imageAnalysis).toBeNull();
  });

  it('setIsAnalyzing: true/false 토글이 가능하다', () => {
    const { result } = renderHook(() => useEditorStore());

    // 초기값은 false
    expect(result.current.isAnalyzing).toBe(false);

    act(() => {
      result.current.setIsAnalyzing(true);
    });
    expect(result.current.isAnalyzing).toBe(true);

    act(() => {
      result.current.setIsAnalyzing(false);
    });
    expect(result.current.isAnalyzing).toBe(false);
  });
});
