'use client';

/**
 * LabelReader
 * 라벨·태그 사진을 올리면 읽어서 판매 포인트와 고시정보 초안을 만든다.
 *
 * 왜 "적용" 버튼을 따로 두는가: 판독 결과를 Key points에 자동으로 밀어 넣지 않는다.
 * 셀러가 사진과 대조한 뒤 넣을지 정해야 한다 — 라벨에 없는 값을 모델이 지어내면
 * 표시광고법 책임은 판매자에게 간다. 원문(raw)을 함께 보여주는 것도 같은 이유다.
 */

import { useState, useRef } from 'react';
import type { LabelReading, NoticeDraft } from '@/lib/detail-page/label-reading';

interface ReadResult {
  reading: LabelReading;
  keyPoints: string[];
  notice: NoticeDraft;
  readCount: number;
}

const MAX_IMAGES = 6;

/** 파일 → 다운스케일 base64 (Vision 토큰 절감) */
async function toBase64(file: File): Promise<{ base64: string; mimeType: 'image/jpeg' }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
  return { base64: dataUrl.split(',')[1]!, mimeType: 'image/jpeg' };
}

export default function LabelReader({
  productName,
  category = '',
  onApplyKeyPoints,
}: {
  productName: string;
  category?: string;
  /** 셀러가 "판매 포인트에 넣기"를 누르면 호출 */
  onApplyKeyPoints?: (points: string[]) => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<ReadResult | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)].slice(0, MAX_IMAGES));
    setResult(null);
    setError(null);
    setWarning(null);
  }

  async function read() {
    if (files.length === 0) return;
    setLoading(true);
    setError(null);
    setWarning(null);
    try {
      const images = await Promise.all(files.map(toBase64));
      const res = await fetch('/api/ai/read-product-labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images, productName, category }),
      });
      const json = (await res.json()) as {
        success: boolean;
        data?: ReadResult;
        warning?: string;
        error?: string;
      };
      if (!json.success || !json.data) {
        setError(json.error ?? '라벨을 읽지 못했습니다.');
        return;
      }
      setResult(json.data);
      if (json.warning) setWarning(json.warning);
    } catch (e) {
      setError(e instanceof Error ? e.message : '라벨 판독 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  async function copyNotice() {
    if (!result) return;
    const n = result.notice;
    const text = [
      `제품 소재\n${n.material}`,
      `제조국\n${n.origin}`,
      `제조자(수입자)\n${n.manufacturer}`,
      `세탁방법 및 취급시 주의사항\n${n.careInstructions}`,
    ].join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* 화면에 이미 보이므로 조용히 넘어간다 */
    }
  }

  const box = { border: '1px solid #374151', borderRadius: 8, background: '#1a1a28' };
  const btn = {
    padding: '9px 12px',
    background: '#252538',
    border: '1px solid #374151',
    borderRadius: 6,
    color: '#cbd5e1',
    cursor: 'pointer',
    fontSize: 12,
  };

  return (
    <div style={{ ...box, marginBottom: 20, padding: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', marginBottom: 6 }}>
        🔍 라벨 사진에서 정보 읽기
      </div>
      <p style={{ fontSize: 11.5, color: '#9ca3af', lineHeight: 1.6, margin: '0 0 12px' }}>
        케어라벨·행택 사진을 올리면 <strong style={{ color: '#cbd5e1' }}>소재·제조국·수입자·기능</strong>을
        읽어 고시정보 초안과 판매 포인트를 만듭니다.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => addFiles(e.target.files)}
        style={{ display: 'none' }}
      />
      <div style={{ display: 'flex', gap: 8, marginBottom: files.length ? 10 : 0 }}>
        <button type="button" onClick={() => inputRef.current?.click()} style={{ ...btn, flex: 1 }}>
          라벨 사진 선택 ({files.length}/{MAX_IMAGES})
        </button>
        <button
          type="button"
          onClick={read}
          disabled={files.length === 0 || loading}
          style={{
            ...btn,
            flex: 1,
            background: files.length && !loading ? '#2563eb' : '#252538',
            color: files.length && !loading ? '#fff' : '#6b7280',
            cursor: files.length && !loading ? 'pointer' : 'not-allowed',
          }}
        >
          {loading ? '읽는 중...' : '읽기'}
        </button>
      </div>

      {files.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {files.map((f, i) => (
            <span key={`${f.name}-${i}`} style={{ fontSize: 11, color: '#9ca3af' }}>
              [{i}] {f.name.slice(0, 18)}
            </span>
          ))}
          <button
            type="button"
            onClick={() => { setFiles([]); setResult(null); }}
            style={{ ...btn, padding: '2px 8px', fontSize: 11 }}
          >
            비우기
          </button>
        </div>
      )}

      {error && (
        <div style={{ fontSize: 11.5, color: '#fca5a5', lineHeight: 1.6, marginTop: 8 }}>{error}</div>
      )}
      {warning && (
        <div style={{ fontSize: 11.5, color: '#fbbf24', lineHeight: 1.6, marginTop: 8 }}>{warning}</div>
      )}

      {result && result.readCount > 0 && (
        <div style={{ marginTop: 12, borderTop: '1px solid #2a2a3a', paddingTop: 12 }}>
          <div style={{ fontSize: 12, color: '#7dd3fc', marginBottom: 10 }}>
            {result.readCount}개 항목을 읽었습니다
          </div>

          <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0', marginBottom: 6 }}>
            고시정보 초안
          </div>
          {([
            ['제품 소재', result.notice.material],
            ['제조국', result.notice.origin],
            ['제조자(수입자)', result.notice.manufacturer],
            ['세탁·취급', result.notice.careInstructions],
          ] as const).map(([k, v]) => (
            <div key={k} style={{ fontSize: 11.5, lineHeight: 1.6, marginBottom: 4 }}>
              <span style={{ color: '#9ca3af' }}>{k}: </span>
              <span style={{ color: v ? '#e2e8f0' : '#6b7280' }}>{v || '읽지 못함'}</span>
            </div>
          ))}
          <button type="button" onClick={copyNotice} style={{ ...btn, width: '100%', marginTop: 8 }}>
            {copied ? '복사했습니다' : '고시정보 복사'}
          </button>

          {result.keyPoints.length > 0 && (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0', margin: '14px 0 6px' }}>
                판매 포인트 후보 {result.keyPoints.length}개
              </div>
              {result.keyPoints.map((p) => (
                <div key={p} style={{ fontSize: 11.5, color: '#cbd5e1', lineHeight: 1.7 }}>· {p}</div>
              ))}
              {onApplyKeyPoints && (
                <button
                  type="button"
                  onClick={() => onApplyKeyPoints(result.keyPoints)}
                  style={{ ...btn, width: '100%', marginTop: 8 }}
                >
                  핵심 판매 포인트에 추가
                </button>
              )}
            </>
          )}

          {result.reading.certifications.length > 0 && (
            <div style={{ marginTop: 12, fontSize: 11, color: '#9ca3af', lineHeight: 1.6 }}>
              <div style={{ fontWeight: 700, marginBottom: 3 }}>인증·라이선스 (참고)</div>
              {result.reading.certifications.map((c) => (
                <div key={c.raw}>· {c.value}</div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 12, fontSize: 11, color: '#fbbf24', lineHeight: 1.6 }}>
            ⚠️ 사진과 대조해 확인한 뒤 사용하세요. 라벨에 없는 값은 넣지 않았습니다.
          </div>
        </div>
      )}
    </div>
  );
}
