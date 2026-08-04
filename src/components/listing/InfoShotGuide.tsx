'use client';

/**
 * InfoShotGuide
 * 상품명을 입력하면 "무엇을 찍어야 하는지"를 즉시 보여준다.
 *
 * 왜 여기(업로드 화면)인가: 이 안내가 필요한 시점은 촬영 전이다. 레이아웃을 만든
 * 뒤에 알려주면 이미 매장을 떠난 뒤이고, 라벨은 제품에 붙어 있어 다시 찍으려면
 * 옷장을 뒤져야 한다. 기존 촬영 가이드(shot-guide)는 레이아웃 생성 후 빈 슬롯을
 * 채우는 연출 컷을 다루므로 역할이 다르다.
 *
 * 접힌 상태로 시작한다 — 매번 펼쳐져 있으면 입력 흐름을 가로막는다.
 */

import { useState, useMemo } from 'react';
import { infoShotsFor, serializeInfoShotChecklist } from '@/lib/detail-page/info-shots';

export default function InfoShotGuide({
  productName,
  category = '',
}: {
  productName: string;
  category?: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const shots = useMemo(
    () => (productName.trim() ? infoShotsFor(category, productName) : []),
    [category, productName],
  );

  // 상품명이 비면 무엇을 찍을지 판정할 수 없다. 빈 안내를 띄우지 않는다.
  if (shots.length === 0) return null;

  const requiredCount = shots.filter((s) => s.required).length;

  async function copyChecklist() {
    try {
      await navigator.clipboard.writeText(serializeInfoShotChecklist(shots));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // 클립보드 권한이 없어도 목록은 화면에 이미 보이므로 조용히 넘어간다
    }
  }

  return (
    <div
      style={{
        marginBottom: '20px',
        border: '1px solid #374151',
        borderRadius: '8px',
        background: '#1a1a28',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          padding: '12px 14px',
          background: 'transparent',
          border: 'none',
          color: '#e2e8f0',
          cursor: 'pointer',
          fontSize: '13px',
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          textAlign: 'left',
        }}
      >
        <span>
          📋 먼저 찍어야 할 정보 사진 {shots.length}장
          {requiredCount > 0 && (
            <span style={{ color: '#fbbf24', fontWeight: 600, marginLeft: 6 }}>
              (필수 {requiredCount})
            </span>
          )}
        </span>
        <span style={{ color: '#9ca3af', fontSize: '11px' }}>{open ? '접기' : '펼치기'}</span>
      </button>

      {open && (
        <div style={{ padding: '0 14px 14px' }}>
          <p style={{ fontSize: '11.5px', color: '#9ca3af', lineHeight: 1.6, margin: '0 0 12px' }}>
            상세페이지에 실릴 사진이 아니라 <strong style={{ color: '#cbd5e1' }}>상세페이지의 재료</strong>가
            되는 사진입니다. 여기서 소재·원산지·정가·판매 포인트가 나옵니다.
          </p>

          {shots.map((s) => (
            <div
              key={s.subject}
              style={{
                padding: '10px 0',
                borderTop: '1px solid #2a2a3a',
              }}
            >
              <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#e2e8f0', marginBottom: 4 }}>
                {s.subject}
                {s.required && (
                  <span style={{ color: '#fbbf24', fontSize: '11px', marginLeft: 6 }}>⭐ 필수</span>
                )}
              </div>
              <div style={{ fontSize: '11.5px', color: '#9ca3af', lineHeight: 1.55, marginBottom: 3 }}>
                📍 {s.where}
              </div>
              <div style={{ fontSize: '11.5px', color: '#7dd3fc', lineHeight: 1.55 }}>
                → {s.yields.join(' · ')}
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={copyChecklist}
            style={{
              marginTop: '12px',
              width: '100%',
              padding: '9px',
              background: '#252538',
              border: '1px solid #374151',
              borderRadius: '6px',
              color: '#cbd5e1',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            {copied ? '복사했습니다' : '체크리스트 복사 (폰으로 보며 촬영)'}
          </button>
        </div>
      )}
    </div>
  );
}
