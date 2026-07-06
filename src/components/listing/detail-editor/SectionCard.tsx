'use client';
import React, { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Sparkles, Trash2 } from 'lucide-react';
import { C } from '@/lib/design-tokens';
import type { DetailSection, SectionType, SectionContent, AttachedImage, PaletteName } from '@/types/detail-page';
import {
  isHeroContent,
  isSellingPointsContent,
  isFeaturesContent,
  isStatsContent,
  isSpecTableContent,
  isUsageStepsContent,
  isWarningContent,
  isCtaContent,
  isBrandHeaderContent,
  isPointContent,
  isImageGridContent,
  isClaudeLayoutContent,
} from '@/types/detail-page';
import SectionInstructionPanel from './SectionInstructionPanel';
import SectionImageAttachment from './SectionImageAttachment';
import SceneEditPanel from './SceneEditPanel';
import ClaudeLayoutEditor from '../detail-maker/ClaudeLayoutEditor';

interface SectionCardProps {
  section: DetailSection;
  isActive?: boolean;
  onAiEdit: (section: DetailSection, instruction: string) => Promise<void>;
  onDelete: (id: string) => void;
  onClick: (id: string) => void;
  /** 섹션 이미지 변경 콜백 */
  onImagesChange: (id: string, images: AttachedImage[]) => void;
  /** 현재 테마 팔레트 (배경 합성 모드에 사용) */
  palette: PaletteName;
  /** 섹션 이미지 AI 편집 콜백 */
  onSectionImageAiEdit?: (sectionId: string, imageUrl: string, imageIndex: number) => void;
  /** 씬 이미지 편집/재생성 (hero/point에서만 노출) */
  onSceneEdit?: (section: DetailSection, opts: { instruction: string; referenceImageUrls: string[] }) => Promise<void>;
  /** 원본 이미지 그대로 씬에 적용 (AI 생성 없음) */
  onSceneUseAsIs?: (section: DetailSection, url: string) => void;
  uploadedUrls?: string[];
  isSceneEditing?: boolean;
  sceneEditError?: string | null;
  prevSceneUrl?: string;
  onSceneUndo?: () => void;
  /** claude_layout 섹션 콘텐츠/이미지 업데이트 */
  onSectionUpdate?: (id: string, updates: Partial<import('@/types/detail-page').ClaudeLayoutContent> & { attachedImages?: AttachedImage[] }) => void;
}

// 섹션 타입별 한국어 레이블
const SECTION_TYPE_LABELS: Record<SectionType, string> = {
  hero: '히어로',
  selling_points: '셀링 포인트',
  features: '특징',
  stats: '통계',
  spec_table: '사양 테이블',
  usage_steps: '사용법',
  warning: '주의사항',
  cta: '구매 유도',
  brand_header: '브랜드 헤더',
  point: '포인트',
  image_grid: '이미지 그리드',
  point_section: 'POINT 섹션',
  stat_callout: '수치 강조',
  bar_chart: '바 차트',
  why_icons: 'WHY 아이콘',
  certifications: '인증 배지',
  infographic_steps: '사용법 인포그래픽',
  claude_layout: 'AI 레이아웃',
};

// 섹션 콘텐츠를 한 줄 요약 텍스트로 변환
function getSectionSummary(content: SectionContent): string {
  if (isHeroContent(content)) {
    return content.headline || '(제목 없음)';
  }
  if (isSellingPointsContent(content)) {
    return `${content.points.length}개 포인트`;
  }
  if (isFeaturesContent(content)) {
    return content.items.length > 0
      ? content.items[0].title || `${content.items.length}개 항목`
      : '(항목 없음)';
  }
  if (isStatsContent(content)) {
    return `${content.stats.length}개 통계`;
  }
  if (isSpecTableContent(content)) {
    return `${content.specs.length}개 사양`;
  }
  if (isUsageStepsContent(content)) {
    return `${content.steps.length}단계`;
  }
  if (isWarningContent(content)) {
    return `${content.warnings.length}개 주의사항`;
  }
  if (isCtaContent(content)) {
    return content.text || '(텍스트 없음)';
  }
  if (isBrandHeaderContent(content)) {
    return content.brandName || '(브랜드 없음)';
  }
  if (isPointContent(content)) {
    return content.headline || '(제목 없음)';
  }
  if (isImageGridContent(content)) {
    return `${content.items.length}개 이미지`;
  }
  if (isClaudeLayoutContent(content)) {
    return content.title || `${content.blocks.length}개 블록`;
  }
  return '';
}

