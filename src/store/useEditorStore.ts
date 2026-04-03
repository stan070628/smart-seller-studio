/**
 * useEditorStore.ts
 * 에디터 전역 상태 관리 (Zustand)
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { UploadedImage, ImageAnalysisResult } from '@/types/editor';
import type { GeneratedFrame, FrameType } from '@/types/frames';
import { type Theme, type ThemeKey, THEMES, DEFAULT_THEME } from '@/lib/themes';

interface EditorStore {
  uploadedImages: UploadedImage[];
  reviewText: string;
  productDescription: string;
  frames: GeneratedFrame[];
  isGenerating: boolean;
  imageAnalysis: ImageAnalysisResult | null;
  isAnalyzing: boolean;
  frameImages: Partial<Record<FrameType, string>>;
  frameImageFit: Partial<Record<FrameType, 'cover' | 'contain'>>;
  frameImageSettings: Partial<Record<FrameType, { scale: number; x: number; y: number }>>;
  theme: Theme;

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
  setFrameImage: (frameType: FrameType, imageUrl: string | null) => void;
  setFrameImageFit: (frameType: FrameType, fit: 'cover' | 'contain') => void;
  setFrameImageSettings: (frameType: FrameType, settings: Partial<{ scale: number; x: number; y: number }>) => void;
  setTheme: (key: ThemeKey) => void;
  addCustomFrame: (frameType: 'custom_3col' | 'custom_gallery' | 'custom_notice' | 'custom_return_notice' | 'custom_privacy') => void;
  removeFrame: (frameType: FrameType) => void;
}

const useEditorStore = create<EditorStore>()(
  devtools(
    (set) => ({
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

      setFrameImage: (frameType, imageUrl) =>
        set(
          (state) => {
            const next = { ...state.frameImages };
            if (imageUrl === null) delete next[frameType];
            else next[frameType] = imageUrl;
            return { frameImages: next };
          },
          false,
          'setFrameImage',
        ),

      setFrameImageFit: (frameType, fit) =>
        set(
          (state) => ({ frameImageFit: { ...state.frameImageFit, [frameType]: fit } }),
          false,
          'setFrameImageFit',
        ),

      setFrameImageSettings: (frameType, settings) =>
        set(
          (state) => ({
            frameImageSettings: {
              ...state.frameImageSettings,
              [frameType]: { scale: 1, x: 50, y: 50, ...state.frameImageSettings[frameType], ...settings },
            },
          }),
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
