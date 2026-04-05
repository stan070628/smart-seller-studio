'use client';

/**
 * ReferenceLearnButton.tsx
 * 화면 우측 하단에 고정된 플로팅 버튼.
 * 클릭 시 ReferenceLearnModal을 열고 닫는다.
 */

import React, { useState } from 'react';
import { Sparkles } from 'lucide-react';
import ReferenceLearnModal from './ReferenceLearnModal';

const ReferenceLearnButton: React.FC = () => {
  // 모달 열림/닫힘 상태
  const [isOpen, setIsOpen] = useState(false);

  // hover 상태 (인라인 스타일 transition 효과)
  const [isHovered, setIsHovered] = useState(false);

  return (
    <>
      {/* 플로팅 버튼 */}
      <button
        onClick={() => setIsOpen(true)}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        title="레퍼런스 학습"
        style={{
          position: 'fixed',
          bottom: '28px',
          right: '28px',
          zIndex: 100,
          width: '48px',
          height: '48px',
          borderRadius: '50%',
          backgroundColor: isHovered ? '#6366f1' : '#4f46e5',
          border: 'none',
          boxShadow: '0 4px 20px rgba(99,102,241,0.5)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background-color 0.2s ease',
        }}
      >
        <Sparkles size={20} color="white" />
      </button>

      {/* 레퍼런스 학습 모달 */}
      <ReferenceLearnModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
      />
    </>
  );
};

export default ReferenceLearnButton;
