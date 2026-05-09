'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { ChevronLeft, History, X } from 'lucide-react';
import ImageDropzone from '@/components/listing/import1688/ImageDropzone';
import ClassificationGrid from '@/components/listing/import1688/ClassificationGrid';
import ResultPreview from '@/components/listing/import1688/ResultPreview';
import type { ClassifiedImage } from '@/lib/listing/import-1688-types';
import type { HistoryItem } from '@/app/api/listing/import-1688/history/route';

const C = {
  bg: '#f9f9f9',
  text: '#1a1c1c',
  textSub: '#666666',
  accent: '#be0014',
  border: '#eeeeee',
};

type Step = 'upload' | 'classify' | 'result';

export default function Import1688Page() {
  const [step, setStep] = useState<Step>('upload');
  const [classifiedImages, setClassifiedImages] = useState<ClassifiedImage[]>([]);
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [result, setResult] = useState<{ thumbnailUrl: string; detailPageHtml: string } | null>(null);
  const [classifyError, setClassifyError] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    if (!showHistory) return;
    setHistoryLoading(true);
    fetch('/api/listing/import-1688/history')
      .then((r) => r.json())
      .then((json) => setHistory(json.items ?? []))
      .catch(() => setHistory([]))
      .finally(() => setHistoryLoading(false));
  }, [showHistory]);

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
    try {
      const sessionId = crypto.randomUUID();
      const res = await fetch('/api/listing/import-1688/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: classifiedImages, thumbnailUrl, sessionId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '생성 실패');
      setResult(json);
      setStep('result');
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : '생성 중 오류가 발생했습니다.');
    } finally {
      setGenerating(false);
    }
  }

  function handleLoadHistory(item: HistoryItem) {
    setResult({ thumbnailUrl: item.thumbnailUrl, detailPageHtml: item.detailPageHtml });
    setStep('result');
    setShowHistory(false);
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg }}>
      {/* 헤더 */}
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
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 8, fontSize: 13 }}>
            {(['upload', 'classify', 'result'] as Step[]).map((s, i) => (
              <span key={s} style={{ color: step === s ? C.accent : C.textSub, fontWeight: step === s ? 700 : 400 }}>
                {i + 1}. {s === 'upload' ? '업로드' : s === 'classify' ? '분류확인' : '결과'}
              </span>
            ))}
          </div>
          <button
            onClick={() => setShowHistory((v) => !v)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '6px 12px', borderRadius: 6,
              border: `1px solid ${C.border}`,
              background: showHistory ? '#f3f4f6' : '#fff',
              color: C.text, fontSize: 13, cursor: 'pointer',
            }}
          >
            <History size={14} />
            이전 결과
          </button>
        </div>
      </div>

      {/* 이전 결과 패널 */}
      {showHistory && (
        <div style={{
          background: '#fff', borderBottom: `1px solid ${C.border}`,
          padding: '16px 24px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>이전 생성 결과</span>
            <button onClick={() => setShowHistory(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textSub }}>
              <X size={16} />
            </button>
          </div>
          {historyLoading ? (
            <p style={{ fontSize: 13, color: C.textSub, margin: 0 }}>불러오는 중...</p>
          ) : history.length === 0 ? (
            <p style={{ fontSize: 13, color: C.textSub, margin: 0 }}>저장된 결과가 없습니다.</p>
          ) : (
            <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4 }}>
              {history.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleLoadHistory(item)}
                  style={{
                    flexShrink: 0, width: 100, border: `1px solid ${C.border}`,
                    borderRadius: 8, background: '#fff', cursor: 'pointer', padding: 0,
                    overflow: 'hidden', textAlign: 'left',
                  }}
                >
                  {item.thumbnailUrl ? (
                    <img src={item.thumbnailUrl} alt="썸네일" style={{ width: '100%', height: 100, objectFit: 'cover', display: 'block' }} />
                  ) : (
                    <div style={{ width: '100%', height: 100, background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ fontSize: 11, color: C.textSub }}>이미지 없음</span>
                    </div>
                  )}
                  <div style={{ padding: '6px 8px', fontSize: 11, color: C.textSub }}>
                    {new Date(item.createdAt).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 단계별 콘텐츠 */}
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

      {step === 'result' && result && (
        <ResultPreview
          thumbnailUrl={result.thumbnailUrl}
          detailPageHtml={result.detailPageHtml}
        />
      )}
    </div>
  );
}
