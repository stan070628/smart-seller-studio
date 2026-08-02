/**
 * useEditorStore.ts
 * 에디터 전역 상태 관리 (Zustand)
 */

import { create } from 'zustand';
import { createJSONStorage, devtools, persist, type PersistOptions } from 'zustand/middleware';
import type { UploadedImage, ImageAnalysisResult } from '@/types/editor';
import type { GeneratedFrame, FrameType } from '@/types/frames';
import { type Theme, type ThemeKey, THEMES, DEFAULT_THEME } from '@/lib/themes';
import type { ProductExtractResult } from '@/lib/ai/prompts/product-extract';

/** 고유 프레임 인스턴스 ID 생성 */
function genFrameId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** localStorage 키. sss_ 접두사 관례를 따른다 (sss_tabs, sss_calc_* 등과 충돌 방지) */
export const EDITOR_STORAGE_KEY = 'sss_editor';

/**
 * localStorage에 저장하는 부분 — 텍스트·설정값만 골라 담는 화이트리스트다.
 * 아래 필드는 의도적으로 제외한다 (코드로 확인함, 27ade7f 조사 기준):
 * - uploadedImages: File 객체(직렬화 불가) + blob URL(새로고침 후 깨짐)을 담는다
 *   (src/types/editor.ts의 UploadedImage.url 주석: "브라우저 내에서만 유효한 ObjectURL")
 * - frameImages: 슬롯 값이 blob:(로컬 업로드, FrameCard.tsx의 URL.createObjectURL) ·
 *   data:(AI 생성 base64, generateFrameImage의 dataUrl) · https:(스토리지 URL)로 섞여 있다.
 *   blob은 새로고침 후 깨진 이미지가 되고 data:는 용량을 금방 채운다 — 통째로 제외한다
 * - frameImageFit / frameImageSettings: 위 두 필드에 딸린 슬롯별 설정이라
 *   이미지 없이 남아봐야 무의미한 고아 데이터가 된다
 * - isGenerating/isAnalyzing/isExtracting/isRecording/generatingImageForFrame: 로딩 플래그.
 *   새로고침 시점엔 어떤 요청도 실제로 진행 중이지 않으므로 저장할 이유가 없다
 * - selectedFrameType/selectedFrameId: 인스펙터 선택 상태, 세션을 넘길 만한 가치가 없다
 */
export type PersistedEditorState = {
  reviewText: string;
  productDescription: string;
  frames: GeneratedFrame[];
  theme: Theme;
  imageAnalysis: ImageAnalysisResult | null;
  productExtract: ProductExtractResult | null;
  promptOutdatedFrames: FrameType[];
};

