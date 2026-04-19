'use client';

/**
 * Step3ReviewRegister.tsx
 * Step 3 — 상세페이지 미리보기 + 등록 폼
 */

import React, { useState } from 'react';
import { ChevronLeft, Copy, CheckCheck, Download, AlertCircle, Plus } from 'lucide-react';
import { useListingStore } from '@/store/useListingStore';
import { C } from '@/lib/design-tokens';
import BothRegisterForm from '@/components/listing/BothRegisterForm';

export default function Step3ReviewRegister() {
  const { sharedDraft, goPrevStep, resetWorkflow } = useListingStore();
  const {
    detailPageFullHtml,
    detailPageSnippet,
    detailPageSkipped,
    description,
    name,
  } = sharedDraft;

  const [copied, setCopied] = useState(false);
  const [snippetCopied, setSnippetCopied] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [showRegisterForm, setShowRegisterForm] = useState(true);

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

  // 스니펫 복사
  const handleSnippetCopy = async () => {
    if (!detailPageSnippet) return;
    try {
      await navigator.clipboard.writeText(detailPageSnippet);
      setSnippetCopied(true);
      setTimeout(() => setSnippetCopied(false), 2000);
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

        {/* ── 좌측: 미리보기 ────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

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
                <span style={{ fontSize: '13px', fontWeight: 700, color: C.text }}>도매꾹 상세페이지</span>
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
                  <span style={{ fontSize: '13px', fontWeight: 700, color: C.text }}>쿠팡 상세페이지 HTML 코드</span>
                  <p style={{ fontSize: '11px', color: C.textSub, margin: '2px 0 0' }}>쿠팡 상품 등록 &gt; 상세설명 HTML 에디터에 붙여넣으세요</p>
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
        </div>

        {/* ── 우측: 등록 폼 ─────────────────────────────────────────────── */}
        <div>
          {showRegisterForm && !registered && (
            <BothRegisterForm
              onClose={handleRegistered}
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

      {/* 하단 버튼 */}
      {!registered && (
        <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
          <button
            onClick={goPrevStep}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '10px 20px',
              fontSize: '13px',
              fontWeight: 600,
              backgroundColor: '#fff',
              color: C.textSub,
              border: `1px solid ${C.border}`,
              borderRadius: '8px',
              cursor: 'pointer',
            }}
          >
            <ChevronLeft size={15} />
            이전
          </button>
        </div>
      )}
    </div>
  );
}
