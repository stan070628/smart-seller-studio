'use client';

/**
 * Sidebar.tsx
 * 좌측 사이드바 컴포넌트
 *
 * 포함 기능:
 *  1. 다중 이미지 업로드 (드래그 앤 드롭 + 파일 선택)
 *  2. Supabase Storage 백그라운드 업로드 (fire-and-forget)
 *  3. 쿠팡 리뷰 복사/붙여넣기용 Textarea
 *  4. AI 카피 생성 버튼 (/api/ai/generate-frames 호출)
 *     — 이미지가 있으면 분석(1/2) → 카피 생성(2/2) 순으로 자동 통합 실행
 */

import React, { useCallback, useRef, useState } from 'react';
import {
  ImagePlus,
  X,
  Sparkles,
  Loader2,
  ClipboardPaste,
  AlertCircle,
  FileText,
  LayoutGrid,
  Link2,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';
import useEditorStore from '@/store/useEditorStore';
import type { UploadedImage } from '@/types/editor';
import { THEMES } from '@/lib/themes';
import type { Theme } from '@/lib/themes';
import type { ThemeKey } from '@/lib/themes';

// ---------------------------------------------------------------------------
// 유틸 함수
// ---------------------------------------------------------------------------

/** 고유 ID 생성 */
const generateId = (): string =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

/** bytes → 사람이 읽기 편한 문자열 */
const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// ---------------------------------------------------------------------------
// 서브 컴포넌트: 업로드된 이미지 썸네일 카드
// ---------------------------------------------------------------------------
interface ImageCardProps {
  image: UploadedImage;
  onRemove: (id: string) => void;
}

const ImageCard: React.FC<ImageCardProps> = ({ image, onRemove }) => (
  <div className="group relative flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2">
    {/* 썸네일 */}
    <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-md bg-gray-200">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.url}
        alt={image.name}
        className="h-full w-full object-cover"
      />

      {/* 업로드 상태 오버레이 */}
      {image.uploadStatus === 'uploading' && (
        <div className="absolute inset-0 flex items-center justify-center rounded-md bg-black/50">
          <Loader2 size={16} className="animate-spin text-white" />
        </div>
      )}
      {image.uploadStatus === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 rounded-md bg-red-950/70">
          <AlertCircle size={14} className="text-red-400" />
          <span className="text-[9px] font-semibold text-red-300">재시도</span>
        </div>
      )}
    </div>

    {/* 파일 정보 */}
    <div className="min-w-0 flex-1">
      <p className="truncate text-xs font-medium text-gray-800">{image.name}</p>
      <p className="text-xs text-gray-400">{formatFileSize(image.size)}</p>
    </div>

    {/* 삭제 버튼 */}
    <button
      onClick={() => onRemove(image.id)}
      className="flex-shrink-0 rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-200 hover:text-red-400"
      title="이미지 삭제"
    >
      <X size={14} />
    </button>
  </div>
);

