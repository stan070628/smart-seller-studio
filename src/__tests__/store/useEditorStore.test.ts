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
import type { UploadedImage, GeneratedCopy, CanvasTextObject, CanvasImageObject, ImageAnalysisResult } from '@/types/editor';

// ---------------------------------------------------------------------------
// 테스트 헬퍼: 스토어 초기화
// ---------------------------------------------------------------------------

// 각 테스트 전 스토어를 완전히 초기화합니다
beforeEach(() => {
  // Zustand 스토어 상태 직접 리셋
  useEditorStore.setState({
    uploadedImages: [],
    reviewText: '',
    generatedCopies: [],
    canvasObjects: [],
    isGenerating: false,
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

function makeCopy(overrides?: Partial<GeneratedCopy>): GeneratedCopy {
  return {
    id: 'copy-1',
    title: '테스트 카피 제목',
    subtitle: '테스트 서브 카피',
    ...overrides,
  };
}

function makeTextObject(overrides?: Partial<CanvasTextObject>): CanvasTextObject {
  return {
    id: 'obj-text-1',
    type: 'text',
    content: '테스트 텍스트',
    left: 100,
    top: 100,
    width: 200,
    height: 50,
    angle: 0,
    zIndex: 1,
    fontSize: 16,
    fontFamily: 'Arial',
    fontWeight: 'normal',
    fill: '#000000',
    textAlign: 'left',
    ...overrides,
  };
}

function makeImageObject(overrides?: Partial<CanvasImageObject>): CanvasImageObject {
  return {
    id: 'obj-img-1',
    type: 'image',
    imageId: 'img-1',
    src: 'blob:http://localhost/test-image-1',
    left: 0,
    top: 0,
    width: 400,
    height: 300,
    angle: 0,
    zIndex: 0,
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
// 3. 캔버스 객체 관리
// ---------------------------------------------------------------------------

describe('캔버스 객체 관리', () => {
  it('addCanvasObject: 텍스트 객체를 캔버스에 추가할 수 있다', () => {
    const { result } = renderHook(() => useEditorStore());
    const textObj = makeTextObject();

    act(() => {
      result.current.addCanvasObject(textObj);
    });

    expect(result.current.canvasObjects).toHaveLength(1);
    expect(result.current.canvasObjects[0].type).toBe('text');
    expect((result.current.canvasObjects[0] as CanvasTextObject).content).toBe('테스트 텍스트');
  });

  it('addCanvasObject: 이미지 객체를 캔버스에 추가할 수 있다', () => {
    const { result } = renderHook(() => useEditorStore());
    const imgObj = makeImageObject();

    act(() => {
      result.current.addCanvasObject(imgObj);
    });

    expect(result.current.canvasObjects).toHaveLength(1);
    expect(result.current.canvasObjects[0].type).toBe('image');
    expect((result.current.canvasObjects[0] as CanvasImageObject).imageId).toBe('img-1');
  });

  it('addCanvasObject: 텍스트와 이미지 객체를 함께 추가할 수 있다', () => {
    const { result } = renderHook(() => useEditorStore());

    act(() => {
      result.current.addCanvasObject(makeTextObject({ id: 'text-1' }));
      result.current.addCanvasObject(makeImageObject({ id: 'image-1' }));
    });

    expect(result.current.canvasObjects).toHaveLength(2);
  });

  it('updateCanvasObject: 특정 id 객체의 속성을 부분 업데이트한다', () => {
    const { result } = renderHook(() => useEditorStore());
    const textObj = makeTextObject({ id: 'update-target', left: 100, top: 100 });

    act(() => {
      result.current.addCanvasObject(textObj);
    });

    // 위치와 콘텐츠만 부분 업데이트
    act(() => {
      result.current.updateCanvasObject('update-target', {
        left: 250,
        top: 300,
      });
    });

    const updated = result.current.canvasObjects.find((o) => o.id === 'update-target');
    expect(updated).toBeDefined();
    expect(updated!.left).toBe(250);
    expect(updated!.top).toBe(300);
    // 변경하지 않은 속성은 유지
    expect(updated!.angle).toBe(0);
  });

  it('updateCanvasObject: 존재하지 않는 id 업데이트 시 다른 객체에 영향 없다', () => {
    const { result } = renderHook(() => useEditorStore());

    act(() => {
      result.current.addCanvasObject(makeTextObject({ id: 'obj-1', left: 10 }));
    });

    act(() => {
      result.current.updateCanvasObject('non-existent', { left: 999 });
    });

    expect(result.current.canvasObjects[0].left).toBe(10);
  });

  it('removeCanvasObject: 특정 id 객체를 삭제한다', () => {
    const { result } = renderHook(() => useEditorStore());

    act(() => {
      result.current.addCanvasObject(makeTextObject({ id: 'keep-obj' }));
      result.current.addCanvasObject(makeTextObject({ id: 'del-obj' }));
    });
    expect(result.current.canvasObjects).toHaveLength(2);

    act(() => {
      result.current.removeCanvasObject('del-obj');
    });

    expect(result.current.canvasObjects).toHaveLength(1);
    expect(result.current.canvasObjects[0].id).toBe('keep-obj');
  });

  it('removeCanvasObject: 존재하지 않는 id 삭제 시 에러 없이 동작한다', () => {
    const { result } = renderHook(() => useEditorStore());

    act(() => {
      result.current.addCanvasObject(makeTextObject({ id: 'obj-1' }));
    });

    expect(() => {
      act(() => {
        result.current.removeCanvasObject('ghost-id');
      });
    }).not.toThrow();

    expect(result.current.canvasObjects).toHaveLength(1);
  });

  it('clearCanvasObjects: 모든 캔버스 객체를 초기화한다', () => {
    const { result } = renderHook(() => useEditorStore());

    act(() => {
      result.current.addCanvasObject(makeTextObject({ id: 'obj-1' }));
      result.current.addCanvasObject(makeTextObject({ id: 'obj-2' }));
      result.current.addCanvasObject(makeImageObject({ id: 'obj-3' }));
    });
    expect(result.current.canvasObjects).toHaveLength(3);

    act(() => {
      result.current.clearCanvasObjects();
    });

    expect(result.current.canvasObjects).toHaveLength(0);
  });

  it('clearCanvasObjects: 빈 배열에서 호출해도 에러가 발생하지 않는다', () => {
    const { result } = renderHook(() => useEditorStore());

    expect(() => {
      act(() => {
        result.current.clearCanvasObjects();
      });
    }).not.toThrow();

    expect(result.current.canvasObjects).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4. AI 카피 관리
// ---------------------------------------------------------------------------

describe('AI 카피 관리', () => {
  it('setGeneratedCopies: Mock 카피 3개 주입 후 상태에 반영된다', () => {
    const { result } = renderHook(() => useEditorStore());
    const mockCopies: GeneratedCopy[] = [
      makeCopy({ id: 'copy-1', title: '카피 제목 1', subtitle: '카피 서브 1' }),
      makeCopy({ id: 'copy-2', title: '카피 제목 2', subtitle: '카피 서브 2' }),
      makeCopy({ id: 'copy-3', title: '카피 제목 3', subtitle: '카피 서브 3' }),
    ];

    act(() => {
      result.current.setGeneratedCopies(mockCopies);
    });

    expect(result.current.generatedCopies).toHaveLength(3);
    expect(result.current.generatedCopies[0].id).toBe('copy-1');
    expect(result.current.generatedCopies[0].title).toBe('카피 제목 1');
    expect(result.current.generatedCopies[1].id).toBe('copy-2');
    expect(result.current.generatedCopies[2].id).toBe('copy-3');
  });

  it('setGeneratedCopies: 빈 배열로 초기화할 수 있다', () => {
    const { result } = renderHook(() => useEditorStore());

    act(() => {
      result.current.setGeneratedCopies([makeCopy()]);
    });
    expect(result.current.generatedCopies).toHaveLength(1);

    act(() => {
      result.current.setGeneratedCopies([]);
    });
    expect(result.current.generatedCopies).toHaveLength(0);
  });

  it('setGeneratedCopies: 기존 카피를 새 카피로 덮어쓴다', () => {
    const { result } = renderHook(() => useEditorStore());

    act(() => {
      result.current.setGeneratedCopies([makeCopy({ id: 'old-copy', title: '이전 카피' })]);
    });

    act(() => {
      result.current.setGeneratedCopies([makeCopy({ id: 'new-copy', title: '새 카피' })]);
    });

    expect(result.current.generatedCopies).toHaveLength(1);
    expect(result.current.generatedCopies[0].id).toBe('new-copy');
  });

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
// 5. 이미지 상태 업데이트 (Wave 2A: updateImageStatus)
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
