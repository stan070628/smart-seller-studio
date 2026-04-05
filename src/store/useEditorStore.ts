/**
 * useEditorStore.ts
 * 에디터 전역 상태 관리 (Zustand)
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { UploadedImage, ImageAnalysisResult } from '@/types/editor';
import type { GeneratedFrame, FrameType } from '@/types/frames';
import { type Theme, type ThemeKey, THEMES, DEFAULT_THEME } from '@/lib/themes';
import type { ProductExtractResult } from '@/lib/ai/prompts/product-extract';

interface EditorStore {
  uploadedImages: UploadedImage[];
  reviewText: string;
  productDescription: string;
  frames: GeneratedFrame[];
  isGenerating: boolean;
  imageAnalysis: ImageAnalysisResult | null;
  isAnalyzing: boolean;
  /** 프레임 타입 → (슬롯 키 → 이미지 URL) */
  frameImages: Partial<Record<FrameType, Record<string, string>>>;
  /** 프레임 타입 → (슬롯 키 → fit 모드) */
  frameImageFit: Partial<Record<FrameType, Record<string, 'cover' | 'contain'>>>;
  /** 프레임 타입 → (슬롯 키 → 위치·스케일 설정) */
  frameImageSettings: Partial<Record<FrameType, Record<string, { scale: number; x: number; y: number }>>>;
  theme: Theme;
  /** 현재 AI 이미지 생성 중인 프레임 타입 (없으면 null) */
  generatingImageForFrame: FrameType | null;
  /** 인스펙터 패널에서 편집 중인 프레임 타입 (없으면 null) */
  selectedFrameType: FrameType | null;
  /** 텍스트 수정으로 인해 imagePrompt가 최신 텍스트와 다를 수 있는 프��임 목록 */
  promptOutdatedFrames: Set<FrameType>;
  /** URL에서 추출한 상품 정보 */
  productExtract: ProductExtractResult | null;
  /** 상품 정보 추출 중 여부 */
  isExtracting: boolean;

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
  /** imageUrl이 null이면 해당 슬롯 삭제, 있으면 설정 */
  setFrameImage: (frameType: FrameType, slotKey: string, imageUrl: string | null) => void;
  setFrameImageFit: (frameType: FrameType, slotKey: string, fit: 'cover' | 'contain') => void;
  setFrameImageSettings: (frameType: FrameType, slotKey: string, settings: Partial<{ scale: number; x: number; y: number }>) => void;
  setTheme: (key: ThemeKey) => void;
  addCustomFrame: (frameType: 'custom_3col' | 'custom_gallery' | 'custom_notice' | 'custom_return_notice' | 'custom_privacy') => void;
  removeFrame: (frameType: FrameType) => void;
  setGeneratingImageForFrame: (frameType: FrameType | null) => void;
  generateFrameImage: (frameType: FrameType) => Promise<void>;
  setSelectedFrameType: (frameType: FrameType | null) => void;
  /** 프롬프트 outdated 프레임 추가 */
  addPromptOutdated: (frameType: FrameType) => void;
  /** 프롬프트 갱신 완료 후 outdated 플래그 해제 */
  removePromptOutdated: (frameType: FrameType) => void;
  /** URL에서 추출한 상품 정보 설정 */
  setProductExtract: (result: ProductExtractResult | null) => void;
  /** 상품 정보 추출 로딩 상태 */
  setIsExtracting: (value: boolean) => void;
}

const useEditorStore = create<EditorStore>()(
  devtools(
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
      promptOutdatedFrames: new Set<FrameType>(),
      productExtract: null,
      isExtracting: false,

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
      setFrames: (frames) => set({ frames }, false, 'setFrames'),

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

      setFrameImage: (frameType, slotKey, imageUrl) =>
        set(
          (state) => {
            // 기존 프레임 슬롯 맵 복사 (없으면 빈 객체로 초기화)
            const prevSlots = state.frameImages[frameType] ?? {};
            const nextSlots = { ...prevSlots };

            if (imageUrl === null) {
              // null이면 해당 슬롯 삭제
              delete nextSlots[slotKey];
            } else {
              nextSlots[slotKey] = imageUrl;
            }

            return {
              frameImages: {
                ...state.frameImages,
                [frameType]: nextSlots,
              },
            };
          },
          false,
          'setFrameImage',
        ),

      setFrameImageFit: (frameType, slotKey, fit) =>
        set(
          (state) => {
            const prevSlots = state.frameImageFit[frameType] ?? {};
            return {
              frameImageFit: {
                ...state.frameImageFit,
                [frameType]: { ...prevSlots, [slotKey]: fit },
              },
            };
          },
          false,
          'setFrameImageFit',
        ),

      setFrameImageSettings: (frameType, slotKey, settings) =>
        set(
          (state) => {
            const prevSlots = state.frameImageSettings[frameType] ?? {};
            const prevSlotSettings = prevSlots[slotKey] ?? { scale: 1, x: 50, y: 50 };
            return {
              frameImageSettings: {
                ...state.frameImageSettings,
                [frameType]: {
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

      setGeneratingImageForFrame: (frameType) =>
        set({ generatingImageForFrame: frameType }, false, 'setGeneratingImageForFrame'),

      generateFrameImage: async (frameType) => {
        const state = get();

        // 해당 프레임 조회
        const frame = state.frames.find((f) => f.frameType === frameType);
        if (!frame?.imagePrompt) {
          throw new Error('imagePrompt가 없습니다');
        }

        set({ generatingImageForFrame: frameType }, false, 'generateFrameImage/start');

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
              const prevSlots = state.frameImages[frameType] ?? {};
              return {
                frameImages: {
                  ...state.frameImages,
                  [frameType]: { ...prevSlots, main: dataUrl },
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

      setSelectedFrameType: (frameType) =>
        set({ selectedFrameType: frameType }, false, 'setSelectedFrameType'),

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

      addCustomFrame: (frameType) =>
        set(
          (state) => {
            const newFrame: GeneratedFrame = {
              frameType,
              headline:
                frameType === 'custom_3col' ? '제품 라인업 소개' :
                frameType === 'custom_notice' ? 'Notice' :
                frameType === 'custom_return_notice' ? 'Return' :
                frameType === 'custom_privacy' ? 'Privacy' :
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
    { name: 'EditorStore' },
  ),
);

export default useEditorStore;
