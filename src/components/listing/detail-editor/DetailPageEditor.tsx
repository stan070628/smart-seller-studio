'use client';
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { Plus, RefreshCw, Copy, Download, Loader2, ChevronDown } from 'lucide-react';
import type { DetailSection, DetailPageTheme, SectionType, AttachedImage } from '@/types/detail-page';
import { createEmptySection } from '@/lib/detail-page/section-parser';
import { C } from '@/lib/design-tokens';
import ThemeBar from './ThemeBar';
import SectionCard from './SectionCard';

// ─── 인라인 편집 헬퍼 ─────────────────────────────────────────────────────────

const PREVIEW_GUIDE_CSS = `
  [data-section-id] {
    position: relative;
    outline: 1px dashed transparent;
    outline-offset: -2px;
    transition: outline-color 120ms ease, background-color 120ms ease;
  }
  [data-section-id]:hover {
    outline-color: #7c3aed;
    background-image: linear-gradient(rgba(124, 58, 237, 0.035), rgba(124, 58, 237, 0.035));
  }
  [data-section-id]:hover::before {
    content: attr(data-section-label);
    position: absolute;
    top: 8px;
    left: 8px;
    z-index: 20;
    padding: 4px 8px;
    border-radius: 6px;
    background: #5b21b6;
    color: #fff;
    font: 700 12px/1.2 system-ui, -apple-system, sans-serif;
    box-shadow: 0 4px 14px rgba(0,0,0,0.18);
    pointer-events: none;
  }
  [data-edit-path] {
    border-radius: 4px;
    cursor: text;
    min-height: 1em;
  }
  [data-edit-path]:hover {
    box-shadow: 0 0 0 2px rgba(124, 58, 237, 0.24);
  }
  [data-edit-path][contenteditable="true"]:focus {
    outline: 2px solid #7c3aed;
    outline-offset: 2px;
    background: rgba(255,255,255,0.72);
  }
`;

function updatePathValue(target: unknown, parts: string[], value: string): unknown {
  if (parts.length === 0) return value;
  const [head, ...rest] = parts;
  if (Array.isArray(target)) {
    const index = Number(head);
    const next = [...target];
    next[index] = updatePathValue(next[index], rest, value);
    return next;
  }
  if (target && typeof target === 'object') {
    return {
      ...(target as Record<string, unknown>),
      [head]: updatePathValue((target as Record<string, unknown>)[head], rest, value),
    };
  }
  return target;
}

function updateSectionText(section: DetailSection, path: string, value: string): DetailSection {
  return updatePathValue(section, path.split('.'), value) as DetailSection;
}

