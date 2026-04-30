'use client';

import React, { useRef, useState } from 'react';
import { Sparkles, CheckCheck, AlertCircle, Loader2 } from 'lucide-react';
import { useListingStore } from '@/store/useListingStore';
import { C } from '@/lib/design-tokens';
import AiEditModal from '@/components/listing/AiEditModal';

const AI_EDIT_CHIPS = [
  '감성적인 톤으로',
  '특징 간결하게',
  '가성비 강조',
  '20대 여성 타겟',
  '선물용 문구 추가',
];

interface Props {
  onSave: () => void;
}

export default function AssetsResultPanel({ onSave }: Props) {
  const { assetsDraft, updateAssetsDraft, editAssetsDetail } = useListingStore();
  const {
    generatedThumbnails,
    generatedDetailHtml,
    detailEditStatus,
    detailEditError,
  } = assetsDraft;
  const hasResult = generatedThumbnails.length > 0 || generatedDetailHtml.length > 0;

  // 상세 HTML AI 수정 입력 + 되돌리기용 이전 HTML
  const [editInstruction, setEditInstruction] = useState('');
  const prevHtmlRef = useRef<string | null>(null);

  // 썸네일 이미지 AI 편집 모달
  const [imageEditTarget, setImageEditTarget] = useState<{ url: string; index: number } | null>(null);

  // 결과가 없을 때 안내 문구 표시
  if (!hasResult) {
    return (
      <div style={{
        padding: '40px',
        textAlign: 'center',
        color: C.textSub,
        fontSize: '13px',
        backgroundColor: C.card,
        border: `1px dashed ${C.border}`,
        borderRadius: '12px',
      }}>
        좌측에서 자산을 먼저 생성하세요.
      </div>
    );
  }

  // 개별 썸네일 다운로드
  const handleDownloadOne = (url: string, idx: number) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = `thumbnail-${idx + 1}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // 모든 자산을 ZIP으로 일괄 다운로드
  const handleDownloadZip = async () => {
    const JSZipMod = await import('jszip');
    const zip = new JSZipMod.default();
    generatedThumbnails.forEach((url, i) => {
      const base64 = url.split(',')[1] ?? '';
      zip.file(`thumbnail-${i + 1}.png`, base64, { base64: true });
    });
    if (generatedDetailHtml) {
      zip.file('detail.html', generatedDetailHtml);
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = 'assets.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objUrl);
  };

  // 상세 HTML AI 수정
  const handleAiEdit = async () => {
    if (!editInstruction.trim() || detailEditStatus === 'editing') return;
    prevHtmlRef.current = generatedDetailHtml;
    await editAssetsDetail(editInstruction.trim());
  };

  const handleUndoEdit = () => {
    if (prevHtmlRef.current === null) return;
    updateAssetsDraft({
      generatedDetailHtml: prevHtmlRef.current,
      detailEditStatus: 'idle',
      detailEditError: null,
    });
    prevHtmlRef.current = null;
    setEditInstruction('');
  };

  // 썸네일 AI 편집 결과 적용
  const handleImageEditSaved = (resultUrl: string) => {
    if (imageEditTarget === null) return;
    const next = [...generatedThumbnails];
    next[imageEditTarget.index] = resultUrl;
    updateAssetsDraft({ generatedThumbnails: next });
    setImageEditTarget(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* 썸네일 미리보기 + AI 편집 */}
      <div style={{
        backgroundColor: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: '12px',
        padding: '16px',
      }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: C.text, marginBottom: '12px' }}>
          썸네일 ({generatedThumbnails.length})
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {generatedThumbnails.map((url, i) => (
            <div key={`${url}-${i}`} style={{ position: 'relative' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={`썸네일 ${i + 1}`}
                style={{
                  width: '120px',
                  height: '120px',
                  objectFit: 'cover',
                  borderRadius: '8px',
                  border: `1px solid ${C.border}`,
                  display: 'block',
                }}
              />
              <button
                type="button"
                onClick={() => setImageEditTarget({ url, index: i })}
                title="AI로 편집"
                style={{
                  position: 'absolute', top: '4px', right: '4px',
                  display: 'flex', alignItems: 'center', gap: '3px',
                  padding: '2px 6px', fontSize: '10px', fontWeight: 600,
                  backgroundColor: '#7c3aed', color: '#fff',
                  border: 'none', borderRadius: '4px', cursor: 'pointer',
                }}
              >
                <Sparkles size={10} />AI 편집
              </button>
              <button
                type="button"
                onClick={() => handleDownloadOne(url, i)}
                style={{
                  position: 'absolute', bottom: '4px', right: '4px',
                  padding: '2px 6px', fontSize: '10px',
                  backgroundColor: 'rgba(0,0,0,0.7)', color: '#fff',
                  border: 'none', borderRadius: '4px', cursor: 'pointer',
                }}
              >
                다운로드
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 상세 HTML iframe 미리보기 */}
      {generatedDetailHtml && (
        <div style={{
          backgroundColor: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: '12px',
          padding: '16px',
        }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: C.text, marginBottom: '12px' }}>
            상세 HTML
          </div>
          <iframe
            srcDoc={generatedDetailHtml}
            title="상세 HTML 미리보기"
            style={{
              width: '100%',
              height: '400px',
              border: `1px solid ${C.border}`,
              borderRadius: '8px',
            }}
            sandbox="allow-same-origin"
          />
        </div>
      )}

      {/* 상세 HTML AI 수정 패널 */}
      {generatedDetailHtml && (
        <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: '12px', overflow: 'hidden' }}>
          <div style={{ padding: '11px 14px', borderBottom: `1px solid ${C.border}`, backgroundColor: '#faf5ff' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#7c3aed' }}>✦ AI로 상세페이지 수정</span>
            <p style={{ fontSize: '11px', color: '#a78bfa', margin: '2px 0 0' }}>수정 요청을 입력하면 AI가 반영합니다</p>
          </div>
          <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
              {AI_EDIT_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => setEditInstruction(chip)}
                  style={{
                    padding: '3px 10px', fontSize: '11px', fontWeight: 500,
                    backgroundColor: editInstruction === chip ? '#ede9fe' : '#f5f3ff',
                    color: '#7c3aed',
                    border: `1px solid ${editInstruction === chip ? '#8b5cf6' : '#ddd6fe'}`,
                    borderRadius: '100px', cursor: 'pointer',
                  }}
                >
                  {chip}
                </button>
              ))}
            </div>
            <textarea
              rows={2}
              value={editInstruction}
              onChange={(e) => setEditInstruction(e.target.value)}
              placeholder="수정 요청을 자유롭게 입력하세요"
              style={{ width: '100%', padding: '8px 12px', fontSize: '12px', border: '1px solid #ddd6fe', borderRadius: '7px', outline: 'none', color: C.text, backgroundColor: '#fff', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }}
            />
            <button
              type="button"
              onClick={handleAiEdit}
              disabled={!editInstruction.trim() || detailEditStatus === 'editing'}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
                padding: '8px 16px', fontSize: '12px', fontWeight: 600,
                backgroundColor: !editInstruction.trim() || detailEditStatus === 'editing' ? '#ede9fe' : '#7c3aed',
                color: !editInstruction.trim() || detailEditStatus === 'editing' ? '#a78bfa' : '#fff',
                border: 'none', borderRadius: '7px',
                cursor: !editInstruction.trim() || detailEditStatus === 'editing' ? 'not-allowed' : 'pointer',
              }}
            >
              {detailEditStatus === 'editing'
                ? <><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />AI 수정 중...</>
                : '✦ AI 수정 적용'}
            </button>
            {detailEditStatus === 'done' && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', backgroundColor: '#dcfce7', border: '1px solid #86efac', borderRadius: '7px', fontSize: '12px' }}>
                <span style={{ color: '#15803d', fontWeight: 600 }}>
                  <CheckCheck size={13} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'middle' }} />수정 완료!
                </span>
                {prevHtmlRef.current !== null && (
                  <button type="button" onClick={handleUndoEdit} style={{ fontSize: '11px', color: '#15803d', background: 'none', border: '1px solid #86efac', borderRadius: '5px', padding: '2px 8px', cursor: 'pointer' }}>되돌리기</button>
                )}
              </div>
            )}
            {detailEditStatus === 'error' && (
              <div style={{ padding: '8px 12px', backgroundColor: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '7px', fontSize: '11px', color: '#b91c1c', display: 'flex', alignItems: 'flex-start', gap: '5px' }}>
                <AlertCircle size={12} style={{ flexShrink: 0, marginTop: '1px' }} />
                {detailEditError ?? '수정 중 오류가 발생했습니다.'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 액션 버튼 영역 */}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          type="button"
          onClick={handleDownloadZip}
          style={{
            padding: '10px 16px', fontSize: '13px', fontWeight: 600,
            backgroundColor: C.text, color: '#fff',
            border: 'none', borderRadius: '8px', cursor: 'pointer',
          }}
        >
          ZIP 다운로드
        </button>
        <button
          type="button"
          onClick={onSave}
          style={{
            padding: '10px 16px', fontSize: '13px', fontWeight: 600,
            backgroundColor: C.accent, color: '#fff',
            border: 'none', borderRadius: '8px', cursor: 'pointer',
          }}
        >
          Supabase에 저장
        </button>
      </div>

      {/* 썸네일 이미지 AI 편집 모달 */}
      {imageEditTarget && (
        <AiEditModal
          imageUrl={imageEditTarget.url}
          imageFile={null}
          onClose={() => setImageEditTarget(null)}
          onSave={handleImageEditSaved}
        />
      )}
    </div>
  );
}