export default function SectionCard({
  section,
  isActive = false,
  onAiEdit,
  onDelete,
  onClick,
  onImagesChange,
  palette,
  onSectionImageAiEdit,
  onSceneEdit,
  onSceneUseAsIs,
  uploadedUrls = [],
  isSceneEditing = false,
  sceneEditError = null,
  prevSceneUrl,
  onSceneUndo,
  onSectionUpdate,
}: SectionCardProps) {
  // AI 지시어 패널 표시 여부
  const [showPanel, setShowPanel] = useState(false);
  // AI 요청 진행 중 여부 (부모에서 관리하지 않으므로 로컬로 처리)
  const [isAiLoading, setIsAiLoading] = useState(false);

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

  const cardStyle: React.CSSProperties = {
    background: '#ffffff',
    border: `1px solid ${isActive ? C.accent : '#eeeeee'}`,
    borderRadius: 8,
    marginBottom: 8,
    overflow: 'hidden',
    boxShadow: isActive
      ? `0 0 0 2px ${C.accent}33`
      : '0 1px 3px rgba(0,0,0,0.06)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    cursor: 'pointer',
    transition: 'border-color 0.15s, box-shadow 0.15s',
  };

  // AI 수정 버튼 클릭 — 패널 토글 (카드 클릭 이벤트 전파 차단)
  const handleAiButtonClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowPanel((prev) => !prev);
  };

  // 삭제 버튼 클릭 (카드 클릭 이벤트 전파 차단)
  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(section.id);
  };

  // AI 지시어 전송
  const handleAiSubmit = async (instruction: string) => {
    setIsAiLoading(true);
    try {
      await onAiEdit(section, instruction);
    } finally {
      setIsAiLoading(false);
      setShowPanel(false);
    }
  };

  const [showScenePanel, setShowScenePanel] = useState(false);
  const canSceneEdit = !!onSceneEdit && (section.type === 'hero' || section.type === 'point');

  const typeLabel = SECTION_TYPE_LABELS[section.type];
  const summary = getSectionSummary(section.content);

  return (
    <div ref={setNodeRef} style={style}>
      <div style={cardStyle} onClick={() => onClick(section.id)}>
        {/* 카드 헤더 행 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 12px',
          }}
        >
          {/* 드래그 핸들 — 클릭 이벤트가 카드로 전파되지 않도록 stopPropagation */}
          <div
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
            style={{
              color: '#cccccc',
              cursor: 'grab',
              display: 'flex',
              alignItems: 'center',
              flexShrink: 0,
              touchAction: 'none',
            }}
            aria-label="드래그하여 순서 변경"
          >
            <GripVertical size={16} />
          </div>

          {/* 타입 뱃지 */}
          <span
            style={{
              padding: '2px 8px',
              borderRadius: 4,
              background: '#f3f3f3',
              color: C.text,
              fontSize: 11,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {typeLabel}
          </span>

          {/* 요약 텍스트 */}
          <span
            style={{
              flex: 1,
              fontSize: 13,
              color: C.textSub,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {summary}
          </span>

          {/* 씬 편집 버튼 (hero/point) */}
          {canSceneEdit && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowScenePanel(v => !v); }}
              style={{
                padding: '4px 8px', borderRadius: 5, flexShrink: 0,
                border: `1px solid ${showScenePanel ? '#7c3aed' : '#dddddd'}`,
                background: showScenePanel ? '#7c3aed10' : 'transparent',
                color: showScenePanel ? '#7c3aed' : C.textSub,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12,
                transition: 'border-color 0.15s, background 0.15s, color 0.15s',
              }}
            >
              <span>🎨</span>
              <span>씬 편집 {showScenePanel ? '▴' : '▾'}</span>
            </button>
          )}

          {/* AI 수정 버튼 */}
          <button
            onClick={handleAiButtonClick}
            title="AI로 수정"
            style={{
              padding: '4px 8px',
              borderRadius: 5,
              border: `1px solid ${showPanel ? C.accent : '#dddddd'}`,
              background: showPanel ? `${C.accent}10` : 'transparent',
              color: showPanel ? C.accent : C.textSub,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 12,
              flexShrink: 0,
              transition: 'border-color 0.15s, background 0.15s, color 0.15s',
            }}
          >
            <Sparkles size={13} />
            <span>AI 수정</span>
          </button>

          {/* 삭제 버튼 */}
          <button
            onClick={handleDeleteClick}
            title="섹션 삭제"
            style={{
              padding: 4,
              borderRadius: 5,
              border: 'none',
              background: 'transparent',
              color: '#bbbbbb',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              flexShrink: 0,
              transition: 'color 0.15s',
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.color = C.accent)
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.color = '#bbbbbb')
            }
          >
            <Trash2 size={14} />
          </button>
        </div>

        {/* AI 지시어 입력 패널 (토글) */}
        {showPanel && (
          <SectionInstructionPanel
            sectionType={section.type}
            initialInstruction={section.aiInstruction}
            isLoading={isAiLoading}
            onSubmit={handleAiSubmit}
          />
        )}

        {/* claude_layout 전용 편집 UI */}
        {isClaudeLayoutContent(section.content) && onSectionUpdate && (
          <div style={{ padding: '12px 16px', borderTop: `1px solid #f0f0f0` }}>
            <ClaudeLayoutEditor
              section={section}
              referenceUrls={uploadedUrls}
              onUpdate={(updates) => onSectionUpdate(section.id, updates)}
              onUploadFile={async (file) => {
                const reader = new FileReader();
                return new Promise((resolve, reject) => {
                  reader.onload = async (e) => {
                    const base64 = (e.target?.result as string).split(',')[1];
                    const res = await fetch('/api/image/upload-ai', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ imageBase64: base64, mimeType: file.type }),
                    });
                    const data = await res.json() as { success: boolean; url?: string };
                    if (data.success && data.url) resolve(data.url);
                    else reject(new Error('업로드 실패'));
                  };
                  reader.onerror = reject;
                  reader.readAsDataURL(file);
                });
              }}
            />
          </div>
        )}

        {/* 이미지 첨부 패널 */}
        <SectionImageAttachment
          images={section.attachedImages}
          palette={palette}
          sectionType={section.type}
          onChange={(imgs) => onImagesChange(section.id, imgs)}
          onAiEdit={
            onSectionImageAiEdit
              ? (url, idx) => onSectionImageAiEdit(section.id, url, idx)
              : undefined
          }
          referenceUrls={uploadedUrls}
        />

        {/* 씬 편집 패널 */}
        {showScenePanel && onSceneEdit && (
          <SceneEditPanel
            section={section}
            uploadedUrls={uploadedUrls}
            isEditing={isSceneEditing}
            error={sceneEditError}
            prevSceneUrl={prevSceneUrl}
            onEdit={async (opts) => {
              try {
                await onSceneEdit(section, opts);
                setShowScenePanel(false); // 성공 시만 닫힘
              } catch {
                // 실패 시 패널 유지 — 에러는 sceneEditError prop으로 표시
              }
            }}
            onUseAsIs={onSceneUseAsIs ? (url) => { onSceneUseAsIs(section, url); setShowScenePanel(false); } : undefined}
            onUndo={onSceneUndo}
            onClose={() => setShowScenePanel(false)}
          />
        )}
      </div>
    </div>
  );
}