function buildEditablePreviewDocument(html: string): string {
  const script = `
    (() => {
      const post = (type, el) => {
        const section = el.closest('[data-section-id]');
        if (!section) return;
        window.parent.postMessage({
          source: 'detail-preview-inline-editor',
          type,
          sectionId: section.getAttribute('data-section-id'),
          path: el.getAttribute('data-edit-path'),
          value: el.textContent || ''
        }, '*');
      };
      document.querySelectorAll('[data-edit-path]').forEach((el) => {
        el.setAttribute('contenteditable', 'true');
        el.setAttribute('spellcheck', 'false');
        el.addEventListener('input', () => post('input', el));
        el.addEventListener('blur', () => post('commit', el));
      });
    })();
  `;
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>${PREVIEW_GUIDE_CSS}</style>
</head>
<body style="margin:0;background:#fff;">
${html}
<script>${script}<\/script>
</body>
</html>`;
}

export interface DetailPageEditorProps {
  sections: DetailSection[];
  theme: DetailPageTheme;
  /** 전체 생성 중 (로딩 오버레이) */
  isGenerating?: boolean;
  onSectionsChange: (sections: DetailSection[]) => void;
  onThemeChange: (theme: DetailPageTheme) => void;
  /** 전체 재생성 버튼 — 없으면 버튼 숨김 */
  onRegenerateAll?: () => void;
  onSectionAiEdit: (section: DetailSection, instruction: string) => Promise<void>;
  /** HTML 복사 — 없으면 숨김 */
  onHtmlCopy?: () => void;
  /** 다운로드 — 없으면 숨김 */
  onDownload?: () => void;
  /** 오른쪽 iframe 미리보기용 HTML */
  generatedHtml?: string;
  /** true이면 내부 오른쪽 미리보기 패널 숨김 (외부에서 별도 렌더링할 때 사용) */
  hidePreview?: boolean;
  /** 섹션 이미지 AI 편집 — 없으면 버튼 미노출 */
  onSectionImageAiEdit?: (sectionId: string, imageUrl: string, imageIndex: number) => void;
}

// 섹션 추가 드롭다운 옵션
const ADD_SECTION_OPTIONS: Array<{ type: SectionType; label: string }> = [
  { type: 'hero',           label: '히어로' },
  { type: 'selling_points', label: '셀링 포인트' },
  { type: 'features',       label: '특징' },
  { type: 'stats',          label: '통계' },
  { type: 'spec_table',     label: '사양 테이블' },
  { type: 'usage_steps',    label: '사용법' },
  { type: 'warning',        label: '주의사항' },
  { type: 'cta',            label: '구매 유도' },
  { type: 'brand_header',   label: '브랜드 헤더' },
  { type: 'point',          label: '포인트' },
  { type: 'image_grid',     label: '이미지 그리드' },
];

export default function DetailPageEditor({
  sections,
  theme,
  isGenerating = false,
  onSectionsChange,
  onThemeChange,
  onRegenerateAll,
  onSectionAiEdit,
  onHtmlCopy,
  onDownload,
  generatedHtml,
  hidePreview = false,
  onSectionImageAiEdit,
}: DetailPageEditorProps) {
  // 섹션 추가 드롭다운 열림 여부
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  // 현재 선택(활성) 섹션 ID
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  // 드롭다운 메뉴 닫기를 위한 Blur 처리용 ref
  const addMenuRef = useRef<HTMLDivElement>(null);

  // 인라인 편집: message handler에서 stale closure 방지
  const sectionsRef = useRef<DetailSection[]>(sections);
  sectionsRef.current = sections;

  // 인라인 편집: generatedHtml을 contenteditable 문서로 래핑
  const editablePreviewHtml = useMemo(
    () => (!hidePreview && generatedHtml ? buildEditablePreviewDocument(generatedHtml) : ''),
    [hidePreview, generatedHtml],
  );

  // 인라인 편집: iframe → parent postMessage 수신
  const handleInlineEdit = useCallback(
    (sectionId: string, path: string, value: string) => {
      const next = sectionsRef.current.map((s) =>
        s.id === sectionId ? updateSectionText(s, path, value) : s,
      );
      sectionsRef.current = next;
      onSectionsChange(next);
    },
    [onSectionsChange],
  );

  useEffect(() => {
    if (hidePreview) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as {
        source?: string;
        type?: string;
        sectionId?: string;
        path?: string;
        value?: string;
      };
      if (data?.source !== 'detail-preview-inline-editor') return;
      if (!data.sectionId || !data.path || typeof data.value !== 'string') return;
      handleInlineEdit(data.sectionId, data.path, data.value);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [hidePreview, handleInlineEdit]);

  // dnd-kit 센서 설정
  const sensors = useSensors(
    useSensor(PointerSensor, {
      // 최소 5px 이동 후 드래그 시작 (클릭과 구분)
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // 드래그 종료 핸들러 — 순서 재배열 후 order 재할당
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = sections.findIndex((s) => s.id === active.id);
      const newIndex = sections.findIndex((s) => s.id === over.id);
      const reordered = arrayMove(sections, oldIndex, newIndex).map((s, i) => ({
        ...s,
        order: i,
      }));
      onSectionsChange(reordered);
    },
    [sections, onSectionsChange],
  );

  // 섹션 추가 — 마지막 순서로 삽입
  const handleAddSection = (type: SectionType) => {
    const newSection = createEmptySection(type, sections.length);
    onSectionsChange([...sections, newSection]);
    setAddMenuOpen(false);
    // 새로 추가된 섹션을 활성 상태로 설정
    setActiveSectionId(newSection.id);
  };

  // 섹션 삭제 — 삭제 후 order 재할당
  const handleDelete = useCallback(
    (id: string) => {
      const updated = sections
        .filter((s) => s.id !== id)
        .map((s, i) => ({ ...s, order: i }));
      onSectionsChange(updated);
      // 삭제된 섹션이 활성 상태였으면 선택 해제
      if (activeSectionId === id) setActiveSectionId(null);
    },
    [sections, onSectionsChange, activeSectionId],
  );

  // 섹션 카드 클릭 — 활성 섹션 토글
  const handleSectionClick = (id: string) => {
    setActiveSectionId((prev) => (prev === id ? null : id));
  };

  // 섹션 이미지 변경 — 해당 섹션의 attachedImages 업데이트
  const handleImagesChange = useCallback(
    (id: string, images: AttachedImage[]) => {
      const updated = sections.map((s) =>
        s.id === id ? { ...s, attachedImages: images } : s,
      );
      onSectionsChange(updated);
    },
    [sections, onSectionsChange],
  );

  // 드롭다운 외부 클릭 시 닫기
  const handleAddButtonBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (!addMenuRef.current?.contains(e.relatedTarget as Node)) {
      setAddMenuOpen(false);
    }
  };

  // 공통 하단 액션 버튼 스타일
  const actionButtonStyle = (variant: 'default' | 'accent' = 'default'): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 14px',
    borderRadius: 6,
    border: `1px solid ${variant === 'accent' ? C.accent : '#dddddd'}`,
    background: variant === 'accent' ? C.accent : '#ffffff',
    color: variant === 'accent' ? '#ffffff' : C.text,
    cursor: 'pointer',
    fontSize: 13,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontWeight: 500,
    transition: 'opacity 0.15s',
    whiteSpace: 'nowrap' as const,
  });

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        height: '100%',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        position: 'relative',
      }}
    >
      {/* ────────────── 왼쪽 패널 (300px 고정) ────────────── */}
      <div
        style={{
          width: 300,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          borderRight: `1px solid ${C.border}`,
          background: C.bg,
          overflow: 'hidden',
        }}
      >
        {/* 스크롤 영역 */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px 16px 0',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {/* 테마 바 */}
          <ThemeBar theme={theme} onThemeChange={onThemeChange} />

          {/* 구분선 */}
          <hr style={{ border: 'none', borderTop: `1px solid ${C.border}`, margin: 0 }} />

          {/* 섹션 추가 드롭다운 버튼 */}
          <div
            ref={addMenuRef}
            style={{ position: 'relative' }}
            onBlur={handleAddButtonBlur}
          >
            <button
              onClick={() => setAddMenuOpen((prev) => !prev)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '8px 14px',
                borderRadius: 6,
                border: `1.5px dashed ${addMenuOpen ? C.accent : '#cccccc'}`,
                background: addMenuOpen ? `${C.accent}08` : '#ffffff',
                color: addMenuOpen ? C.accent : C.textSub,
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
                transition: 'border-color 0.15s, background 0.15s, color 0.15s',
              }}
              aria-haspopup="listbox"
              aria-expanded={addMenuOpen}
            >
              <Plus size={15} />
              <span>섹션 추가</span>
              <ChevronDown
                size={14}
                style={{
                  transition: 'transform 0.15s',
                  transform: addMenuOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                }}
              />
            </button>

            {/* 드롭다운 메뉴 */}
            {addMenuOpen && (
              <div
                role="listbox"
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 4px)',
                  left: 0,
                  right: 0,
                  zIndex: 50,
                  background: '#ffffff',
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                  overflow: 'hidden',
                }}
              >
                {ADD_SECTION_OPTIONS.map((opt) => (
                  <button
                    key={opt.type}
                    role="option"
                    aria-selected={false}
                    onClick={() => handleAddSection(opt.type)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '9px 14px',
                      fontSize: 13,
                      color: C.text,
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      fontFamily: 'system-ui, -apple-system, sans-serif',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = C.rowHover;
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 구분선 */}
          <hr style={{ border: 'none', borderTop: `1px solid ${C.border}`, margin: 0 }} />

          {/* 섹션 카드 목록 (DnD) */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={sections.map((s) => s.id)}
              strategy={verticalListSortingStrategy}
            >
              <div style={{ paddingBottom: 8 }}>
                {sections.length === 0 ? (
                  // 섹션이 없을 때 빈 상태 안내
                  <div
                    style={{
                      textAlign: 'center',
                      padding: '32px 16px',
                      color: C.textSub,
                      fontSize: 13,
                    }}
                  >
                    섹션이 없습니다.
                    <br />
                    위의 버튼으로 섹션을 추가하세요.
                  </div>
                ) : (
                  sections.map((section) => (
                    <SectionCard
                      key={section.id}
                      section={section}
                      isActive={activeSectionId === section.id}
                      onAiEdit={onSectionAiEdit}
                      onDelete={handleDelete}
                      onClick={handleSectionClick}
                      onImagesChange={handleImagesChange}
                      palette={theme.palette}
                      onSectionImageAiEdit={onSectionImageAiEdit}
                    />
                  ))
                )}
              </div>
            </SortableContext>
          </DndContext>
        </div>

        {/* 하단 액션 버튼 영역 */}
        {(onRegenerateAll || onHtmlCopy || onDownload) && (
          <div
            style={{
              padding: '12px 16px',
              borderTop: `1px solid ${C.border}`,
              background: '#ffffff',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            {onRegenerateAll && (
              <button
                onClick={onRegenerateAll}
                disabled={isGenerating}
                style={{
                  ...actionButtonStyle('accent'),
                  opacity: isGenerating ? 0.6 : 1,
                  cursor: isGenerating ? 'not-allowed' : 'pointer',
                }}
              >
                <RefreshCw size={14} />
                <span>전체 재생성</span>
              </button>
            )}
            {onHtmlCopy && (
              <button
                onClick={onHtmlCopy}
                style={actionButtonStyle()}
              >
                <Copy size={14} />
                <span>HTML 복사</span>
              </button>
            )}
            {onDownload && (
              <button
                onClick={onDownload}
                style={actionButtonStyle()}
              >
                <Download size={14} />
                <span>다운로드</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* 오른쪽 미리보기 패널 — hidePreview=true이면 숨김 */}
      {!hidePreview && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            background: '#f0f0f0',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {/* 미리보기 헤더 레이블 */}
          <div
            style={{
              padding: '8px 16px',
              borderBottom: `1px solid ${C.border}`,
              background: '#ffffff',
              fontSize: 12,
              color: C.textSub,
              fontWeight: 600,
              letterSpacing: '0.02em',
            }}
          >
            미리보기
          </div>

          {/* iframe 또는 빈 상태 */}
          <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
            {generatedHtml ? (
              <iframe
                srcDoc={editablePreviewHtml}
                title="상세페이지 미리보기"
                sandbox="allow-scripts allow-same-origin"
                style={{
                  width: '100%',
                  height: '100%',
                  border: 'none',
                  minHeight: 600,
                  borderRadius: 8,
                  background: '#ffffff',
                  boxShadow: '0 2px 12px rgba(0,0,0,0.10)',
                }}
              />
            ) : (
              // 빈 상태 메시지
              <div
                style={{
                  height: '100%',
                  minHeight: 400,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 12,
                  background: '#ffffff',
                  borderRadius: 8,
                  border: `2px dashed ${C.border}`,
                  color: C.textSub,
                  textAlign: 'center',
                  padding: 32,
                }}
              >
                {/* 미리보기 플레이스홀더 아이콘 */}
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: '50%',
                    background: '#f5f5f5',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Download size={24} style={{ color: '#cccccc' }} />
                </div>
                <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>
                  AI로 상세페이지를 생성하면
                  <br />
                  여기에 미리보기가 표시됩니다.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ────────────── 전체 생성 중 로딩 오버레이 ────────────── */}
      {isGenerating && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(255, 255, 255, 0.75)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            zIndex: 100,
            backdropFilter: 'blur(2px)',
          }}
        >
          <Loader2
            size={40}
            style={{
              color: C.accent,
              animation: 'spin 1s linear infinite',
            }}
          />
          <span
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: C.text,
              fontFamily: 'system-ui, -apple-system, sans-serif',
            }}
          >
            생성 중...
          </span>

          {/* spin 키프레임 */}
          <style>{`
            @keyframes spin {
              from { transform: rotate(0deg); }
              to   { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      )}
    </div>
  );
}
