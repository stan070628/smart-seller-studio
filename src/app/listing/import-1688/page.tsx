'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import ImageDropzone from '@/components/listing/import1688/ImageDropzone';
import ClassificationGrid from '@/components/listing/import1688/ClassificationGrid';
import ResultPreview from '@/components/listing/import1688/ResultPreview';
import type {
  ClassifiedImage,
  TranslatedImage,
} from '@/lib/listing/import-1688-types';

const C = {
  bg: '#f9f9f9',
  text: '#1a1c1c',
  textSub: '#666666',
  accent: '#be0014',
  border: '#eeeeee',
};

type Step = 'upload' | 'classify' | 'translating' | 'result';

export default function Import1688Page() {
  const [step, setStep] = useState<Step>('upload');
  const [classifiedImages, setClassifiedImages] = useState<ClassifiedImage[]>([]);
  const [translatedImages, setTranslatedImages] = useState<TranslatedImage[]>([]);
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [result, setResult] = useState<{ thumbnailUrl: string; detailPageHtml: string } | null>(null);
  const [classifyError, setClassifyError] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  async function handleUploaded(urls: string[]) {
    setClassifyError(null);
    try {
      const res = await fetch('/api/listing/import-1688/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrls: urls }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '분류 실패');

      const images: ClassifiedImage[] = json.images;
      setClassifiedImages(images);

      const mainProduct = images.find((img) => img.type === 'main_product');
      setThumbnailUrl(mainProduct?.url ?? images[0]?.url ?? '');
      setStep('classify');
    } catch (err) {
      setClassifyError(err instanceof Error ? err.message : '분류 중 오류가 발생했습니다.');
    }
  }

  async function handleGenerate() {
    setGenerating(true);
    setGenerateError(null);
    try {
      // 1. 이미지 번역 (lifestyle 제외)
      setStep('translating');
      const transRes = await fetch('/api/listing/import-1688/translate-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: classifiedImages }),
      });
      const transJson = await transRes.json();
      if (!transRes.ok) throw new Error(transJson.error ?? '이미지 번역 실패');

      const translated: TranslatedImage[] = transJson.images;
      setTranslatedImages(translated);

      // 2. 한국어 콘텐츠 생성 (translatedUrl 포함하여 generate에 전달)
      const sessionId = crypto.randomUUID();
      const res = await fetch('/api/listing/import-1688/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images: translated.map((t) => ({
            url: t.url,
            type: t.type,
            translatedUrl: t.translatedUrl,
          })),
          thumbnailUrl,
          sessionId,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '생성 실패');
      setResult(json);
      setStep('result');
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : '생성 중 오류가 발생했습니다.');
      setStep('classify');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg }}>
      <div style={{
        padding: '16px 24px', background: '#fff',
        borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <Link href="/listing" style={{ color: C.textSub, display: 'flex', alignItems: 'center' }}>
          <ChevronLeft size={20} />
        </Link>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.text }}>
          1688에서 가져오기
        </h1>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, fontSize: 13 }}>
          {(['upload', 'classify', 'translating', 'result'] as Step[]).map((s, i) => (
            <span key={s} style={{ color: step === s ? C.accent : C.textSub, fontWeight: step === s ? 700 : 400 }}>
              {i + 1}.{' '}
              {s === 'upload'
                ? '업로드'
                : s === 'classify'
                  ? '분류확인'
                  : s === 'translating'
                    ? '번역 중'
                    : '결과'}
            </span>
          ))}
        </div>
      </div>

      {step === 'upload' && (
        <>
          <ImageDropzone onUploaded={handleUploaded} />
          {classifyError && (
            <p style={{ textAlign: 'center', color: C.accent, fontSize: 13 }}>{classifyError}</p>
          )}
        </>
      )}

      {step === 'classify' && (
        <>
          {generateError && (
            <p style={{ textAlign: 'center', color: C.accent, fontSize: 13, margin: '12px 0 0' }}>{generateError}</p>
          )}
          <ClassificationGrid
          images={classifiedImages}
          thumbnailUrl={thumbnailUrl}
          onThumbnailChange={setThumbnailUrl}
          onGenerate={handleGenerate}
          generating={generating}
        />
        </>
      )}

      {step === 'translating' && (
        <div style={{ padding: '64px 20px', textAlign: 'center', color: C.textSub }}>
          <p style={{ fontSize: 16, fontWeight: 600, color: C.text, margin: '0 0 8px' }}>
            이미지 번역 중...
          </p>
          <p style={{ fontSize: 13, margin: 0 }}>
            중국어 텍스트를 한국어로 변환하고 있습니다 (이미지당 1.5~3초).
          </p>
        </div>
      )}

      {step === 'result' && result && (
        <ResultPreview
          thumbnailUrl={result.thumbnailUrl}
          detailPageHtml={result.detailPageHtml}
          translatedImages={translatedImages}
        />
      )}
    </div>
  );
}
