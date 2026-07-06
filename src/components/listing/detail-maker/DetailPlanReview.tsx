'use client';

/**
 * DetailPlanReview.tsx
 * 상세페이지 기획 확인 + 이미지 생성 위저드 뷰.
 * - 섹션 목록을 드래그 정렬 가능한 카드로 표시
 * - 이미지 섹션(hero, point)은 씬 프롬프트 편집 가능
 * - 텍스트 섹션은 읽기 전용 미리보기
 * - isHtmlReady=false일 때 로딩 인디케이터
 * - storyboard 빈 배열이면 이미지 기획 실패 안내
 */

import React, { useCallback } from 'react';
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { C } from '@/lib/design-tokens';
import { getSceneForSection } from '@/lib/detail-page/storyboard-mapping';
import type {
  DetailSection,
  SceneStoryboardItem,
  SectionContent,
} from '@/types/detail-page';

// 이미지 씬이 연결되는 섹션 타입
const IMAGE_SECTION_TYPES = new Set<SectionContent['type']>(['hero', 'point']);
const BRAND_PURPLE = '#6366f1';

// ── Props ──────────────────────────────────────────────────────────────────

export interface DetailPlanReviewProps {
  sections: DetailSection[];
  storyboard: SceneStoryboardItem[];
  uploadedUrls: string[];
  isHtmlReady: boolean;
  isGeneratingScenes: boolean;
  onSectionsChange: (sections: DetailSection[]) => void;
  onScenesChange: (scenes: SceneStoryboardItem[]) => void;
  onGenerate: () => void;
}

// ── 위저드 헤더 ─────────────────────────────────────────────────────────────

const STEP_HINTS: Record<1 | 2, string> = {
  1: '씬 연출 방향을 확인/수정하고 이미지를 생성하세요.',
  2: '생성된 이미지를 확인하고 필요하면 재생성하세요.',
};

