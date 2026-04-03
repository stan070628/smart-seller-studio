/**
 * EditableText.tsx
 * 편집 가능한 텍스트 래퍼 컴포넌트
 *
 * - isEditable=true 일 때 contentEditable div 로 렌더링
 * - onBlur 시 onFieldChange 호출로 값 저장
 * - Enter 키 → blur (편집 종료)
 * - 순수 React 컴포넌트 (클라이언트/서버 양쪽 사용 가능)
 */

import React from 'react';

export interface EditableTextProps {
  value: string;
  field: string;
  isEditable?: boolean;
  onFieldChange?: (field: string, value: string) => void;
  style?: React.CSSProperties;
  /** 렌더링할 HTML 태그 */
  tag?: 'h1' | 'h2' | 'h3' | 'p' | 'span';
  className?: string;
}

/**
 * 편집 모드일 때는 span 태그로 contentEditable 렌더링.
 * 비편집 모드일 때는 지정된 tag로 정적 렌더링.
 * (tag 에 따른 복잡한 타입 분기를 피하기 위해 편집 모드는 항상 div 기반 처리)
 */
const EditableText: React.FC<EditableTextProps> = ({
  value,
  field,
  isEditable = false,
  onFieldChange,
  style,
  tag = 'span',
  className,
}) => {
  const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (onFieldChange) {
      onFieldChange(field, e.currentTarget.innerHTML ?? '');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // 커서 위치에 <br> 삽입 후 커서를 그 뒤로 이동
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        const br = document.createElement('br');
        range.insertNode(br);
        range.setStartAfter(br);
        range.setEndAfter(br);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
  };

  // 편집 모드: div 로 contentEditable 렌더 (시각적 role은 tag에 맞게 style로 조정)
  if (isEditable) {
    const editableStyle: React.CSSProperties = {
      outline: '2px dashed rgba(99,102,241,0.6)',
      borderRadius: '4px',
      minWidth: '20px',
      cursor: 'text',
      ...style,
    };

    return (
      <div
        role="textbox"
        contentEditable
        suppressContentEditableWarning
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        style={editableStyle}
        className={className}
        dangerouslySetInnerHTML={{ __html: value }}
      />
    );
  }

  // 비편집 모드: dangerouslySetInnerHTML 사용 (<br> 등 태그 보존)
  const Tag = tag;
  return (
    <Tag style={style} className={className} dangerouslySetInnerHTML={{ __html: value }} />
  );
};

export default EditableText;
