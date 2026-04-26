'use client';

/**
 * Step3ReviewRegister.tsx
 * Step 3 — 상세페이지 미리보기 + AI 수정 패널 + 등록 폼
 */

import React, { useState, useRef } from 'react';
import { Copy, CheckCheck, Download, AlertCircle, Plus, Loader2 } from 'lucide-react';
import { useListingStore } from '@/store/useListingStore';
import { C } from '@/lib/design-tokens';
import RegisterFormSections from '@/components/listing/register-form';

// AI 수정 예시 칩 목록
const AI_EDIT_CHIPS = [
  '감성적인 톤으로',
  '특징 간결하게',
  '가성비 강조',
  '20대 여성 타겟',
  '선물용 문구 추가',
];

export default function Step3ReviewRegister() {
  const { sharedDraft, resetWorkflow, editDetailPage } = useListingStore();
  const {
    detailPageFullHtml,
    detailPageSnippet,
    detailPageSnippetNaver,
    detailPageSkipped,
    description,
    name,
    detailPageEditStatus,
    detailPageEditError,
  } = sharedDraft;

  const [copied, setCopied] = useState(false);
  const [snippetCopied, setSnippetCopied] = useState(false);
  const [snippetNaverCopied, setSnippetNaverCopied] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [showRegisterForm, setShowRegisterForm] = useState(true);

  // AI 수정 패널 상태
  const [editInstruction, setEditInstruction] = useState('');
  // 되돌리기용 이전 HTML 저장
  const prevHtmlRef = useRef<string | null>(null);
  const prevSnippetRef = useRef<string | null>(null);

  // HTML 복사
  const handleCopy = async () => {
    const html = detailPageFullHtml || description;
    if (!html) return;
    try {
      await navigator.clipboard.writeText(html);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* 무시 */ }
  };

  // 스니펫 복사 (쿠팡)
  const handleSnippetCopy = async () => {
    if (!detailPageSnippet) return;
    try {
      await navigator.clipboard.writeText(detailPageSnippet);
      setSnippetCopied(true);
      setTimeout(() => setSnippetCopied(false), 2000);
    } catch { /* 무시 */ }
  };

  // 스니펫 복사 (네이버)
  const handleSnippetNaverCopy = async () => {
    if (!detailPageSnippetNaver) return;
    try {
      await navigator.clipboard.writeText(detailPageSnippetNaver);
      setSnippetNaverCopied(true);
      setTimeout(() => setSnippetNaverCopied(false), 2000);
    } catch { /* 무시 */ }
  };

  // HTML 다운로드
  const handleDownload = () => {
    const html = detailPageFullHtml || description;
    if (!html) return;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = name
      ? name.replace(/[^a-zA-Z0-9가-힣_-]/g, '_').slice(0, 40)
      : 'detail-page';
    a.download = `${safeName}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 등록 완료 후 처리
  const handleRegistered = () => {
    setRegistered(true);
    setShowRegisterForm(false);
  };

  // 새 상품 등록
  const handleNewProduct = () => {
    resetWorkflow();
  };

  // AI 수정 실행
  const handleAiEdit = async () => {
    if (!editInstruction.trim() || detailPageEditStatus === 'editing') return;
    // 되돌리기용 이전 HTML 백업
    prevHtmlRef.current = detailPageFullHtml;
    prevSnippetRef.current = detailPageSnippet;
    await editDetailPage(editInstruction.trim());
  };

  // 되돌리기 — 이전 HTML 복원
  const handleUndo = () => {
    if (prevHtmlRef.current === null) return;
    useListingStore.setState((s) => ({
      sharedDraft: {
        ...s.sharedDraft,
        detailPageFullHtml: prevHtmlRef.current,
        detailPageSnippet: prevSnippetRef.current,
        description: prevSnippetRef.current ?? s.sharedDraft.description,
        detailPageEditStatus: 'idle',
        detailPageEditError: null,
      },
    }));
    prevHtmlRef.current = null;
    prevSnippetRef.current = null;
    setEditInstruction('');
  };

  const hasHtml = !!detailPageFullHtml;
  const hasDescription = !!description;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

      {/* 등록 성공 배너 */}
      {registered && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            backgroundColor: '#dcfce7',
            border: '1px solid #86efac',
            borderRadius: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: '#15803d', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CheckCheck size={16} color="#fff" />
            </div>
            <div>
              <p style={{ fontSize: '14px', fontWeight: 700, color: '#14532d', margin: '0 0 2px' }}>상품 등록 완료!</p>
              <p style={{ fontSize: '12px', color: '#15803d', margin: 0 }}>마켓에 상품이 등록되었습니다.</p>
            </div>
          </div>
          <button
            onClick={handleNewProduct}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 16px',
              fontSize: '13px',
              fontWeight: 600,
              backgroundColor: '#15803d',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
            }}
          >
            <Plus size={14} />
            새 상품 등록
          </button>
        </div>
      )}

      {/* 2컬럼 레이아웃 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', alignItems: 'start' }}>

        {/* ── 좌측: 미리보기 + AI 수정 패널 ───────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', position: 'sticky', top: '16px', alignSelf: 'start' }}>

          {/* 상세설명 없음 경고 */}
          {detailPageSkipped && !hasDescription && (
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                padding: '12px 14px',
                backgroundColor: '#fef9c3',
                border: '1px solid #fde047',
                borderRadius: '10px',
                fontSize: '13px',
                color: '#92400e',
              }}
            >
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
              <span>
                상세설명이 없습니다. 이전 단계에서 AI로 생성하거나, 아래에서 직접 HTML을 입력해주세요.
              </span>
            </div>
          )}

          {/* AI 생성 상세페이지 미리보기 */}
          {hasHtml && !detailPageSkipped && (
            <div
              style={{
                backgroundColor: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: '12px',
                overflow: 'hidden',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: `1px solid ${C.border}`, backgroundColor: C.tableHeader }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color: C.text }}>상세페이지 미리보기</span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    onClick={handleCopy}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '4px',
                      padding: '5px 10px', fontSize: '11px', fontWeight: 600,
                      backgroundColor: '#fff', color: C.text,
                      border: `1px solid ${C.border}`, borderRadius: '6px', cursor: 'pointer',
                    }}
                  >
                    {copied ? <><CheckCheck size={11} color="#15803d" /> 복사됨</> : <><Copy size={11} /> 코드 복사</>}
                  </button>
                  <button
                    onClick={handleDownload}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '4px',
                      padding: '5px 10px', fontSize: '11px', fontWeight: 600,
                      backgroundColor: C.text, color: '#fff',
                      border: 'none', borderRadius: '6px', cursor: 'pointer',
                    }}
                  >
                    <Download size={11} />
                    다운로드
                  </button>
                </div>
              </div>
              <iframe
                srcDoc={detailPageFullHtml}
                title="상세 페이지 미리보기"
                style={{ width: '100%', height: '500px', border: 'none', display: 'block' }}
                sandbox="allow-same-origin"
              />
            </div>
          )}

          {/* 도매꾹 경로 상세페이지 */}
          {detailPageSkipped && hasDescription && (
            <div
              style={{
                backgroundColor: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: '12px',
                overflow: 'hidden',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: `1px solid ${C.border}`, backgroundColor: C.tableHeader }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color: C.text }}>상세페이지</span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    onClick={handleCopy}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '4px',
                      padding: '5px 10px', fontSize: '11px', fontWeight: 600,
                      backgroundColor: '#fff', color: C.text,
                      border: `1px solid ${C.border}`, borderRadius: '6px', cursor: 'pointer',
                    }}
                  >
                    {copied ? <><CheckCheck size={11} color="#15803d" /> 복사됨</> : <><Copy size={11} /> HTML 복사</>}
                  </button>
                </div>
              </div>
              <textarea
                readOnly
                value={description}
                style={{
                  width: '100%',
                  height: '300px',
                  padding: '12px',
                  fontFamily: 'monospace',
                  fontSize: '11px',
                  color: '#4ade80',
                  backgroundColor: '#0a0a0a',
                  border: 'none',
                  resize: 'vertical',
                  outline: 'none',
                  boxSizing: 'border-box',
                  display: 'block',
                }}
              />
            </div>
          )}

          {/* 쿠팡용 HTML 스니펫 */}
          {detailPageSnippet && (
            <div
              style={{
                backgroundColor: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: '12px',
                overflow: 'hidden',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: `1px solid ${C.border}`, backgroundColor: C.tableHeader }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: C.text }}>쿠팡 상세페이지 HTML</span>
                    <span style={{ fontSize: '10px', fontWeight: 700, color: '#fff', background: '#be0014', padding: '1px 6px', borderRadius: '4px' }}>780px</span>
                  </div>
                  <p style={{ fontSize: '11px', color: C.textSub, margin: '2px 0 0' }}>쿠팡 상품 등록 › 상세설명 HTML 에디터에 붙여넣기</p>
                </div>
                <button
                  onClick={handleSnippetCopy}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '4px',
                    padding: '5px 10px', fontSize: '11px', fontWeight: 600,
                    backgroundColor: C.text, color: '#fff',
                    border: 'none', borderRadius: '6px', cursor: 'pointer',
                  }}
                >
                  {snippetCopied ? <><CheckCheck size={11} color="#4ade80" /> 복사됨</> : <><Copy size={11} /> 코드 복사</>}
                </button>
              </div>
              <textarea
                readOnly
                value={detailPageSnippet}
                style={{
                  width: '100%',
                  height: '200px',
                  padding: '12px',
                  fontFamily: 'monospace',
                  fontSize: '11px',
                  color: '#4ade80',
                  backgroundColor: '#030712',
                  border: 'none',
                  resize: 'none',
                  outline: 'none',
                  boxSizing: 'border-box',
                  display: 'block',
                }}
              />
            </div>
          )}

          {/* 네이버용 HTML 스니펫 */}
          {detailPageSnippetNaver && (
            <div
              style={{
                backgroundColor: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: '12px',
                overflow: 'hidden',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: `1px solid ${C.border}`, backgroundColor: C.tableHeader }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: C.text }}>네이버 상세페이지 HTML</span>
                    <span style={{ fontSize: '10px', fontWeight: 700, color: '#fff', background: '#03c75a', padding: '1px 6px', borderRadius: '4px' }}>860px</span>
                  </div>
                  <p style={{ fontSize: '11px', color: C.textSub, margin: '2px 0 0' }}>스마트스토어 › 상품 상세설명 HTML 에디터에 붙여넣기</p>
                </div>
                <button
                  onClick={handleSnippetNaverCopy}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '4px',
                    padding: '5px 10px', fontSize: '11px', fontWeight: 600,
                    backgroundColor: C.text, color: '#fff',
                    border: 'none', borderRadius: '6px', cursor: 'pointer',
                  }}
                >
                  {snippetNaverCopied ? <><CheckCheck size={11} color="#4ade80" /> 복사됨</> : <><Copy size={11} /> 코드 복사</>}
                </button>
              </div>
              <textarea
                readOnly
                value={detailPageSnippetNaver}
                style={{
                  width: '100%',
                  height: '200px',
                  padding: '12px',
                  fontFamily: 'monospace',
                  fontSize: '11px',
                  color: '#4ade80',
                  backgroundColor: '#0a1628',
                  border: 'none',
                  resize: 'none',
                  outline: 'none',
                  boxSizing: 'border-box',
                  display: 'block',
                }}
              />
            </div>
          )}

          {/* 아무것도 없을 때 */}
          {!hasHtml && !hasDescription && !detailPageSkipped && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '12px',
                padding: '48px 24px',
                backgroundColor: C.tableHeader,
                borderRadius: '12px',
                textAlign: 'center',
              }}
            >
              <p style={{ fontSize: '14px', color: C.textSub, margin: 0 }}>
                상세페이지가 아직 생성되지 않았습니다.
              </p>
              <p style={{ fontSize: '12px', color: C.textSub, margin: 0 }}>
                이전 단계에서 AI 생성을 진행하거나 건너뛸 수 있습니다.
              </p>
            </div>
          )}

          {/* ── AI 수정 패널 (detailPageFullHtml이 있을 때만 표시) ── */}
          {hasHtml && (
            <div
              style={{
                backgroundColor: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: '12px',
                overflow: 'hidden',
              }}
            >
              {/* 패널 헤더 */}
              <div
                style={{
                  padding: '12px 16px',
                  borderBottom: `1px solid ${C.border}`,
                  backgroundColor: '#faf5ff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: '#7c3aed' }}>
                    ✦ AI로 상세페이지 수정
                  </span>
                  <p style={{ fontSize: '11px', color: '#a78bfa', margin: '2px 0 0' }}>
                    수정 요청을 입력하면 AI가 반영합니다
                  </p>
                </div>
              </div>

              <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {/* 예시 칩 */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {AI_EDIT_CHIPS.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => setEditInstruction(chip)}
                      style={{
                        padding: '4px 10px',
                        fontSize: '12px',
                        fontWeight: 500,
                        backgroundColor: editInstruction === chip ? '#ede9fe' : '#f5f3ff',
                        color: '#7c3aed',
                        border: `1px solid ${editInstruction === chip ? '#8b5cf6' : '#ddd6fe'}`,
                        borderRadius: '100px',
                        cursor: 'pointer',
                      }}
                    >
                      {chip}
                    </button>
                  ))}
                </div>

                {/* 텍스트 입력 */}
                <textarea
                  rows={3}
                  value={editInstruction}
                  onChange={(e) => setEditInstruction(e.target.value)}
                  placeholder="수정 요청을 자유롭게 입력하세요"
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    fontSize: '13px',
                    border: '1px solid #ddd6fe',
                    borderRadius: '8px',
                    outline: 'none',
                    color: C.text,
                    backgroundColor: '#fff',
                    boxSizing: 'border-box',
                    resize: 'vertical',
                    fontFamily: 'inherit',
                  }}
                />

                {/* AI 수정 버튼 */}
                <button
                  type="button"
                  onClick={handleAiEdit}
                  disabled={!editInstruction.trim() || detailPageEditStatus === 'editing'}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    padding: '10px 20px',
                    fontSize: '13px',
                    fontWeight: 600,
                    backgroundColor: !editInstruction.trim() || detailPageEditStatus === 'editing' ? '#ede9fe' : '#7c3aed',
                    color: !editInstruction.trim() || detailPageEditStatus === 'editing' ? '#a78bfa' : '#fff',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: !editInstruction.trim() || detailPageEditStatus === 'editing' ? 'not-allowed' : 'pointer',
                    opacity: !editInstruction.trim() ? 0.6 : 1,
                  }}
                >
                  {detailPageEditStatus === 'editing' ? (
                    <>
                      <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                      AI 수정 중...
                    </>
                  ) : (
                    '✦ AI 수정 적용'
                  )}
                </button>

                {/* 완료 메시지 */}
                {detailPageEditStatus === 'done' && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      backgroundColor: '#dcfce7',
                      border: '1px solid #86efac',
                      borderRadius: '8px',
                      fontSize: '13px',
                    }}
                  >
                    <span style={{ color: '#15803d', fontWeight: 600 }}>
                      <CheckCheck size={14} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'middle' }} />
                      수정 완료!
                    </span>
                    {prevHtmlRef.current !== null && (
                      <button
                        type="button"
                        onClick={handleUndo}
                        style={{
                          fontSize: '12px',
                          color: '#15803d',
                          background: 'none',
                          border: '1px solid #86efac',
                          borderRadius: '6px',
                          padding: '3px 10px',
                          cursor: 'pointer',
                        }}
                      >
                        되돌리기
                      </button>
                    )}
                  </div>
                )}

                {/* 에러 메시지 */}
                {detailPageEditStatus === 'error' && (
                  <div
                    style={{
                      padding: '10px 14px',
                      backgroundColor: '#fee2e2',
                      border: '1px solid #fca5a5',
                      borderRadius: '8px',
                      fontSize: '12px',
                      color: '#b91c1c',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '6px',
                    }}
                  >
                    <AlertCircle size={14} style={{ flexShrink: 0, marginTop: '1px' }} />
                    <span>{detailPageEditError ?? '수정 중 오류가 발생했습니다.'}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── 우측: 등록 폼 ─────────────────────────────────────────────── */}
        <div>
          {showRegisterForm && !registered && (
            <RegisterFormSections
              onSuccess={handleRegistered}
              onCancel={() => {}}
            />
          )}

          {registered && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '16px',
                padding: '48px 24px',
                backgroundColor: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: '12px',
                textAlign: 'center',
              }}
            >
              <div style={{ width: '56px', height: '56px', borderRadius: '50%', backgroundColor: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CheckCheck size={28} color="#15803d" />
              </div>
              <div>
                <p style={{ fontSize: '16px', fontWeight: 700, color: C.text, margin: '0 0 6px' }}>등록 완료!</p>
                <p style={{ fontSize: '13px', color: C.textSub, margin: 0 }}>상품이 성공적으로 등록되었습니다.</p>
              </div>
              <button
                onClick={handleNewProduct}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '10px 20px', fontSize: '13px', fontWeight: 600,
                  backgroundColor: C.accent, color: '#fff',
                  border: 'none', borderRadius: '8px', cursor: 'pointer',
                }}
              >
                <Plus size={14} />
                새 상품 등록
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 스피너 키프레임 */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