function WizardHeader({ step }: { step: 1 | 2 }) {
  const steps = ['기획 확인', '이미지 생성'];
  return (
    <div
      style={{
        borderBottom: `1px solid ${C.border}`,
        background: C.bg,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '10px 16px',
          gap: '8px',
        }}
      >
        {steps.map((label, i) => {
          const s = (i + 1) as 1 | 2;
          const isActive = s === step;
          const isDone = s < step;
          return (
            <React.Fragment key={label}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '22px',
                    height: '22px',
                    borderRadius: '50%',
                    background: isActive || isDone ? BRAND_PURPLE : '#374151',
                    color: '#fff',
                    fontSize: '11px',
                    fontWeight: 700,
                  }}
                >
                  {isDone ? '✓' : s}
                </span>
                <span
                  style={{
                    fontSize: '13px',
                    fontWeight: isActive ? 700 : 400,
                    color: isActive ? C.text : C.textSub,
                  }}
                >
                  {label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div
                  style={{
                    flex: 1,
                    height: '1px',
                    background: isDone ? BRAND_PURPLE : '#374151',
                  }}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
      <div
        style={{
          padding: '0 16px 8px',
          fontSize: '11px',
          color: C.textMuted,
        }}
      >
        {STEP_HINTS[step]}
      </div>
    </div>
  );
}

// ── 섹션 타입 레이블 ────────────────────────────────────────────────────────

function getSectionLabel(type: string): string {
  const map: Record<string, string> = {
    hero: 'HERO',
    point: 'POINT',
    selling_points: 'SELLING POINTS',
    features: 'FEATURES',
    spec_table: 'SPEC',
    usage_steps: 'HOW TO USE',
    stats: 'STATS',
    warning: 'WARNING',
    cta: 'CTA',
    brand_header: 'BRAND',
    image_grid: 'IMAGE GRID',
    point_section: 'POINT SECTION',
    stat_callout: 'STAT CALLOUT',
    bar_chart: 'BAR CHART',
    why_icons: 'WHY ICONS',
    certifications: 'CERTIFICATIONS',
    infographic_steps: 'INFOGRAPHIC',
  };
  return map[type] ?? type.toUpperCase();
}

// ── 텍스트 미리보기 렌더러 ──────────────────────────────────────────────────

function PreviewRow({ primary, secondary, count, total }: { primary: string; secondary?: string; count?: number; total?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
      <div style={{ fontSize: '13px', fontWeight: 600, color: C.text, lineHeight: 1.3 }}>{primary}</div>
      {secondary && (
        <div style={{ fontSize: '11px', color: C.textSub, lineHeight: 1.3 }}>{secondary}</div>
      )}
      {total !== undefined && total > 1 && (
        <div style={{ fontSize: '10px', color: C.textMuted }}>외 {total - (count ?? 1)}개 항목</div>
      )}
    </div>
  );
}

function renderTextPreview(content: SectionContent): React.ReactNode {
  const subStyle: React.CSSProperties = { fontSize: '12px', color: C.textSub };

  switch (content.type) {
    case 'selling_points': {
      const first = content.points[0];
      return first ? (
        <PreviewRow
          primary={first.title}
          secondary={first.description}
          count={1}
          total={content.points.length}
        />
      ) : <div style={subStyle}>포인트 없음</div>;
    }
    case 'features': {
      const first = content.items[0];
      return first ? (
        <PreviewRow
          primary={first.title}
          secondary={first.description}
          count={1}
          total={content.items.length}
        />
      ) : <div style={subStyle}>항목 없음</div>;
    }
    case 'stats': {
      const first = content.stats[0];
      return first ? (
        <PreviewRow
          primary={`${first.value} ${first.label}`}
          count={1}
          total={content.stats.length}
        />
      ) : <div style={subStyle}>통계 없음</div>;
    }
    case 'spec_table': {
      const first = content.specs[0];
      return first ? (
        <PreviewRow
          primary={first.label}
          secondary={first.value}
          count={1}
          total={content.specs.length}
        />
      ) : <div style={subStyle}>사양 없음</div>;
    }
    case 'usage_steps': {
      const first = content.steps[0];
      return first ? (
        <PreviewRow
          primary={`1. ${first}`}
          count={1}
          total={content.steps.length}
        />
      ) : <div style={subStyle}>단계 없음</div>;
    }
    case 'warning': {
      const first = content.warnings[0];
      return first ? (
        <PreviewRow
          primary={first}
          count={1}
          total={content.warnings.length}
        />
      ) : <div style={subStyle}>주의사항 없음</div>;
    }
    case 'cta':
      return <PreviewRow primary={content.text || '(텍스트 없음)'} />;
    case 'brand_header':
      return (
        <PreviewRow
          primary={content.brandName || '(브랜드 없음)'}
          secondary={content.rightLabel}
        />
      );
    case 'image_grid':
      return (
        <PreviewRow
          primary={content.title || '이미지 그리드'}
          secondary={`${content.items.length}개 항목`}
        />
      );
    case 'point_section': {
      const first = content.items[0];
      return first ? (
        <PreviewRow
          primary={`${first.number}. ${first.title}`}
          secondary={first.description}
          count={1}
          total={content.items.length}
        />
      ) : <div style={subStyle}>항목 없음</div>;
    }
    case 'stat_callout': {
      const first = content.items[0];
      return first ? (
        <PreviewRow
          primary={`${first.value} ${first.label}`}
          count={1}
          total={content.items.length}
        />
      ) : <div style={subStyle}>항목 없음</div>;
    }
    case 'bar_chart': {
      const first = content.items[0];
      return first ? (
        <PreviewRow
          primary={first.label}
          secondary={`${first.displayValue} (${first.percentage}%)`}
          count={1}
          total={content.items.length}
        />
      ) : <div style={subStyle}>항목 없음</div>;
    }
    case 'why_icons': {
      const first = content.items[0];
      return first ? (
        <PreviewRow
          primary={`${first.icon} ${first.title}`}
          secondary={first.description}
          count={1}
          total={content.items.length}
        />
      ) : <div style={subStyle}>항목 없음</div>;
    }
    case 'certifications': {
      const first = content.items[0];
      return first ? (
        <PreviewRow
          primary={first.name}
          secondary={first.description}
          count={1}
          total={content.items.length}
        />
      ) : <div style={subStyle}>인증 없음</div>;
    }
    case 'infographic_steps': {
      const first = content.items[0];
      return first ? (
        <PreviewRow
          primary={`${first.icon} ${first.title}`}
          secondary={first.description}
          count={1}
          total={content.items.length}
        />
      ) : <div style={subStyle}>단계 없음</div>;
    }
    default:
      return <div style={subStyle}>텍스트 섹션</div>;
  }
}

// ── 이미지 섹션 카드 (hero / point) ────────────────────────────────────────

interface ImageSectionCardProps {
  section: DetailSection;
  scene: SceneStoryboardItem | undefined;
  uploadedUrls: string[];
  onPromptKoChange: (sceneId: string, promptKo: string) => void;
  onHeadlineChange: (sectionId: string, headline: string) => void;
  onUpdateScene: (updated: SceneStoryboardItem) => void;
}

function ImageSectionCard({
  section,
  scene,
  uploadedUrls,
  onPromptKoChange,
  onHeadlineChange,
  onUpdateScene,
}: ImageSectionCardProps) {
  const content = section.content;
  // hero / point 공통: headline 필드
  const headline = (content.type === 'hero' || content.type === 'point') ? content.headline : '';

  const sourceUrl =
    scene !== undefined ? uploadedUrls[scene.sourceImageIndex] ?? null : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {/* 헤드라인 입력 */}
      <input
        type="text"
        value={headline}
        onChange={(e) => onHeadlineChange(section.id, e.target.value)}
        placeholder="헤드라인"
        aria-label="헤드라인"
        style={{
          width: '100%',
          padding: '6px 8px',
          fontSize: '13px',
          border: `1px solid ${C.border}`,
          borderRadius: '6px',
          color: C.text,
          background: C.card,
          boxSizing: 'border-box',
        }}
      />

      {/* 소스 이미지 선택 버튼 목록 */}
      {scene && uploadedUrls.length > 0 && (
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {uploadedUrls.map((url, i) => (
            <button
              key={url}
              onClick={() => onUpdateScene({ ...scene, sourceImageIndex: i })}
              aria-label={`이미지 ${i + 1} 선택`}
              style={{
                position: 'relative',
                width: '40px',
                height: '40px',
                borderRadius: '4px',
                border: scene.sourceImageIndex === i ? `2px solid ${BRAND_PURPLE}` : '2px solid transparent',
                padding: 0,
                cursor: 'pointer',
                overflow: 'hidden',
                background: '#374151',
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              {scene.sourceImageIndex === i && (
                <div style={{
                  position: 'absolute', inset: 0,
                  background: 'rgba(109,40,217,0.4)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 16, color: '#fff', fontWeight: 700,
                  borderRadius: '3px',
                }}>✓</div>
              )}
            </button>
          ))}
        </div>
      )}

      {/* 소스 이미지 미리보기 */}
      {sourceUrl && (
        <>
          <div style={{ fontSize: 10, color: '#6b7280' }}>이 씬에 사용할 이미지</div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={sourceUrl}
            alt="소스 이미지"
            style={{
              width: '100%',
              height: '80px',
              objectFit: 'cover',
              borderRadius: '6px',
              border: `1px solid ${C.border}`,
          }}
        />
        </>
      )}

      {/* 모드 토글 (ai ↔ cleanup) */}
      {scene && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => onUpdateScene({ ...scene, mode: scene.mode === 'ai' ? 'cleanup' : 'ai' })}
            style={{
              background: scene.mode === 'ai' ? BRAND_PURPLE : '#059669',
              color: '#fff',
              border: 'none',
              borderRadius: '10px',
              padding: '3px 10px',
              fontSize: '11px',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            {scene.mode === 'ai' ? '⚡ AI 생성' : '✨ 배경 제거'}
          </button>
          <span style={{ fontSize: '10px', color: '#6b7280', lineHeight: 1.4 }}>
            {scene.mode === 'ai'
              ? 'Gemini로 새 씬 이미지 생성'
              : '원본 이미지 배경만 제거'}
          </span>
        </div>
      )}

      {/* 씬 연출 설명 — ai 모드일 때만 표시, 수정 가능 */}
      {scene && scene.mode === 'ai' && (
        <div>
          <div style={{ fontSize: '10px', color: '#6b7280', marginBottom: '3px' }}>
            씬 연출 설명 (수정 가능)
          </div>
          <textarea
            value={scene.promptKo || scene.prompt}
            onChange={(e) => onPromptKoChange(scene.id, e.target.value)}
            rows={3}
            placeholder="씬 연출 방향을 입력하세요"
            style={{
              width: '100%',
              padding: '6px 8px',
              fontSize: '12px',
              color: C.text,
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: '6px',
              lineHeight: 1.6,
              resize: 'vertical',
              outline: 'none',
              fontFamily: 'inherit',
              boxSizing: 'border-box',
            }}
          />
        </div>
      )}
    </div>
  );
}

// ── 텍스트 섹션 카드 ────────────────────────────────────────────────────────

function TextSectionCard({ section }: { section: DetailSection }) {
  return (
    <>
      {renderTextPreview(section.content)}
      {/* 텍스트 전용 섹션 안내 */}
      <div style={{ marginTop: '6px', fontSize: '10px', color: '#6b7280' }}>
        상세 편집은 다음 단계(상세페이지 에디터)에서 가능합니다
      </div>
    </>
  );
}

// ── 정렬 가능한 섹션 카드 래퍼 ─────────────────────────────────────────────

interface SortableCardProps {
  section: DetailSection;
  scene: SceneStoryboardItem | undefined;
  uploadedUrls: string[];
  onPromptKoChange: (sceneId: string, promptKo: string) => void;
  onHeadlineChange: (sectionId: string, headline: string) => void;
  onUpdateScene: (updated: SceneStoryboardItem) => void;
}

function SortableCard({
  section,
  scene,
  uploadedUrls,
  onPromptKoChange,
  onHeadlineChange,
  onUpdateScene,
}: SortableCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: section.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const isImageSection = IMAGE_SECTION_TYPES.has(section.content.type);

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        background: C.card,
        border: `1px solid ${C.border}`,
        borderLeft: isImageSection ? `3px solid ${BRAND_PURPLE}` : `3px solid transparent`,
        borderRadius: '8px',
        padding: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      {/* 카드 헤더 (드래그 핸들 + 타입 레이블) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          cursor: 'grab',
        }}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={14} style={{ color: C.textMuted, flexShrink: 0 }} />
        <span
          style={{
            fontSize: '10px',
            fontWeight: 700,
            letterSpacing: '0.05em',
            color: isImageSection ? BRAND_PURPLE : C.textSub,
            padding: '2px 6px',
            borderRadius: '4px',
            background: isImageSection
              ? 'rgba(99,102,241,0.1)'
              : C.tableHeader,
          }}
        >
          {getSectionLabel(section.type)}
        </span>
      </div>

      {/* 카드 본문 */}
      {isImageSection ? (
        <ImageSectionCard
          section={section}
          scene={scene}
          uploadedUrls={uploadedUrls}
          onPromptKoChange={onPromptKoChange}
          onHeadlineChange={onHeadlineChange}
          onUpdateScene={onUpdateScene}
        />
      ) : (
        <TextSectionCard section={section} />
      )}
    </div>
  );
}

// ── 메인 컴포넌트 ───────────────────────────────────────────────────────────

export default function DetailPlanReview({
  sections,
  storyboard,
  uploadedUrls,
  isHtmlReady,
  isGeneratingScenes,
  onSectionsChange,
  onScenesChange,
  onGenerate,
}: DetailPlanReviewProps) {
  // 씬 연출 한국어 설명 변경 핸들러 (prompt도 동기화 — Gemini 호출 시 promptKo 우선 사용)
  const handlePromptKoChange = useCallback(
    (sceneId: string, promptKo: string) => {
      onScenesChange(
        storyboard.map((s) =>
          s.id === sceneId ? { ...s, promptKo, prompt: promptKo } : s
        ),
      );
    },
    [storyboard, onScenesChange],
  );

  // 헤드라인 변경 핸들러 (hero / point 섹션)
  const handleHeadlineChange = useCallback(
    (sectionId: string, headline: string) => {
      onSectionsChange(
        sections.map((sec) => {
          if (sec.id !== sectionId) return sec;
          const c = sec.content;
          if (c.type === 'hero') {
            return { ...sec, content: { ...c, headline } };
          }
          if (c.type === 'point') {
            return { ...sec, content: { ...c, headline } };
          }
          return sec;
        }),
      );
    },
    [sections, onSectionsChange],
  );

  // 씬 전체 업데이트 핸들러 (sourceImageIndex, mode 변경 등)
  const handleUpdateScene = useCallback(
    (updated: SceneStoryboardItem) => {
      onScenesChange(
        storyboard.map((s) => (s.id === updated.id ? updated : s)),
      );
    },
    [storyboard, onScenesChange],
  );

  // DnD 드래그 완료 — 섹션 순서 변경 + storyboard sectionId 기준 재정렬
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIdx = sections.findIndex((s) => s.id === active.id);
      const newIdx = sections.findIndex((s) => s.id === over.id);
      if (oldIdx === -1 || newIdx === -1) return;

      const reorderedSections = arrayMove(sections, oldIdx, newIdx);
      onSectionsChange(reorderedSections);

      // storyboard도 sectionId 기준으로 이미지 섹션 순서에 맞게 재정렬
      const imageSections = reorderedSections.filter((s) =>
        IMAGE_SECTION_TYPES.has(s.content.type),
      );
      const reorderedStoryboard = imageSections
        .map((s) => storyboard.find((sc) => sc.sectionId === s.id))
        .filter((sc): sc is SceneStoryboardItem => sc != null);
      const unmapped = storyboard.filter((sc) => sc.sectionId === null);
      onScenesChange([...reorderedStoryboard, ...unmapped]);
    },
    [sections, storyboard, onSectionsChange, onScenesChange],
  );

  // ── 로딩 상태 ────────────────────────────────────────────────────────────
  if (!isHtmlReady) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          background: C.bg,
        }}
      >
        <WizardHeader step={1} />
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            color: C.textSub,
            fontSize: '14px',
          }}
        >
          <span
            style={{
              display: 'inline-block',
              width: '24px',
              height: '24px',
              border: `3px solid ${C.border}`,
              borderTopColor: BRAND_PURPLE,
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }}
          />
          텍스트 구조 생성 중...
        </div>
      </div>
    );
  }

  // ── 이미지 기획 없음 (storyboard 빈 배열) ───────────────────────────────
  const storyboardEmpty = storyboard.length === 0;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: C.bg,
      }}
    >
      <WizardHeader step={1} />

      {/* 섹션 목록 */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        {/* storyboard 없음 안내 */}
        {storyboardEmpty && (
          <div
            style={{
              padding: '10px 12px',
              background: 'rgba(217,119,6,0.08)',
              border: `1px solid rgba(217,119,6,0.25)`,
              borderRadius: '8px',
              fontSize: '13px',
              color: C.warning,
            }}
          >
            이미지 기획 생성 실패 — 섹션 저장 후 다시 시도하세요.
          </div>
        )}

        {/* DnD 섹션 카드 목록 */}
        <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={sections.map((s) => s.id)}
            strategy={verticalListSortingStrategy}
          >
            {sections.map((section) => {
              const scene = getSceneForSection(storyboard, section.id);
              return (
                <SortableCard
                  key={section.id}
                  section={section}
                  scene={scene}
                  uploadedUrls={uploadedUrls}
                  onPromptKoChange={handlePromptKoChange}
                  onHeadlineChange={handleHeadlineChange}
                  onUpdateScene={handleUpdateScene}
                />
              );
            })}
          </SortableContext>
        </DndContext>
      </div>

      {/* 하단 생성 버튼 */}
      <div
        style={{
          padding: '12px 16px',
          borderTop: `1px solid ${C.border}`,
          background: C.card,
        }}
      >
        <button
          type="button"
          onClick={onGenerate}
          disabled={isGeneratingScenes || storyboardEmpty}
          aria-label={isGeneratingScenes ? 'Gemini로 이미지 생성 중...' : '② Gemini로 이미지 생성 →'}
          style={{
            width: '100%',
            padding: '10px',
            borderRadius: '8px',
            border: 'none',
            background:
              isGeneratingScenes || storyboardEmpty ? C.border : BRAND_PURPLE,
            color: isGeneratingScenes || storyboardEmpty ? C.textSub : '#fff',
            fontSize: '14px',
            fontWeight: 700,
            cursor:
              isGeneratingScenes || storyboardEmpty
                ? 'not-allowed'
                : 'pointer',
            transition: 'background 0.15s',
          }}
        >
          {isGeneratingScenes ? '생성 중...' : '② Gemini로 이미지 생성 →'}
        </button>
      </div>
    </div>
  );
}