/** 저장값이 GeneratedFrame 배열의 모양인지 확인한다. 아니면 복원을 포기한다. */
function isGeneratedFrameArray(value: unknown): value is GeneratedFrame[] {
  return (
    Array.isArray(value) &&
    value.every(
      (f) =>
        f !== null &&
        typeof f === 'object' &&
        typeof (f as GeneratedFrame).id === 'string' &&
        typeof (f as GeneratedFrame).frameType === 'string' &&
        typeof (f as GeneratedFrame).headline === 'string' &&
        typeof (f as GeneratedFrame).metadata === 'object',
    )
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

interface EditorStore {
  uploadedImages: UploadedImage[];
  reviewText: string;
  productDescription: string;
  frames: GeneratedFrame[];
  isGenerating: boolean;
  imageAnalysis: ImageAnalysisResult | null;
  isAnalyzing: boolean;
  /** 프레임 인스턴스 ID → (슬롯 키 → 이미지 URL) */
  frameImages: Record<string, Record<string, string>>;
  /** 프레임 인스턴스 ID → (슬롯 키 → fit 모드) */
  frameImageFit: Record<string, Record<string, 'cover' | 'contain'>>;
  /** 프레임 인스턴스 ID → (슬롯 키 → 위치·스케일 설정) */
  frameImageSettings: Record<string, Record<string, { scale: number; x: number; y: number }>>;
  theme: Theme;
  /** 현재 AI 이미지 생성 중인 프레임 인스턴스 ID (없으면 null) */
  generatingImageForFrame: string | null;
  /** 인스펙터 패널에서 편집 중인 프레임 타입 (없으면 null) */
  selectedFrameType: FrameType | null;
  /** 인스펙터 패널에서 편집 중인 프레임 인스턴스 ID (없으면 null) */
  selectedFrameId: string | null;
  /** 텍스트 수정으로 인해 imagePrompt가 최신 텍스트와 다를 수 있는 프레임 목록 */
  promptOutdatedFrames: Set<FrameType>;
  /** URL에서 추출한 상품 정보 */
  productExtract: ProductExtractResult | null;
  /** 상품 정보 추출 중 여부 */
  isExtracting: boolean;
  /** 음성 녹음 중 여부 */
  isRecording: boolean;

  addImage: (image: UploadedImage) => void;
  removeImage: (id: string) => void;
  updateImageStatus: (
    id: string,
    patch: Partial<Pick<UploadedImage, 'storageUrl' | 'uploadStatus'>>,
  ) => void;
  setReviewText: (text: string) => void;
  setProductDescription: (text: string) => void;
  setFrames: (frames: GeneratedFrame[]) => void;
  updateFrame: (frameType: FrameType, updates: Partial<GeneratedFrame>) => void;
  setIsGenerating: (value: boolean) => void;
  setImageAnalysis: (result: ImageAnalysisResult | null) => void;
  setIsAnalyzing: (value: boolean) => void;
  /** imageUrl이 null이면 해당 슬롯 삭제, 있으면 설정 — frameId: 프레임 인스턴스 ID */
  setFrameImage: (frameId: string, slotKey: string, imageUrl: string | null) => void;
  setFrameImageFit: (frameId: string, slotKey: string, fit: 'cover' | 'contain') => void;
  setFrameImageSettings: (frameId: string, slotKey: string, settings: Partial<{ scale: number; x: number; y: number }>) => void;
  setTheme: (key: ThemeKey) => void;
  addCustomFrame: (frameType: 'custom_3col' | 'custom_gallery' | 'custom_notice' | 'custom_return_notice' | 'custom_privacy' | 'thumbnail') => void;
  removeFrame: (frameType: FrameType) => void;
  setGeneratingImageForFrame: (frameId: string | null) => void;
  /** frameId: 프레임 인스턴스 ID */
  generateFrameImage: (frameId: string) => Promise<void>;
  /** frameType + frameId 동시 설정 */
  setSelectedFrame: (frameType: FrameType | null, frameId: string | null) => void;
  /** @deprecated setSelectedFrame 사용 권장 */
  setSelectedFrameType: (frameType: FrameType | null) => void;
  /** 프롬프트 outdated 프레임 추가 */
  addPromptOutdated: (frameType: FrameType) => void;
  /** 프롬프트 갱신 완료 후 outdated 플래그 해제 */
  removePromptOutdated: (frameType: FrameType) => void;
  /** URL에서 추출한 상품 정보 설정 */
  setProductExtract: (result: ProductExtractResult | null) => void;
  /** 상품 정보 추출 로딩 상태 */
  setIsExtracting: (value: boolean) => void;
  /** 음성 녹음 상태 설정 */
  setIsRecording: (value: boolean) => void;
}

/**
 * persist 설정. useTabStore(sss_tabs)를 그대로 따른다:
 * - storage.setItem은 실패(용량 초과·사파리 프라이빗 모드)를 삼킨다.
 *   zustand는 setItem의 throw를 액션 호출자까지 전파하므로 여기서 막지 않으면
 *   에디터의 모든 액션 호출이 QuotaExceededError로 죽는다.
 * - skipHydration: true — 이 스토어는 Next.js 서버 렌더 트리(app/editor/page.tsx)
 *   아래에서 쓰인다. store 생성 시점에 동기로 localStorage를 복원하면 서버가 그린
 *   기본값과 클라이언트 첫 렌더가 달라져 하이드레이션이 깨진다(계산기 82de74fe에서
 *   같은 문제를 지연 초기화로 겪었다). 복원은 AppShell의 useEffect에서
 *   마운트 이후 한 번 rehydrate()로 수행한다.
 */
export const editorPersistOptions: PersistOptions<EditorStore, PersistedEditorState> = {
  name: EDITOR_STORAGE_KEY,
  skipHydration: true,
  storage: createJSONStorage(() => ({
    getItem: (name) => localStorage.getItem(name),
    setItem: (name, value) => {
      try {
        localStorage.setItem(name, value);
      } catch {
        // 용량 초과·프라이빗 모드 등. 이번 세션은 저장 없이 동작한다
      }
    },
    removeItem: (name) => localStorage.removeItem(name),
  })),
  partialize: (s) => ({
    reviewText: s.reviewText,
    productDescription: s.productDescription,
    frames: s.frames,
    theme: s.theme,
    imageAnalysis: s.imageAnalysis,
    productExtract: s.productExtract,
    promptOutdatedFrames: Array.from(s.promptOutdatedFrames),
  }),
  merge: (persisted, current) => {
    const saved = persisted as Partial<PersistedEditorState> | undefined;
    if (!saved) return current;

    return {
      ...current,
      reviewText: typeof saved.reviewText === 'string' ? saved.reviewText : current.reviewText,
      productDescription:
        typeof saved.productDescription === 'string'
          ? saved.productDescription
          : current.productDescription,
      frames: isGeneratedFrameArray(saved.frames) ? saved.frames : current.frames,
      theme:
        saved.theme && typeof saved.theme === 'object' && typeof saved.theme.key === 'string'
          ? saved.theme
          : current.theme,
      imageAnalysis:
        saved.imageAnalysis && typeof saved.imageAnalysis === 'object'
          ? saved.imageAnalysis
          : current.imageAnalysis,
      productExtract:
        saved.productExtract && typeof saved.productExtract === 'object'
          ? saved.productExtract
          : current.productExtract,
      promptOutdatedFrames: isStringArray(saved.promptOutdatedFrames)
        ? new Set(saved.promptOutdatedFrames as FrameType[])
        : current.promptOutdatedFrames,
    };
  },
};

const useEditorStore = create<EditorStore>()(
  devtools(
    persist(
    (set, get) => ({
      uploadedImages: [],
      reviewText: '',
      productDescription: '',
      frames: [],
      isGenerating: false,
      imageAnalysis: null,
      isAnalyzing: false,
      frameImages: {},
      frameImageFit: {},
      frameImageSettings: {},
      theme: DEFAULT_THEME,
      generatingImageForFrame: null,
      selectedFrameType: null,
      selectedFrameId: null,
      promptOutdatedFrames: new Set<FrameType>(),
      productExtract: null,
      isExtracting: false,
      isRecording: false,

      addImage: (image: UploadedImage) =>
        set((state) => ({ uploadedImages: [...state.uploadedImages, image] }), false, 'addImage'),

      removeImage: (id: string) =>
        set(
          (state) => {
            const target = state.uploadedImages.find((img) => img.id === id);
            if (target) URL.revokeObjectURL(target.url);
            return { uploadedImages: state.uploadedImages.filter((img) => img.id !== id) };
          },
          false,
          'removeImage',
        ),

      updateImageStatus: (id, patch) =>
        set(
          (state) => ({
            uploadedImages: state.uploadedImages.map((img) =>
              img.id === id ? { ...img, ...patch } : img,
            ),
          }),
          false,
          'updateImageStatus',
        ),

      setReviewText: (text) => set({ reviewText: text }, false, 'setReviewText'),
      setProductDescription: (text) => set({ productDescription: text }, false, 'setProductDescription'),
      setFrames: (frames) =>
        set(
          {
            frames: frames.map((f) => (f.id ? f : { ...f, id: genFrameId() })),
          },
          false,
          'setFrames',
        ),

      updateFrame: (frameType, updates) =>
        set(
          (state) => ({
            frames: state.frames.map((f) =>
              f.frameType === frameType ? { ...f, ...updates } : f,
            ),
          }),
          false,
          'updateFrame',
        ),

      setIsGenerating: (value) => set({ isGenerating: value }, false, 'setIsGenerating'),
      setImageAnalysis: (result) => set({ imageAnalysis: result }, false, 'setImageAnalysis'),
      setIsAnalyzing: (value) => set({ isAnalyzing: value }, false, 'setIsAnalyzing'),

      setFrameImage: (frameId, slotKey, imageUrl) =>
        set(
          (state) => {
            const prevSlots = state.frameImages[frameId] ?? {};
            const nextSlots = { ...prevSlots };
            if (imageUrl === null) {
              delete nextSlots[slotKey];
            } else {
              nextSlots[slotKey] = imageUrl;
            }
            return {
              frameImages: { ...state.frameImages, [frameId]: nextSlots },
            };
          },
          false,
          'setFrameImage',
        ),

      setFrameImageFit: (frameId, slotKey, fit) =>
        set(
          (state) => {
            const prevSlots = state.frameImageFit[frameId] ?? {};
            return {
              frameImageFit: {
                ...state.frameImageFit,
                [frameId]: { ...prevSlots, [slotKey]: fit },
              },
            };
          },
          false,
          'setFrameImageFit',
        ),

      setFrameImageSettings: (frameId, slotKey, settings) =>
        set(
          (state) => {
            const prevSlots = state.frameImageSettings[frameId] ?? {};
            const prevSlotSettings = prevSlots[slotKey] ?? { scale: 1, x: 50, y: 50 };
            return {
              frameImageSettings: {
                ...state.frameImageSettings,
                [frameId]: {
                  ...prevSlots,
                  [slotKey]: { ...prevSlotSettings, ...settings },
                },
              },
            };
          },
          false,
          'setFrameImageSettings',
        ),

      setTheme: (key: ThemeKey) => set({ theme: THEMES[key] }, false, 'setTheme'),

      removeFrame: (frameType) =>
        set(
          (state) => ({ frames: state.frames.filter((f) => f.frameType !== frameType) }),
          false,
          'removeFrame',
        ),

      setGeneratingImageForFrame: (frameId) =>
        set({ generatingImageForFrame: frameId }, false, 'setGeneratingImageForFrame'),

      generateFrameImage: async (frameId) => {
        const state = get();

        // 해당 프레임 조회 (id 기준)
        const frame = state.frames.find((f) => f.id === frameId);
        if (!frame?.imagePrompt) {
          throw new Error('imagePrompt가 없습니다');
        }
        const frameType = frame.frameType;

        set({ generatingImageForFrame: frameId }, false, 'generateFrameImage/start');

        try {
          let productImageBase64: string | undefined;
          let productImageMimeType: string | undefined;

          // needsProductImage === true이면 첫 번째 업로드 이미지를 base64로 변환
          if (frame.needsProductImage === true) {
            const firstImage = state.uploadedImages[0];
            if (firstImage) {
              const imageUrl = firstImage.storageUrl ?? firstImage.url;
              const response = await fetch(imageUrl);
              const arrayBuffer = await response.arrayBuffer();
              const uint8Array = new Uint8Array(arrayBuffer);

              // Uint8Array → binary string → base64
              let binary = '';
              for (let i = 0; i < uint8Array.byteLength; i++) {
                binary += String.fromCharCode(uint8Array[i]);
              }
              productImageBase64 = btoa(binary);

              // mimeType 추출 (response 헤더 우선, 없으면 파일 확장자 추론)
              const contentType = response.headers.get('content-type');
              if (contentType && contentType.startsWith('image/')) {
                // content-type에서 파라미터 제거 (예: "image/jpeg; charset=utf-8" → "image/jpeg")
                productImageMimeType = contentType.split(';')[0].trim() as string;
              } else if (firstImage.file) {
                productImageMimeType = firstImage.file.type || 'image/jpeg';
              } else {
                // URL 확장자로 추론
                const ext = imageUrl.split('?')[0].split('.').pop()?.toLowerCase();
                const extMap: Record<string, string> = {
                  jpg: 'image/jpeg',
                  jpeg: 'image/jpeg',
                  png: 'image/png',
                  webp: 'image/webp',
                };
                productImageMimeType = extMap[ext ?? ''] ?? 'image/jpeg';
              }

              // mimeType이 허용된 형식이 아니면 jpeg로 기본값 처리
              const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
              if (!allowedMimeTypes.includes(productImageMimeType)) {
                productImageMimeType = 'image/jpeg';
              }
            }
          }

          // 이미지 비율 힌트를 프롬프트에 추가
          const { getFrameSlots } = await import('@/lib/constants/image-slots');
          const slots = getFrameSlots(frameType);
          const activeSlot = slots.find(s => s.key === 'main') ?? slots[0];
          const aspectSuffix = activeSlot?.aspectHint
            ? `\n\nIMPORTANT: Generate image with aspect ratio matching ${activeSlot.aspectHint}. Fill the entire frame.`
            : '';
          const enhancedPrompt = frame.imagePrompt + aspectSuffix;

          // API 호출
          const res = await fetch('/api/ai/generate-frame-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              frameType,
              imagePrompt: enhancedPrompt,
              ...(productImageBase64 && productImageMimeType
                ? { productImageBase64, productImageMimeType }
                : {}),
            }),
          });

          if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(
              (errorData as { error?: string }).error ?? `이미지 생성 실패 (${res.status})`,
            );
          }

          const data = (await res.json()) as {
            success: boolean;
            data: { imageBase64: string; mimeType: string };
          };

          if (!data.success) {
            throw new Error('이미지 생성에 실패했습니다.');
          }

          const { imageBase64, mimeType } = data.data;

          // 스토어에 생성된 이미지 URL 저장 (AI 생성 이미지는 'main' 슬롯에 저장)
          const dataUrl = `data:${mimeType};base64,${imageBase64}`;
          set(
            (state) => {
              const prevSlots = state.frameImages[frameId] ?? {};
              return {
                frameImages: {
                  ...state.frameImages,
                  [frameId]: { ...prevSlots, main: dataUrl },
                },
              };
            },
            false,
            'generateFrameImage/save',
          );
        } finally {
          set({ generatingImageForFrame: null }, false, 'generateFrameImage/end');
        }
      },

      setSelectedFrame: (frameType, frameId) =>
        set({ selectedFrameType: frameType, selectedFrameId: frameId }, false, 'setSelectedFrame'),

      setSelectedFrameType: (frameType) =>
        set({ selectedFrameType: frameType, selectedFrameId: null }, false, 'setSelectedFrameType'),

      addPromptOutdated: (frameType) =>
        set(
          (state) => {
            const next = new Set(state.promptOutdatedFrames);
            next.add(frameType);
            return { promptOutdatedFrames: next };
          },
          false,
          'addPromptOutdated',
        ),

      removePromptOutdated: (frameType) =>
        set(
          (state) => {
            const next = new Set(state.promptOutdatedFrames);
            next.delete(frameType);
            return { promptOutdatedFrames: next };
          },
          false,
          'removePromptOutdated',
        ),

      setProductExtract: (result) => set({ productExtract: result }, false, 'setProductExtract'),
      setIsExtracting: (value) => set({ isExtracting: value }, false, 'setIsExtracting'),
      setIsRecording: (value) => set({ isRecording: value }, false, 'setIsRecording'),

      addCustomFrame: (frameType) =>
        set(
          (state) => {
            const newFrame: GeneratedFrame = {
              id: genFrameId(),
              frameType,
              headline:
                frameType === 'custom_3col' ? '제품 라인업 소개' :
                frameType === 'custom_notice' ? 'Notice' :
                frameType === 'custom_return_notice' ? 'Return' :
                frameType === 'custom_privacy' ? 'Privacy' :
                frameType === 'thumbnail' ? '상품명을 입력하세요' :
                '갤러리',
              subheadline: frameType === 'custom_3col' ? '피부타입과 고민에 따라 골라쓰는' : null,
              bodyText: null, ctaText: null,
              metadata: {},
              skip: false, imageDirection: null,
            };
            return { frames: [...state.frames, newFrame] };
          },
          false,
          'addCustomFrame',
        ),
    }),
    editorPersistOptions,
    ),
    { name: 'EditorStore' },
  ),
);

export default useEditorStore;
