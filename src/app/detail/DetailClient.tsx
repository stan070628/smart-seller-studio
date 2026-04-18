'use client';

import React, { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import { Upload, X, Download, Copy, Loader2, CheckCheck, AlertCircle } from 'lucide-react';

// ---------------------------------------------------------------------------
// 타입
// ---------------------------------------------------------------------------

interface UploadedImage {
  id: string;
  url: string;
  name: string;
  size: number;
  file: File;
}

// ---------------------------------------------------------------------------
// 유틸
// ---------------------------------------------------------------------------

const generateId = (): string =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const readFileAsDataURL = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const compressImage = (dataUrl: string, maxDimension = 1280, quality = 0.8): Promise<string> =>
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

// ---------------------------------------------------------------------------
// 서브 컴포넌트: 썸네일 카드
// ---------------------------------------------------------------------------

interface ThumbnailCardProps {
  image: UploadedImage;
  onRemove: (id: string) => void;
}

const ThumbnailCard: React.FC<ThumbnailCardProps> = ({ image, onRemove }) => (
  <div className="group relative overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img
      src={image.url}
      alt={image.name}
      className="h-24 w-full object-cover"
    />
    <button
      onClick={() => onRemove(image.id)}
      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/80"
      title="삭제"
    >
      <X size={11} />
    </button>
    <div className="px-2 py-1.5">
      <p className="truncate text-xs font-medium text-gray-700">{image.name}</p>
      <p className="text-[10px] text-gray-400">{formatFileSize(image.size)}</p>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// 메인 컴포넌트
// ---------------------------------------------------------------------------

const DetailClient: React.FC = () => {
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [productName, setProductName] = useState('');
  const [price, setPrice] = useState('');

  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedHtml, setGeneratedHtml] = useState<string | null>(null);
  const [generatedSnippet, setGeneratedSnippet] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [snippetCopied, setSnippetCopied] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const MAX_IMAGES = 5;

  // -------------------------------------------------------------------------
  // 이미지 처리
  // -------------------------------------------------------------------------

  const processFiles = useCallback(
    (files: FileList | File[]) => {
      const remaining = MAX_IMAGES - images.length;
      if (remaining <= 0) return;

      const fileArr = Array.from(files)
        .filter((f) => f.type.match(/^image\/(jpeg|png|webp)$/))
        .slice(0, remaining);

      const newImages: UploadedImage[] = fileArr.map((file) => ({
        id: generateId(),
        url: URL.createObjectURL(file),
        name: file.name,
        size: file.size,
        file,
      }));

      setImages((prev) => [...prev, ...newImages]);
    },
    [images.length],
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) processFiles(e.target.files);
    e.target.value = '';
  };

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

  const removeImage = (id: string) => {
    setImages((prev) => {
      const target = prev.find((img) => img.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((img) => img.id !== id);
    });
  };

  // -------------------------------------------------------------------------
  // AI 상세 페이지 생성
  // -------------------------------------------------------------------------

  const handleGenerate = async () => {
    if (images.length === 0 || isGenerating) return;

    setError(null);
    setIsGenerating(true);
    setGeneratedHtml(null);

    try {
      const imagePayloads = await Promise.all(
        images.map(async (img) => {
          const dataUrl = await readFileAsDataURL(img.file);
          const compressed = await compressImage(dataUrl);
          return {
            imageBase64: compressed,
            mimeType: 'image/jpeg' as const,
          };
        }),
      );

      const res = await fetch('/api/ai/generate-detail-html', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images: imagePayloads,
          productName: productName.trim() || undefined,
          price: price.trim() ? parseInt(price.trim(), 10) : undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.html) {
        setError(data.error ?? '생성에 실패했습니다. 다시 시도해주세요.');
        return;
      }

      setGeneratedHtml(data.html);
      setGeneratedSnippet(data.snippet ?? null);
    } catch {
      setError('네트워크 오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
      setIsGenerating(false);
    }
  };

  // -------------------------------------------------------------------------
  // 다운로드 / 복사
  // -------------------------------------------------------------------------

  const handleDownload = () => {
    if (!generatedHtml) return;
    const blob = new Blob([generatedHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = productName.trim()
      ? productName.trim().replace(/[^a-zA-Z0-9가-힣_-]/g, '_').slice(0, 40)
      : 'detail-page';
    a.download = `${safeName}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopy = async () => {
    if (!generatedHtml) return;
    try {
      await navigator.clipboard.writeText(generatedHtml);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('클립보드 복사에 실패했습니다.');
    }
  };

  const handleSnippetCopy = async () => {
    if (!generatedSnippet) return;
    try {
      await navigator.clipboard.writeText(generatedSnippet);
      setSnippetCopied(true);
      setTimeout(() => setSnippetCopied(false), 2000);
    } catch {
      setError('클립보드 복사에 실패했습니다.');
    }
  };

  // -------------------------------------------------------------------------
  // 렌더
  // -------------------------------------------------------------------------

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {/* 헤더 */}
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '56px', padding: '0 24px', backgroundColor: '#fff', borderBottom: '1px solid #e5e5e5' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Link href="/dashboard" style={{ textDecoration: 'none', fontSize: '14px', fontWeight: 700, color: '#18181b', letterSpacing: '-0.3px' }}>
            Smart<span style={{ color: '#be0014' }}>Seller</span>Studio
          </Link>
          <span style={{ backgroundColor: 'rgba(190,0,20,0.07)', color: '#be0014', fontSize: '11px', fontWeight: 600, padding: '2px 9px', borderRadius: '100px', border: '1px solid rgba(190,0,20,0.2)' }}>
            Beta
          </span>
        </div>
        <nav style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {[
            { href: '/dashboard', label: '대시보드' },
            { href: '/sourcing', label: '소싱' },
            { href: '/editor', label: '에디터' },
            { href: '/detail', label: '상세페이지', active: true },
            { href: '/listing', label: '상품등록' },
            { href: '/orders', label: '주문/매출' },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              style={{
                padding: '5px 12px',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: item.active ? 600 : 500,
                color: item.active ? '#be0014' : '#71717a',
                textDecoration: 'none',
                backgroundColor: item.active ? 'rgba(190,0,20,0.07)' : 'transparent',
                border: item.active ? '1px solid rgba(190,0,20,0.15)' : '1px solid transparent',
              }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      {/* 본문 */}
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 md:flex-row md:items-start">

        {/* ---------------------------------------------------------------- */}
        {/* 좌측: 입력 패널                                                   */}
        {/* ---------------------------------------------------------------- */}
        <section className="flex w-full flex-col gap-5 md:w-96 md:flex-shrink-0">

          {/* 이미지 업로드 */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-gray-700">상품 사진</h2>

            {/* 드롭 존 */}
            {images.length < MAX_IMAGES && (
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={[
                  'flex cursor-pointer flex-col items-center justify-center gap-2.5 rounded-xl border-2 border-dashed px-4 py-8 transition-all',
                  isDragOver
                    ? 'border-red-400 bg-red-50/50'
                    : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50',
                ].join(' ')}
              >
                <Upload size={26} className="text-gray-400" />
                <div className="text-center">
                  <p className="text-sm text-gray-500">
                    드래그하거나{' '}
                    <span className="font-semibold text-red-600">클릭하여 선택</span>
                  </p>
                  <p className="mt-0.5 text-xs text-gray-400">
                    JPEG, PNG, WEBP — 최대 {MAX_IMAGES}장
                  </p>
                </div>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />

            {/* 썸네일 그리드 */}
            {images.length > 0 && (
              <div className={['grid gap-2', images.length < MAX_IMAGES ? 'mt-3' : ''].join(' ')}>
                <div className="grid grid-cols-3 gap-2">
                  {images.map((img) => (
                    <ThumbnailCard key={img.id} image={img} onRemove={removeImage} />
                  ))}
                </div>
                <p className="text-right text-xs text-gray-400">
                  {images.length} / {MAX_IMAGES}장
                </p>
              </div>
            )}
          </div>

          {/* 상품 정보 */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-gray-700">상품 정보 (선택)</h2>

            <div className="flex flex-col gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">상품명</label>
                <input
                  type="text"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  placeholder="입력하면 카피 품질이 높아져요"
                  className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-800 placeholder-gray-400 outline-none transition-colors focus:border-red-400 focus:ring-1 focus:ring-red-400/40"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">판매가</label>
                <div className="relative">
                  <input
                    type="number"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="0"
                    min={0}
                    className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 pr-8 text-sm text-gray-800 placeholder-gray-400 outline-none transition-colors focus:border-red-400 focus:ring-1 focus:ring-red-400/40"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">원</span>
                </div>
              </div>
            </div>
          </div>

          {/* 에러 */}
          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* 생성 버튼 */}
          <button
            onClick={handleGenerate}
            disabled={images.length === 0 || isGenerating}
            className={[
              'flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3.5 text-sm font-semibold transition-all',
              images.length === 0 || isGenerating
                ? 'cursor-not-allowed bg-gray-200 text-gray-400'
                : 'bg-gray-900 text-white hover:bg-gray-700 active:scale-[0.98]',
            ].join(' ')}
          >
            {isGenerating ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                AI가 상세 페이지를 만들고 있어요...
              </>
            ) : (
              '상세 페이지 생성하기'
            )}
          </button>

          {images.length === 0 && (
            <p className="text-center text-xs text-gray-400">사진을 1장 이상 업로드해야 생성할 수 있어요</p>
          )}
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* 우측: 미리보기 패널                                               */}
        {/* ---------------------------------------------------------------- */}
        <section className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
            {/* 패널 헤더 */}
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
              <h2 className="text-sm font-semibold text-gray-700">미리보기</h2>
              {generatedHtml && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-600 transition-all hover:border-gray-300 hover:bg-gray-100 active:scale-95"
                  >
                    {copied ? (
                      <>
                        <CheckCheck size={13} className="text-green-500" />
                        복사됨
                      </>
                    ) : (
                      <>
                        <Copy size={13} />
                        클립보드 복사
                      </>
                    )}
                  </button>
                  <button
                    onClick={handleDownload}
                    className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white transition-all hover:bg-gray-700 active:scale-95"
                  >
                    <Download size={13} />
                    HTML 다운로드
                  </button>
                </div>
              )}
            </div>

            {/* 미리보기 영역 */}
            {generatedHtml ? (
              <iframe
                srcDoc={generatedHtml}
                title="상세 페이지 미리보기"
                className="w-full rounded-b-xl"
                style={{ height: 600, border: 'none' }}
                sandbox="allow-same-origin"
              />
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 rounded-b-xl border-2 border-dashed border-gray-200 bg-gray-50/50 py-24">
                {isGenerating ? (
                  <>
                    <Loader2 size={32} className="animate-spin text-gray-400" />
                    <p className="text-sm font-medium text-gray-500">
                      AI가 상세 페이지를 만들고 있어요...
                    </p>
                    <p className="text-xs text-gray-400">이미지 수에 따라 20~40초 소요될 수 있어요</p>
                  </>
                ) : (
                  <>
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100">
                      <Upload size={28} className="text-gray-300" />
                    </div>
                    <p className="text-sm text-gray-500">
                      사진을 업로드하고 생성 버튼을 눌러주세요
                    </p>
                    <p className="text-xs text-gray-400">
                      AI가 사진을 분석해 HTML 상세 페이지를 자동 완성합니다
                    </p>
                  </>
                )}
              </div>
            )}
          </div>

          {/* 쿠팡 붙여넣기용 HTML 코드 */}
          {generatedSnippet && (
            <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
                <div>
                  <h2 className="text-sm font-semibold text-gray-700">쿠팡 상세 페이지 HTML 코드</h2>
                  <p className="mt-0.5 text-xs text-gray-400">아래 코드를 복사해 쿠팡 상품 등록 &gt; 상세 설명 HTML 에디터에 붙여넣으세요</p>
                </div>
                <button
                  onClick={handleSnippetCopy}
                  className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white transition-all hover:bg-gray-700 active:scale-95"
                >
                  {snippetCopied ? (
                    <>
                      <CheckCheck size={13} className="text-green-400" />
                      복사됨
                    </>
                  ) : (
                    <>
                      <Copy size={13} />
                      코드 복사
                    </>
                  )}
                </button>
              </div>
              <textarea
                readOnly
                value={generatedSnippet}
                className="w-full resize-none rounded-b-xl bg-gray-950 p-4 font-mono text-xs text-green-400 outline-none"
                style={{ height: 240 }}
              />
            </div>
          )}
        </section>
      </main>
    </div>
  );
};

export default DetailClient;
