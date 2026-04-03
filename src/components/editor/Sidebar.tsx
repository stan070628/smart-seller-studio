'use client';

/**
 * Sidebar.tsx
 * 좌측 사이드바 컴포넌트
 *
 * 포함 기능:
 *  1. 다중 이미지 업로드 (드래그 앤 드롭 + 파일 선택)
 *  2. Supabase Storage 백그라운드 업로드 (fire-and-forget)
 *  3. 이미지 AI 분석 (Gemini Vision)
 *  4. 쿠팡 리뷰 복사/붙여넣기용 Textarea
 *  5. AI 카피 생성 버튼 (/api/ai/generate-frames 호출)
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
  <div className="group relative flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 p-2">
    {/* 썸네일 */}
    <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-md bg-zinc-700">
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
      <p className="truncate text-xs font-medium text-zinc-200">{image.name}</p>
      <p className="text-xs text-zinc-500">{formatFileSize(image.size)}</p>
    </div>

    {/* 삭제 버튼 */}
    <button
      onClick={() => onRemove(image.id)}
      className="flex-shrink-0 rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-700 hover:text-red-400"
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
  const isAnalyzing = useEditorStore((s) => s.isAnalyzing);

  const productDescription = useEditorStore((s) => s.productDescription);

  const addImage = useEditorStore((s) => s.addImage);
  const removeImage = useEditorStore((s) => s.removeImage);
  const updateImageStatus = useEditorStore((s) => s.updateImageStatus);
  const setReviewText = useEditorStore((s) => s.setReviewText);
  const setProductDescription = useEditorStore((s) => s.setProductDescription);
  const setFrames = useEditorStore((s) => s.setFrames);
  const setIsGenerating = useEditorStore((s) => s.setIsGenerating);
  const setImageAnalysis = useEditorStore((s) => s.setImageAnalysis);
  const setIsAnalyzing = useEditorStore((s) => s.setIsAnalyzing);
  const theme = useEditorStore((s) => s.theme);
  const setTheme = useEditorStore((s) => s.setTheme);
  const addCustomFrame = useEditorStore((s) => s.addCustomFrame);

  // 드래그 오버 상태 (업로드 영역 하이라이트)
  const [isDragOver, setIsDragOver] = useState(false);

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

  const handleAnalyzeImage = async () => {
    if (uploadedImages.length === 0) return;
    setIsAnalyzing(true);
    try {
      // 모든 이미지를 압축 후 base64로 변환 (최대 5장)
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
        })
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
        window.alert(`이미지 분석에 실패했습니다: ${json.error ?? '알 수 없는 오류'}`);
        return;
      }

      setImageAnalysis(json.data);
    } catch (err) {
      window.alert(
        `이미지 분석 중 오류가 발생했습니다: ${err instanceof Error ? err.message : '알 수 없는 오류'}`,
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  // -----------------------------------------------------------------------
  // AI 카피 생성 (/api/ai/generate-frames 호출)
  // -----------------------------------------------------------------------
  const handleGenerateCopy = async () => {
    if (isGenerating) return;
    setIsGenerating(true);

    try {
      const reviews = reviewText
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .slice(0, 50);

      const res = await fetch('/api/ai/generate-frames', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviews,
          imageAnalysis: imageAnalysis ?? undefined,
          productDescription: productDescription.trim() || undefined,
        }),
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        window.alert(
          `카피 생성에 실패했습니다: ${json.error ?? '다시 시도해주세요.'}`,
        );
        return;
      }

      setFrames(json.data.frames);
    } catch {
      window.alert('카피 생성에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setIsGenerating(false);
    }
  };

  // -----------------------------------------------------------------------
  // 렌더
  // -----------------------------------------------------------------------
  return (
    <aside className="flex h-full w-80 flex-shrink-0 flex-col gap-5 overflow-y-auto border-r border-zinc-700 bg-zinc-900 p-4">
      {/* ------------------------------------------------------------------ */}
      {/* 카테고리 선택                                                        */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-zinc-400">
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
                  ? 'border-indigo-500 bg-indigo-950/60 text-white'
                  : 'border-zinc-700 bg-zinc-800/50 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200',
              ].join(' ')}
            >
              <span className="text-lg">{t.emoji}</span>
              <span>{t.label}</span>
              {theme.key === t.key && (
                <span className="ml-auto text-xs text-indigo-400">선택됨</span>
              )}
            </button>
          ))}
        </div>
      </section>

      <hr className="border-zinc-700" />

      {/* ------------------------------------------------------------------ */}
      {/* 섹션 1: 이미지 업로드                                               */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-zinc-400">
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
              ? 'border-indigo-400 bg-indigo-950/40'
              : 'border-zinc-600 hover:border-zinc-400 hover:bg-zinc-800',
          ].join(' ')}
        >
          <ImagePlus size={28} className="text-zinc-500" />
          <p className="text-center text-xs text-zinc-500">
            이미지를 드래그하거나
            <br />
            <span className="font-semibold text-indigo-400">클릭하여 선택</span>
          </p>
          <p className="text-xs text-zinc-600">PNG, JPG, WEBP 지원</p>
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
          </div>
        )}

        {/* 이미지 AI 분석 버튼 */}
        {uploadedImages.length > 0 && (
          <button
            onClick={handleAnalyzeImage}
            disabled={isAnalyzing || uploadedImages[0].uploadStatus === 'uploading'}
            className="mt-3 w-full rounded-lg border border-purple-600 px-3 py-2 text-xs font-medium text-purple-400
                       hover:bg-purple-900/30 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
          >
            {isAnalyzing ? (
              <span className="flex items-center justify-center gap-1.5">
                <Loader2 size={12} className="animate-spin" />
                분석 중...
              </span>
            ) : (
              '이미지 AI 분석'
            )}
          </button>
        )}

        {/* 분석 결과 표시 */}
        {imageAnalysis && (
          <div className="mt-3 rounded-lg bg-purple-950/40 border border-purple-800/50 p-3 space-y-2">
            <p className="text-xs font-semibold text-purple-300">이미지 분석 결과</p>
            <div className="text-xs text-zinc-300 space-y-1">
              <p>
                <span className="text-zinc-500">소재:</span> {imageAnalysis.material}
              </p>
              <p>
                <span className="text-zinc-500">형태:</span> {imageAnalysis.shape}
              </p>
              <div className="flex flex-wrap gap-1">
                {imageAnalysis.colors.map((c) => (
                  <span
                    key={c}
                    className="rounded-full bg-zinc-700 px-2 py-0.5 text-zinc-300"
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 구분선 */}
      <hr className="border-zinc-700" />

      {/* ------------------------------------------------------------------ */}
      {/* 섹션 2: 제품 특징/설명 입력                                        */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-zinc-400">
          <FileText size={15} />
          제품 특징 입력
        </h2>
        <textarea
          value={productDescription}
          onChange={(e) => setProductDescription(e.target.value)}
          placeholder="제품의 특징, 장점, 성분, 주요 기능 등을 자유롭게 적어주세요.&#10;&#10;예: 히알루론산 3중 복합체 함유, 무향/무색소, 민감성 피부 적합, 식약처 인증..."
          rows={5}
          className="w-full resize-none rounded-lg border border-zinc-600 bg-zinc-800 p-3 text-sm leading-relaxed text-zinc-200 placeholder-zinc-600 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50"
        />
        <p className="mt-1 text-right text-xs text-zinc-600">{productDescription.length.toLocaleString()}자</p>
      </section>
      <hr className="border-zinc-700" />

      {/* ------------------------------------------------------------------ */}
      {/* 섹션 3: 쿠팡 리뷰 입력                                             */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-zinc-400">
          <ClipboardPaste size={15} />
          쿠팡 리뷰 붙여넣기
        </h2>

        <textarea
          value={reviewText}
          onChange={(e) => setReviewText(e.target.value)}
          placeholder="쿠팡 리뷰를 여기에 복사해서 붙여넣으세요.&#10;&#10;AI가 핵심 내용을 분석해 13개 프레임 카피를 자동으로 생성합니다."
          rows={8}
          className="w-full resize-none rounded-lg border border-zinc-600 bg-zinc-800 p-3 text-sm leading-relaxed text-zinc-200 placeholder-zinc-600 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50"
        />

        {/* 글자 수 표시 */}
        <p className="mt-1 text-right text-xs text-zinc-600">
          {reviewText.length.toLocaleString()}자
        </p>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* AI 카피 생성 버튼                                                   */}
      {/* ------------------------------------------------------------------ */}
      <button
        onClick={handleGenerateCopy}
        disabled={isGenerating || reviewText.trim().length === 0}
        className={[
          'flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-all',
          isGenerating || reviewText.trim().length === 0
            ? 'cursor-not-allowed bg-zinc-700 text-zinc-500'
            : 'bg-indigo-600 text-white hover:bg-indigo-500 active:scale-95',
        ].join(' ')}
      >
        {isGenerating ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            AI 분석 중...
          </>
        ) : (
          <>
            <Sparkles size={16} />
            AI 카피 생성 (13 프레임)
          </>
        )}
      </button>

      {reviewText.trim().length === 0 && (
        <p className="mt-1 text-center text-xs text-zinc-600">
          리뷰를 먼저 붙여넣어야 생성할 수 있습니다
        </p>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* 커스텀 템플릿 추가                                                  */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-zinc-400">
          <LayoutGrid size={15} />
          커스텀 템플릿
        </h2>
        <div className="flex flex-col gap-2">
          <button
            onClick={() => addCustomFrame('custom_3col')}
            className="flex items-center gap-3 rounded-xl border border-zinc-700 bg-zinc-800/50 px-4 py-3 text-left text-sm font-medium text-zinc-400 transition-all hover:border-zinc-500 hover:text-zinc-200"
          >
            <span className="text-lg">▥</span>
            <div>
              <p className="font-semibold text-zinc-200">3컬럼 제품 비교</p>
              <p className="text-xs text-zinc-500">라인업, 제품 비교 레이아웃</p>
            </div>
          </button>
          <button
            onClick={() => addCustomFrame('custom_gallery')}
            className="flex items-center gap-3 rounded-xl border border-zinc-700 bg-zinc-800/50 px-4 py-3 text-left text-sm font-medium text-zinc-400 transition-all hover:border-zinc-500 hover:text-zinc-200"
          >
            <span className="text-lg">⊞</span>
            <div>
              <p className="font-semibold text-zinc-200">4이미지 갤러리</p>
              <p className="text-xs text-zinc-500">여러 컷을 한 화면에 표시</p>
            </div>
          </button>
          <button
            onClick={() => addCustomFrame('custom_notice')}
            className="flex items-center gap-3 rounded-xl border border-zinc-700 bg-zinc-800/50 px-4 py-3 text-left text-sm font-medium text-zinc-400 transition-all hover:border-zinc-500 hover:text-zinc-200"
          >
            <span className="text-lg">📋</span>
            <div>
              <p className="font-semibold text-zinc-200">공지/안내 + 배송흐름도</p>
              <p className="text-xs text-zinc-500">공지 체크리스트 + 5단계 배송흐름</p>
            </div>
          </button>
          <button
            onClick={() => addCustomFrame('custom_return_notice')}
            className="flex items-center gap-3 rounded-xl border border-zinc-700 bg-zinc-800/50 px-4 py-3 text-left text-sm font-medium text-zinc-400 transition-all hover:border-zinc-500 hover:text-zinc-200"
          >
            <span className="text-lg">↩️</span>
            <div>
              <p className="font-semibold text-zinc-200">반품/교환 + CS운영시간</p>
              <p className="text-xs text-zinc-500">반품·교환 주의 + 운영시간 안내</p>
            </div>
          </button>
          <button
            onClick={() => addCustomFrame('custom_privacy')}
            className="flex items-center gap-3 rounded-xl border border-zinc-700 bg-zinc-800/50 px-4 py-3 text-left text-sm font-medium text-zinc-400 transition-all hover:border-zinc-500 hover:text-zinc-200"
          >
            <span className="text-lg">🔒</span>
            <div>
              <p className="font-semibold text-zinc-200">개인정보 동의</p>
              <p className="text-xs text-zinc-500">개인정보제공 동의 안내문</p>
            </div>
          </button>
        </div>
      </section>
    </aside>
  );
};

export default Sidebar;
