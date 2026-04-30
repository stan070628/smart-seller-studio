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

export default function AssetsResultPanel() {
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

  // 합치기용 다중 선택 상태 (썸네일 인덱스의 집합)
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  // 합치기 모달 타겟 (선택된 썸네일 2장의 URL)
  const [mergeTarget, setMergeTarget] = useState<{ url1: string; url2: string } | null>(null);

  const toggleSelect = (idx: number) => {
    setSelectedIndices((prev) => {
      if (prev.includes(idx)) return prev.filter((i) => i !== idx);
      // 최대 2장까지만 유지: 이미 2장 선택돼 있으면 가장 먼저 선택한 것을 밀어낸다.
      if (prev.length >= 2) return [prev[1], idx];
      return [...prev, idx];
    });
  };

  const handleStartMerge = () => {
    if (selectedIndices.length !== 2) return;
    const [a, b] = selectedIndices;
    setMergeTarget({
      url1: generatedThumbnails[a],
      url2: generatedThumbnails[b],
    });
  };

  const handleMergeSaved = (resultUrl: string) => {
    // 합쳐진 결과를 그리드에 새 썸네일로 추가하고 선택 해제. 원본 2장은 보존.
    updateAssetsDraft({ generatedThumbnails: [...generatedThumbnails, resultUrl] });
    setMergeTarget(null);
    setSelectedIndices([]);
  };

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

  // 썸네일 URL은 data:, Supabase 공개 URL, 외부 사이트 URL이 섞여 들어온다.
  // <a download>는 cross-origin URL에서 무시되므로 fetch → Blob → ObjectURL 경로로 통일한다.
  const urlToBlob = async (url: string): Promise<Blob> => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob();
  };

  const inferExt = (blob: Blob, url: string): string => {
    const mime = blob.type.toLowerCase();
    if (mime === 'image/jpeg') return 'jpg';
    if (mime === 'image/png') return 'png';
    if (mime === 'image/webp') return 'webp';
    if (mime === 'image/gif') return 'gif';
    try {
      const path = new URL(url, window.location.href).pathname.toLowerCase();
      const m = path.match(/\.(jpe?g|png|webp|gif)(?:$|[?#])/);
      if (m) return m[1] === 'jpeg' ? 'jpg' : m[1];
    } catch {
      /* noop */
    }
    return 'jpg';
  };

  // 개별 썸네일 다운로드. fetch가 CORS로 막히면 새 탭에서 열어 사용자가 저장하도록 fallback.
  const handleDownloadOne = async (url: string, idx: number) => {
    try {
      const blob = await urlToBlob(url);
      const ext = inferExt(blob, url);
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = `thumbnail-${idx + 1}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objUrl);
    } catch (err) {
      console.warn('[assets] 직접 다운로드 실패, 새 탭에서 엽니다:', err);
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  // 모든 자산을 ZIP으로 일괄 다운로드. 각 썸네일을 Blob으로 받아서 그대로 zip에 넣는다.
  const handleDownloadZip = async () => {
    try {
      const JSZipMod = await import('jszip');
      const zip = new JSZipMod.default();
      let okCount = 0;
      for (let i = 0; i < generatedThumbnails.length; i++) {
        const url = generatedThumbnails[i];
        try {
          const blob = await urlToBlob(url);
          const ext = inferExt(blob, url);
          zip.file(`thumbnail-${i + 1}.${ext}`, blob);
          okCount++;
        } catch (err) {
          console.warn(`[assets] 썸네일 ${i + 1} ZIP 추가 실패:`, err);
        }
      }
      if (generatedDetailHtml) {
        zip.file('detail.html', generatedDetailHtml);
      }
      if (okCount === 0 && !generatedDetailHtml) {
        alert('ZIP에 포함할 자산을 가져오지 못했습니다.');
        return;
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
    } catch (err) {
      alert(`다운로드 중 오류가 발생했습니다: ${err instanceof Error ? err.message : '알 수 없는 오류'}`);
    }
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', gap: '12px' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: C.text }}>
            썸네일 ({generatedThumbnails.length})
            {selectedIndices.length > 0 && (
              <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: 500, color: C.textSub }}>
                · {selectedIndices.length}장 선택됨
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleStartMerge}
            disabled={selectedIndices.length !== 2}
            title={selectedIndices.length === 2 ? '두 이미지를 한 컷으로 합치기' : '체크박스로 정확히 2장을 선택하세요'}
            style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              padding: '5px 10px', fontSize: '11px', fontWeight: 600,
              backgroundColor: selectedIndices.length === 2 ? '#7c3aed' : '#ede9fe',
              color: selectedIndices.length === 2 ? '#fff' : '#a78bfa',
              border: 'none', borderRadius: '6px',
              cursor: selectedIndices.length === 2 ? 'pointer' : 'not-allowed',
            }}
          >
            <Sparkles size={11} />선택한 2장 합치기
          </button>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {generatedThumbnails.map((url, i) => {
            const checked = selectedIndices.includes(i);
            return (
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
                    border: checked ? '2px solid #7c3aed' : `1px solid ${C.border}`,
                    display: 'block',
                  }}
                />
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  aria-label={`썸네일 ${i + 1} 합치기 대상으로 선택`}
                  onClick={() => toggleSelect(i)}
                  title="합치기 대상으로 선택"
                  style={{
                    position: 'absolute', top: '4px', left: '4px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: '20px', height: '20px', padding: 0,
                    backgroundColor: checked ? '#7c3aed' : 'rgba(255,255,255,0.9)',
                    border: checked ? '1px solid #7c3aed' : `1px solid ${C.border}`,
                    borderRadius: '4px', cursor: 'pointer',
                    color: '#fff', fontSize: '12px', lineHeight: 1,
                  }}
                >
                  {checked ? '✓' : ''}
                </button>
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
            );
          })}
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

      {/* 두 이미지 합치기 모달 */}
      {mergeTarget && (
        <AiEditModal
          imageUrl={mergeTarget.url1}
          imageUrl2={mergeTarget.url2}
          imageFile={null}
          onClose={() => setMergeTarget(null)}
          onSave={handleMergeSaved}
        />
      )}
    </div>
  );
}