// ---------------------------------------------------------------------------
// 메인 컴포넌트
// ---------------------------------------------------------------------------
const Sidebar: React.FC = () => {
  // Zustand 스토어 바인딩
  const uploadedImages = useEditorStore((s) => s.uploadedImages);
  const reviewText = useEditorStore((s) => s.reviewText);
  const isGenerating = useEditorStore((s) => s.isGenerating);
  const imageAnalysis = useEditorStore((s) => s.imageAnalysis);

  const productDescription = useEditorStore((s) => s.productDescription);

  const addImage = useEditorStore((s) => s.addImage);
  const removeImage = useEditorStore((s) => s.removeImage);
  const updateImageStatus = useEditorStore((s) => s.updateImageStatus);
  const setReviewText = useEditorStore((s) => s.setReviewText);
  const setProductDescription = useEditorStore((s) => s.setProductDescription);
  const setFrames = useEditorStore((s) => s.setFrames);
  const setIsGenerating = useEditorStore((s) => s.setIsGenerating);
  const setImageAnalysis = useEditorStore((s) => s.setImageAnalysis);
  const theme = useEditorStore((s) => s.theme);
  const setTheme = useEditorStore((s) => s.setTheme);
  const addCustomFrame = useEditorStore((s) => s.addCustomFrame);
  const productExtract = useEditorStore((s) => s.productExtract);
  const isExtracting = useEditorStore((s) => s.isExtracting);
  const setProductExtract = useEditorStore((s) => s.setProductExtract);
  const setIsExtracting = useEditorStore((s) => s.setIsExtracting);

  // 드래그 오버 상태 (업로드 영역 하이라이트)
  const [isDragOver, setIsDragOver] = useState(false);

  // 카피 생성 단계 상태: null = 대기, 'analyzing' = 이미지 분석 중, 'generating' = 카피 생성 중
  const [generatingStep, setGeneratingStep] = useState<null | 'analyzing' | 'generating'>(null);

  // 이미지 분석 실패 시 인라인 경고 메시지 (window.alert 대신)
  const [analyzeWarning, setAnalyzeWarning] = useState<string | null>(null);

  // 상품 URL 입력 상태
  const [productUrl, setProductUrl] = useState('');
  const [extractError, setExtractError] = useState<string | null>(null);
  // 스크린샷 붙여넣기용 상태
  const [extractScreenshots, setExtractScreenshots] = useState<{ dataUrl: string; file: File }[]>([]);
  const extractFileInputRef = useRef<HTMLInputElement>(null);

  // 숨겨진 파일 input ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  // -----------------------------------------------------------------------
  // Storage 백그라운드 업로드 (fire-and-forget)
  // -----------------------------------------------------------------------
  const uploadFile = async (id: string, file: File) => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('userId', 'anonymous');
      formData.append('projectId', 'default-project');

      const res = await fetch('/api/storage/upload', {
        method: 'POST',
        body: formData,
      });
      const json = await res.json();

      if (json.success) {
        updateImageStatus(id, { storageUrl: json.data.url, uploadStatus: 'done' });
      } else {
        updateImageStatus(id, { uploadStatus: 'error' });
      }
    } catch {
      updateImageStatus(id, { uploadStatus: 'error' });
    }
  };

  // -----------------------------------------------------------------------
  // 이미지 처리 로직
  // -----------------------------------------------------------------------

  /** File 객체 → UploadedImage 변환 후 스토어에 추가, Storage 업로드 개시 */
  const processFiles = useCallback(
    (files: FileList | File[]) => {
      const fileArr = Array.from(files);
      fileArr.forEach((file) => {
        if (!file.type.startsWith('image/')) return;

        const url = URL.createObjectURL(file);
        const newImage: UploadedImage = {
          id: generateId(),
          url,
          name: file.name,
          size: file.size,
          uploadedAt: new Date().toISOString(),
          uploadStatus: 'uploading',
          file,
        };
        addImage(newImage);
        uploadFile(newImage.id, file);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [addImage, updateImageStatus],
  );

  /** 파일 input onChange 핸들러 */
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) processFiles(e.target.files);
    e.target.value = '';
  };

  /** 드롭 영역 클릭 시 파일 선택 다이얼로그 오픈 */
  const handleDropAreaClick = () => fileInputRef.current?.click();

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };
  const handleDragLeave = () => setIsDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    processFiles(e.dataTransfer.files);
  };

  // -----------------------------------------------------------------------
  // 이미지 AI 분석 (Gemini Vision)
  // -----------------------------------------------------------------------

  const readFileAsDataURL = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  /**
   * 이미지를 Canvas로 리사이즈 + JPEG 압축
   * Claude API 요청 크기 제한(~20MB)을 초과하지 않도록
   */
  const compressImage = (dataUrl: string, maxDimension = 1024, quality = 0.75): Promise<string> =>
    new Promise((resolve) => {
      const img = new window.Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width >= height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = dataUrl;
    });

  // -----------------------------------------------------------------------
  // AI 카피 생성 통합 핸들러
  // 1단계: 이미지가 있고 분석 결과가 없으면 이미지 분석 먼저 실행
  // 2단계: 카피 생성 (/api/ai/generate-frames 호출)
  // -----------------------------------------------------------------------
  const handleGenerateCopy = async () => {
    if (isGenerating) return;

    // 이전 경고 초기화
    setAnalyzeWarning(null);
    setIsGenerating(true);
    setGeneratingStep('generating');

    // 현재 분석 결과를 지역 변수로 추적 (비동기 흐름 내에서 최신 값 보장)
    let currentAnalysis = imageAnalysis;

    try {
      // -----------------------------------------------------------------
      // 1단계: 이미지 분석 (조건부 — 이미지가 있고 아직 분석 결과가 없을 때만)
      // -----------------------------------------------------------------
      if (uploadedImages.length > 0 && !imageAnalysis) {
        setGeneratingStep('analyzing');

        try {
          // 최대 5장, 압축 후 base64 변환
          const targetImages = uploadedImages.slice(0, 5);
          const imagePayloads = await Promise.all(
            targetImages.map(async (img) => {
              let base64DataUrl: string;
              if (img.file) {
                base64DataUrl = await readFileAsDataURL(img.file);
              } else {
                const blob = await fetch(img.url).then((r) => r.blob());
                const tempFile = new File([blob], img.name, { type: blob.type });
                base64DataUrl = await readFileAsDataURL(tempFile);
              }
              // 전송 전 1024px 이하로 압축 (JPEG 0.75)
              const compressed = await compressImage(base64DataUrl);
              return { imageBase64: compressed, mimeType: 'image/jpeg' };
            }),
          );

          const res = await fetch('/api/ai/analyze-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              images: imagePayloads,
              productDescription: productDescription.trim() || undefined,
            }),
          });

          const json = await res.json();

          if (!res.ok || !json.success) {
            // 소프트 폴백: 경고만 표시하고 이미지 분석 없이 카피 생성 계속 진행
            setAnalyzeWarning(
              `이미지 분석에 실패했습니다 (${json.error ?? '알 수 없는 오류'}). 리뷰 기반으로만 카피를 생성합니다.`,
            );
          } else {
            setImageAnalysis(json.data);
            currentAnalysis = json.data;
          }
        } catch (err) {
          // 소프트 폴백: 경고만 표시하고 계속 진행
          setAnalyzeWarning(
            `이미지 분석 중 오류가 발생했습니다 (${err instanceof Error ? err.message : '알 수 없는 오류'}). 리뷰 기반으로만 카피를 생성합니다.`,
          );
        }
      }

      // -----------------------------------------------------------------
      // 2단계: 카피 생성
      // -----------------------------------------------------------------
      setGeneratingStep('generating');

      const reviews = reviewText
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .slice(0, 50);

      // reviews가 비어있고 imageAnalysis도 없으면 API 호출 자체를 막음 (400 방지)
      if (reviews.length === 0) {
        setAnalyzeWarning('리뷰를 입력해야 카피를 생성할 수 있습니다.');
        return;
      }

      const res = await fetch('/api/ai/generate-frames', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviews,
          imageAnalysis: currentAnalysis ?? undefined,
          productDescription: productDescription.trim() || undefined,
          productExtract: productExtract ?? undefined,
        }),
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        setAnalyzeWarning(
          `카피 생성에 실패했습니다: ${json.error ?? '다시 시도해주세요.'}`,
        );
        return;
      }

      setFrames(json.data.frames);
    } catch {
      setAnalyzeWarning('카피 생성에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setIsGenerating(false);
      setGeneratingStep(null);
    }
  };

  // -----------------------------------------------------------------------
  // 추출 결과를 productDescription에 반영하는 공통 함수
  // -----------------------------------------------------------------------
  const applyExtractResult = (data: Record<string, unknown>) => {
    setProductExtract(data as unknown as Parameters<typeof setProductExtract>[0]);

    const parts: string[] = [];
    if (data.productName) parts.push(`상품명: ${data.productName}`);
    if (data.brand) parts.push(`브랜드: ${data.brand}`);
    if (Array.isArray(data.keyFeatures) && data.keyFeatures.length)
      parts.push(`특징: ${data.keyFeatures.join(', ')}`);
    if (Array.isArray(data.ingredients) && data.ingredients.length)
      parts.push(`성분: ${(data.ingredients as string[]).slice(0, 10).join(', ')}`);
    if (data.summary) parts.push(`요약: ${data.summary}`);

    if (parts.length > 0) {
      const current = productDescription.trim();
      const extracted = parts.join('\n');
      setProductDescription(current ? `${current}\n\n--- 자동 추출 ---\n${extracted}` : extracted);
    }
  };

  // -----------------------------------------------------------------------
  // 상품 URL에서 정보 자동 추출
  // -----------------------------------------------------------------------
  const handleExtractFromUrl = async () => {
    if (isExtracting || !productUrl.trim()) return;

    setExtractError(null);
    setIsExtracting(true);

    try {
      const res = await fetch('/api/ai/extract-product-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: productUrl.trim() }),
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        setExtractError(json.error ?? '추출에 실패했습니다');
        return;
      }

      applyExtractResult(json.data);
    } catch {
      setExtractError('네트워크 오류가 발생했습니다');
    } finally {
      setIsExtracting(false);
    }
  };

  // -----------------------------------------------------------------------
  // 스크린샷 붙여넣기/파일 선택으로 정보 추출
  // -----------------------------------------------------------------------
  const handleExtractFromScreenshots = async (files: File[]) => {
    if (isExtracting || files.length === 0) return;

    setExtractError(null);
    setIsExtracting(true);

    try {
      // 이미지를 base64로 변환
      const imagePayloads = await Promise.all(
        files.slice(0, 5).map(async (file) => {
          const dataUrl = await readFileAsDataURL(file);
          const compressed = await compressImage(dataUrl, 1600, 0.85);
          return { imageBase64: compressed, mimeType: 'image/jpeg' };
        }),
      );

      const res = await fetch('/api/ai/extract-product-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: imagePayloads }),
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        setExtractError(json.error ?? '분석에 실패했습니다');
        return;
      }

      applyExtractResult(json.data);
    } catch {
      setExtractError('네트워크 오류가 발생했습니다');
    } finally {
      setIsExtracting(false);
    }
  };

  // 클립보드 붙여넣기 핸들러 (Ctrl+V)
  const handleExtractPaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const imageFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) imageFiles.push(file);
        }
      }

      if (imageFiles.length > 0) {
        e.preventDefault();
        // 미리보기용
        const previews = imageFiles.map((file) => ({
          dataUrl: URL.createObjectURL(file),
          file,
        }));
        setExtractScreenshots(previews);
        handleExtractFromScreenshots(imageFiles);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isExtracting],
  );

  // 파일 선택 핸들러
  const handleExtractFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files).filter((f) => f.type.startsWith('image/'));
      if (files.length > 0) {
        const previews = files.map((file) => ({
          dataUrl: URL.createObjectURL(file),
          file,
        }));
        setExtractScreenshots(previews);
        handleExtractFromScreenshots(files);
      }
    }
    e.target.value = '';
  };

  // -----------------------------------------------------------------------
  // 렌더
  // -----------------------------------------------------------------------
  return (
    <aside className="flex h-full w-80 flex-shrink-0 flex-col gap-5 overflow-y-auto border-r border-gray-200 bg-white p-4">
      {/* ------------------------------------------------------------------ */}
      {/* 카테고리 선택                                                        */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-gray-500">
          템플릿 스타일
        </h2>
        <div className="flex flex-col gap-2">
          {(Object.values(THEMES) as Theme[]).map((t) => (
            <button
              key={t.key}
              onClick={() => setTheme(t.key as ThemeKey)}
              className={[
                'flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm font-medium transition-all',
                theme.key === t.key
                  ? 'border-red-500 bg-red-50 text-red-700'
                  : 'border-gray-200 bg-gray-50 text-gray-500 hover:border-gray-400 hover:text-gray-800',
              ].join(' ')}
            >
              <span className="text-lg">{t.emoji}</span>
              <span>{t.label}</span>
              {theme.key === t.key && (
                <span className="ml-auto text-xs text-red-500">선택됨</span>
              )}
            </button>
          ))}
        </div>
      </section>

      <hr className="border-gray-200" />

      {/* ------------------------------------------------------------------ */}
      {/* 섹션 1: 이미지 업로드                                               */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-gray-500">
          <ImagePlus size={15} />
          상품 이미지
        </h2>

        {/* 드롭 영역 */}
        <div
          role="button"
          tabIndex={0}
          onClick={handleDropAreaClick}
          onKeyDown={(e) => e.key === 'Enter' && handleDropAreaClick()}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={[
            'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 transition-all',
            isDragOver
              ? 'border-red-400 bg-red-50/40'
              : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50',
          ].join(' ')}
        >
          <ImagePlus size={28} className="text-gray-400" />
          <p className="text-center text-xs text-gray-400">
            이미지를 드래그하거나
            <br />
            <span className="font-semibold text-red-500">클릭하여 선택</span>
          </p>
          <p className="text-xs text-gray-400">PNG, JPG, WEBP 지원</p>
        </div>

        {/* 숨겨진 파일 input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />

        {/* 업로드된 이미지 목록 */}
        {uploadedImages.length > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            {uploadedImages.map((img) => (
              <ImageCard key={img.id} image={img} onRemove={removeImage} />
            ))}
            {/* 분석 완료 뱃지 — imageAnalysis가 있을 때만 표시 */}
            {imageAnalysis && (
              <p style={{ fontSize: 11, color: '#059669' }} className="mt-1">
                분석 완료 ✓
              </p>
            )}
          </div>
        )}
      </section>

      {/* 구분선 */}
      <hr className="border-gray-200" />

      {/* ------------------------------------------------------------------ */}
      {/* 섹션 1.5: 상품 정보 자동 추출 (URL 또는 스크린샷)                  */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-gray-500">
          <Link2 size={15} />
          상품 정보 자동 추출
        </h2>

        {!productExtract ? (
          <>
            {/* URL 입력 */}
            <p className="mb-1.5 text-[11px] font-medium text-gray-500">방법 1: URL 붙여넣기 (도매꾹·도매매·네이버 등)</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={productUrl}
                onChange={(e) => setProductUrl(e.target.value)}
                placeholder="https://www.coupang.com/vp/..."
                className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-xs text-gray-800 placeholder-gray-400 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50"
                onKeyDown={(e) => e.key === 'Enter' && handleExtractFromUrl()}
              />
              <button
                onClick={handleExtractFromUrl}
                disabled={isExtracting || !productUrl.trim()}
                className={[
                  'flex flex-shrink-0 items-center gap-1 rounded-lg px-3 py-2 text-xs font-medium transition-all',
                  isExtracting || !productUrl.trim()
                    ? 'cursor-not-allowed bg-gray-200 text-gray-400'
                    : 'bg-indigo-600 text-white hover:bg-indigo-500 active:scale-95',
                ].join(' ')}
              >
                {isExtracting ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <ExternalLink size={12} />
                )}
              </button>
            </div>

            {/* 구분선 */}
            <div className="my-3 flex items-center gap-2">
              <div className="h-px flex-1 bg-gray-200" />
              <span className="text-[10px] text-gray-400">또는</span>
              <div className="h-px flex-1 bg-gray-200" />
            </div>

            {/* 스크린샷 붙여넣기 / 파일 선택 */}
            <p className="mb-1.5 text-[11px] font-medium text-gray-500">방법 2: 상세페이지 스크린샷</p>
            <div
              // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
              tabIndex={0}
              onPaste={handleExtractPaste}
              onClick={() => extractFileInputRef.current?.click()}
              className={[
                'flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-5 transition-all',
                isExtracting
                  ? 'border-indigo-300 bg-indigo-50/40'
                  : 'border-gray-300 hover:border-indigo-400 hover:bg-indigo-50/30',
              ].join(' ')}
            >
              {isExtracting ? (
                <>
                  <Loader2 size={22} className="animate-spin text-indigo-500" />
                  <p className="text-xs font-medium text-indigo-600">AI 분석 중...</p>
                </>
              ) : (
                <>
                  <ClipboardPaste size={22} className="text-gray-400" />
                  <p className="text-center text-xs text-gray-400">
                    <span className="font-semibold text-indigo-500">Ctrl+V</span>로 스크린샷 붙여넣기
                    <br />
                    또는 <span className="font-semibold text-indigo-500">클릭</span>하여 이미지 선택
                  </p>
                </>
              )}
            </div>
            <input
              ref={extractFileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleExtractFileSelect}
            />

            {/* 스크린샷 미리보기 */}
            {extractScreenshots.length > 0 && (
              <div className="mt-2 flex gap-1.5 overflow-x-auto">
                {extractScreenshots.map((s, i) => (
                  <div key={i} className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-md border border-gray-200">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.dataUrl} alt={`스크린샷 ${i + 1}`} className="h-full w-full object-cover" />
                  </div>
                ))}
              </div>
            )}

            {/* 에러 */}
            {extractError && (
              <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                {extractError}
              </p>
            )}

            <p className="mt-2 text-[10px] leading-relaxed text-gray-400">
              성분표·효능·스펙·주의사항을 AI가 자동 정리합니다
            </p>
          </>
        ) : (
          /* 추출 성공 결과 */
          <div className="rounded-lg border border-green-200 bg-green-50 p-3">
            <div className="mb-1.5 flex items-center gap-1.5">
              <CheckCircle2 size={13} className="text-green-600" />
              <span className="text-xs font-semibold text-green-700">추출 완료</span>
              <button
                onClick={() => {
                  setProductExtract(null);
                  setProductUrl('');
                  setExtractScreenshots([]);
                  setExtractError(null);
                }}
                className="ml-auto text-gray-400 hover:text-red-400"
                title="결과 삭제"
              >
                <X size={12} />
              </button>
            </div>
            {productExtract.productName && (
              <p className="text-xs font-medium text-gray-700">{productExtract.productName}</p>
            )}
            {productExtract.keyFeatures && productExtract.keyFeatures.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {productExtract.keyFeatures.slice(0, 5).map((f, i) => (
                  <span key={i} className="rounded-md bg-white px-1.5 py-0.5 text-[10px] text-gray-600 ring-1 ring-gray-200">
                    {f}
                  </span>
                ))}
              </div>
            )}
            {productExtract.ingredients && productExtract.ingredients.length > 0 && (
              <p className="mt-1.5 text-[10px] text-gray-500">
                성분: {productExtract.ingredients.slice(0, 5).join(', ')}
                {productExtract.ingredients.length > 5 && ` 외 ${productExtract.ingredients.length - 5}개`}
              </p>
            )}
            {productExtract.summary && (
              <p className="mt-1.5 text-[10px] leading-relaxed text-gray-600">{productExtract.summary}</p>
            )}
          </div>
        )}
      </section>

      <hr className="border-gray-200" />

      {/* ------------------------------------------------------------------ */}
      {/* 섹션 2: 제품 특징/설명 입력                                        */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-gray-500">
          <FileText size={15} />
          제품 특징 입력
        </h2>
        <textarea
          value={productDescription}
          onChange={(e) => setProductDescription(e.target.value)}
          placeholder="제품의 특징, 장점, 성분, 주요 기능 등을 자유롭게 적어주세요.&#10;&#10;예: 히알루론산 3중 복합체 함유, 무향/무색소, 민감성 피부 적합, 식약처 인증..."
          rows={5}
          className="w-full resize-none rounded-lg border border-gray-300 bg-gray-50 p-3 text-sm leading-relaxed text-gray-800 placeholder-gray-400 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50"
        />
        <p className="mt-1 text-right text-xs text-gray-400">{productDescription.length.toLocaleString()}자</p>
      </section>
      <hr className="border-gray-200" />

      {/* ------------------------------------------------------------------ */}
      {/* 섹션 3: 쿠팡 리뷰 입력                                             */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-gray-500">
          <ClipboardPaste size={15} />
          쿠팡 리뷰 붙여넣기
        </h2>

        <textarea
          value={reviewText}
          onChange={(e) => setReviewText(e.target.value)}
          placeholder="쿠팡 리뷰를 여기에 복사해서 붙여넣으세요.&#10;&#10;AI가 핵심 내용을 분석해 13개 프레임 카피를 자동으로 생성합니다."
          rows={8}
          className="w-full resize-none rounded-lg border border-gray-300 bg-gray-50 p-3 text-sm leading-relaxed text-gray-800 placeholder-gray-400 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50"
        />

        {/* 글자 수 표시 */}
        <p className="mt-1 text-right text-xs text-gray-400">
          {reviewText.length.toLocaleString()}자
        </p>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* AI 카피 생성 버튼 (이미지 분석 + 카피 생성 통합)                   */}
      {/* ------------------------------------------------------------------ */}
      <button
        onClick={handleGenerateCopy}
        disabled={isGenerating || reviewText.trim().length === 0}
        className={[
          'flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-all',
          isGenerating || reviewText.trim().length === 0
            ? 'cursor-not-allowed bg-gray-200 text-gray-400'
            : 'bg-red-600 text-white hover:bg-red-500 active:scale-95',
        ].join(' ')}
      >
        {generatingStep === 'analyzing' ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            이미지 분석 중... (1/2)
          </>
        ) : generatingStep === 'generating' ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            {uploadedImages.length > 0 ? '카피 생성 중... (2/2)' : '카피 생성 중...'}
          </>
        ) : (
          <>
            <Sparkles size={16} />
            AI 카피 생성 (13 프레임)
          </>
        )}
      </button>

      {/* 힌트 텍스트: 리뷰 필수, 이미지는 선택 */}
      {reviewText.trim().length === 0 && (
        <p className="mt-1 text-center text-xs text-gray-500">
          리뷰를 붙여넣고 AI 카피를 생성하세요
        </p>
      )}

      {/* 이미지 분석 실패 또는 카피 생성 오류 인라인 경고 */}
      {analyzeWarning && (
        <p className="mt-1 rounded-lg border border-yellow-300 bg-yellow-50 px-3 py-2 text-xs text-yellow-700">
          {analyzeWarning}
        </p>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* 커스텀 템플릿 추가                                                  */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-gray-500">
          <LayoutGrid size={15} />
          커스텀 템플릿
        </h2>
        <div className="flex flex-col gap-2">
          <button
            onClick={() => addCustomFrame('custom_3col')}
            className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-left text-sm font-medium text-gray-500 transition-all hover:border-gray-400 hover:text-gray-800"
          >
            <span className="text-lg">▥</span>
            <div>
              <p className="font-semibold text-gray-800">3컬럼 제품 비교</p>
              <p className="text-xs text-gray-400">라인업, 제품 비교 레이아웃</p>
            </div>
          </button>
          <button
            onClick={() => addCustomFrame('custom_gallery')}
            className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-left text-sm font-medium text-gray-500 transition-all hover:border-gray-400 hover:text-gray-800"
          >
            <span className="text-lg">⊞</span>
            <div>
              <p className="font-semibold text-gray-800">4이미지 갤러리</p>
              <p className="text-xs text-gray-400">여러 컷을 한 화면에 표시</p>
            </div>
          </button>
          <button
            onClick={() => addCustomFrame('custom_notice')}
            className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-left text-sm font-medium text-gray-500 transition-all hover:border-gray-400 hover:text-gray-800"
          >
            <span className="text-lg">📋</span>
            <div>
              <p className="font-semibold text-gray-800">공지/안내 + 배송흐름도</p>
              <p className="text-xs text-gray-400">공지 체크리스트 + 5단계 배송흐름</p>
            </div>
          </button>
          <button
            onClick={() => addCustomFrame('custom_return_notice')}
            className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-left text-sm font-medium text-gray-500 transition-all hover:border-gray-400 hover:text-gray-800"
          >
            <span className="text-lg">↩️</span>
            <div>
              <p className="font-semibold text-gray-800">반품/교환 + CS운영시간</p>
              <p className="text-xs text-gray-400">반품·교환 주의 + 운영시간 안내</p>
            </div>
          </button>
          <button
            onClick={() => addCustomFrame('custom_privacy')}
            className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-left text-sm font-medium text-gray-500 transition-all hover:border-gray-400 hover:text-gray-800"
          >
            <span className="text-lg">🔒</span>
            <div>
              <p className="font-semibold text-gray-800">개인정보 동의</p>
              <p className="text-xs text-gray-400">개인정보제공 동의 안내문</p>
            </div>
          </button>
        </div>
      </section>
    </aside>
  );
};

export default Sidebar;
