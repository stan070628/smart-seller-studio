'use client';

/**
 * FrameCard.tsx
 * 단일 프레임 미리보기 카드
 *
 * - 프레임 번호 + 한국어 이름 헤더
 * - 편집/완료 토글 버튼 (편집 모드에서 contentEditable 텍스트 편집 가능)
 * - ResizeObserver로 컨테이너 너비 측정 → 860px 기준 동적 scale
 * - 이미지 없을 때 점선 박스 → 이미지 추가 버튼 동작
 * - 호버 시 "이미지 저장" / "이미지 변경" 버튼 오버레이
 * - 이미지 변경: 업로드된 이미지 중 선택하는 팝오버
 * - imageDirection이 있으면 카드 하단에 촬영 팁 표시
 */

import React, { useRef, useState, forwardRef, useEffect, useCallback } from 'react';
import { Download, Loader2, ImagePlus, X, FileCode2, Trash2, Sparkles, Copy, Pencil } from 'lucide-react';
import type { FrameType } from '@/types/frames';
import { TEMPLATE_MAP, FRAME_LABEL_KO } from '@/components/templates';
import useEditorStore from '@/store/useEditorStore';
import type { GeneratedFrame } from '@/types/frames';
import type { UploadedImage } from '@/types/editor';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface FrameCardProps {
  frame: GeneratedFrame;
  /** 기본 이미지 URL (프레임별 지정이 없을 때 사용) */
  defaultImageUrl: string | null;
  /** 업로드된 전체 이미지 목록 (팝오버 선택용) */
  uploadedImages: UploadedImage[];
  frameIndex: number; // 1-based
}

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

const TEMPLATE_W = 780;
const TEMPLATE_H = 1100;

// ---------------------------------------------------------------------------
// 컴포넌트
// ---------------------------------------------------------------------------

const FrameCard = forwardRef<HTMLDivElement, FrameCardProps>(
  ({ frame, defaultImageUrl, uploadedImages, frameIndex }, ref) => {
    const [isHovered, setIsHovered] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [showPicker, setShowPicker] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [showImageAdjust, setShowImageAdjust] = useState(false);
    // 프롬프트 인라인 편집 상태
    const [isEditingPrompt, setIsEditingPrompt] = useState(false);
    const [promptDraft, setPromptDraft] = useState('');
    // AI 이미지 생성 에러 메시지
    const [aiGenError, setAiGenError] = useState<string | null>(null);
    // AI 이미지 생성 성공 피드백 (초록 테두리 flash)
    const [aiGenSuccess, setAiGenSuccess] = useState(false);

    // 컨테이너 너비 측정 → 동적 scale 계산
    const [containerWidth, setContainerWidth] = useState(560);
    const containerRef = useRef<HTMLDivElement>(null);

    const frameImages = useEditorStore((s) => s.frameImages);
    const setFrameImage = useEditorStore((s) => s.setFrameImage);
    const frameImageFit = useEditorStore((s) => s.frameImageFit);
    const setFrameImageFit = useEditorStore((s) => s.setFrameImageFit);
    const frameImageSettings = useEditorStore((s) => s.frameImageSettings);
    const setFrameImageSettings = useEditorStore((s) => s.setFrameImageSettings);
    const addImage = useEditorStore((s) => s.addImage);
    const updateFrame = useEditorStore((s) => s.updateFrame);
    const removeFrame = useEditorStore((s) => s.removeFrame);
    const theme = useEditorStore((s) => s.theme);
    const generatingImageForFrame = useEditorStore((s) => s.generatingImageForFrame);
    // store 액션명 충돌 방지를 위해 generateFrameImageAction으로 alias
    const generateFrameImageAction = useEditorStore((s) => s.generateFrameImage);

    // 슬롯 전체 맵 구성
    const frameSlots = frameImages[frame.frameType] ?? {};
    const assignedImageUrl = frameSlots['main'] ?? defaultImageUrl;
    const hasCustomImage = !!frameSlots['main'];

    // imageUrls: 슬롯 맵 복사 후 main 슬롯 기본값 보정
    const imageUrls: Record<string, string> = { ...frameSlots };
    if (!imageUrls['main'] && defaultImageUrl) {
      imageUrls['main'] = defaultImageUrl;
    }

    // 슬롯별 이미지 설정
    const slotSettings = frameImageSettings[frame.frameType] ?? {};

    const templateRef = useRef<HTMLDivElement>(null);
    const pickerRef = useRef<HTMLDivElement>(null);
    const pickerFileInputRef = useRef<HTMLInputElement>(null);

    const TemplateComponent = TEMPLATE_MAP[frame.frameType];
    const labelKo = FRAME_LABEL_KO[frame.frameType] ?? frame.frameType;
    const indexLabel = String(frameIndex).padStart(2, '0');

    // 동적 scale 계산 (너비 기준, 최대 0.55로 제한 — 다운로드 크기 영향 없음)
    const scale = Math.min(0.55, containerWidth / TEMPLATE_W);
    const previewWidth = Math.round(containerWidth);
    const previewHeight = Math.round(TEMPLATE_H * scale);

    // -----------------------------------------------------------------------
    // ResizeObserver: 컨테이너 너비 측정
    // -----------------------------------------------------------------------
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;

      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const width = entry.contentRect.width;
          if (width > 0) {
            setContainerWidth(width);
          }
        }
      });

      observer.observe(el);
      // 초기값 즉시 세팅
      setContainerWidth(el.getBoundingClientRect().width || 560);

      return () => {
        observer.disconnect();
      };
    }, []);

    // -----------------------------------------------------------------------
    // 팝오버 외부 클릭 시 닫기
    // -----------------------------------------------------------------------
    useEffect(() => {
      if (!showPicker) return;
      const handler = (e: MouseEvent) => {
        if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
          setShowPicker(false);
        }
      };
      document.addEventListener('mousedown', handler);
      return () => document.removeEventListener('mousedown', handler);
    }, [showPicker]);

    // -----------------------------------------------------------------------
    // onFieldChange: 점 표기법으로 frame 데이터 업데이트
    // -----------------------------------------------------------------------
    const handleFieldChange = useCallback(
      (field: string, value: unknown) => {
        // 항상 string으로 처리 (EditableText 에서 string만 전달)
        const strValue = String(value ?? '');
        if (field.startsWith('metadata.')) {
          const parts = field.split('.');
          const metaKey = parts[1];
          const indexStr = parts[2];
          const subKey = parts[3]; // solutions.0.answer 같은 경우

          if (subKey !== undefined) {
            // 객체 배열 항목의 특정 키 업데이트 (예: metadata.solutions.0.answer)
            const arr = Array.isArray(frame.metadata?.[metaKey])
              ? [...(frame.metadata[metaKey] as Record<string, string>[])]
              : [];
            const idx = Number(indexStr);
            arr[idx] = { ...(arr[idx] ?? {}), [subKey]: strValue };
            updateFrame(frame.frameType as FrameType, {
              metadata: { ...frame.metadata, [metaKey]: arr },
            });
          } else if (indexStr !== undefined) {
            // 문자열 배열 항목 업데이트 (예: metadata.painPoints.0)
            const arr = Array.isArray(frame.metadata?.[metaKey])
              ? [...(frame.metadata[metaKey] as string[])]
              : [];
            arr[Number(indexStr)] = strValue;
            updateFrame(frame.frameType as FrameType, {
              metadata: { ...frame.metadata, [metaKey]: arr },
            });
          } else {
            // metadata 직접 키 업데이트 (예: metadata.before)
            updateFrame(frame.frameType as FrameType, {
              metadata: { ...frame.metadata, [metaKey]: strValue },
            });
          }
        } else {
          // headline, subheadline, bodyText, ctaText 등 최상위 필드
          updateFrame(frame.frameType as FrameType, {
            [field]: strValue,
          } as Partial<GeneratedFrame>);
        }
      },
      [frame, updateFrame],
    );

    // -----------------------------------------------------------------------
    // 단일 프레임 JPG 저장
    // -----------------------------------------------------------------------
    const handleSaveImage = async () => {
      if (isSaving || !templateRef.current) return;
      setIsSaving(true);
      try {
        const { toJpeg } = await import('html-to-image');
        const dataUrl = await toJpeg(templateRef.current, {
          quality: 0.95,
          width: TEMPLATE_W,
          height: TEMPLATE_H,
          pixelRatio: 1,
          fontEmbedCSS: '', // cross-origin Google Fonts cssRules 접근 오류 방지
        });
        const link = document.createElement('a');
        link.download = `frame-${indexLabel}-${frame.frameType}.jpg`;
        link.href = dataUrl;
        link.click();
      } catch (err) {
        console.error('[FrameCard] 이미지 저장 오류:', err);
        window.alert('이미지 저장에 실패했습니다. 다시 시도해주세요.');
      } finally {
        setIsSaving(false);
      }
    };

    // -----------------------------------------------------------------------
    // 피그마용 고해상도 PNG 저장 (2× pixelRatio → 1560×2200px)
    // html-to-image의 toSvg는 <foreignObject> 기반이라 Figma에서 지원 안 됨
    // -----------------------------------------------------------------------
    const handleSaveSvg = async () => {
      if (isSaving || !templateRef.current) return;
      setIsSaving(true);
      try {
        const { toPng } = await import('html-to-image');
        const dataUrl = await toPng(templateRef.current, {
          quality: 1,
          width: TEMPLATE_W,
          height: TEMPLATE_H,
          pixelRatio: 2,
          fontEmbedCSS: '', // cross-origin Google Fonts cssRules 접근 오류 방지
        });
        const link = document.createElement('a');
        link.download = `frame-${indexLabel}-${frame.frameType}@2x.png`;
        link.href = dataUrl;
        link.click();
      } catch (err) {
        console.error('[FrameCard] 피그마용 PNG 저장 오류:', err);
        window.alert('저장에 실패했습니다. 다시 시도해주세요.');
      } finally {
        setIsSaving(false);
      }
    };

    // -----------------------------------------------------------------------
    // 이미지 선택 핸들러
    // -----------------------------------------------------------------------
    const handleSelectImage = (img: UploadedImage) => {
      const url = img.storageUrl ?? img.url;
      setFrameImage(frame.frameType as FrameType, 'main', url);
      setShowPicker(false);
    };

    const handleRemoveCustomImage = (e: React.MouseEvent) => {
      e.stopPropagation();
      setFrameImage(frame.frameType as FrameType, 'main', null);
    };

    // PC 파일 선택 → 스토어에 추가 후 이 프레임에 적용
    const handlePickerFileSelect = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const url = URL.createObjectURL(file);
        const newImg: UploadedImage = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: file.name,
          url,
          size: file.size,
          uploadedAt: new Date().toISOString(),
          uploadStatus: 'done',
        };
        addImage(newImg);
        setFrameImage(frame.frameType as FrameType, 'main', url);
        setShowPicker(false);
        // input 초기화 (같은 파일 재선택 가능)
        e.target.value = '';
      },
      [addImage, setFrameImage, frame.frameType],
    );

    // 이미지 추가 버튼 클릭 → 항상 팝오버 열기 (이미지 없으면 안내 메시지 표시)
    const handleImageAdd = () => {
      setShowPicker(true);
    };

    // AI 이미지 생성 버튼 클릭 핸들러
    const handleGenerateAIImage = async () => {
      setAiGenError(null);
      try {
        await generateFrameImageAction(frame.frameType as FrameType);
        setShowPicker(false);
        // 성공 피드백: 1.5초간 초록 테두리 flash
        setAiGenSuccess(true);
        setTimeout(() => setAiGenSuccess(false), 1500);
      } catch (err) {
        console.error('[FrameCard] AI 이미지 생성 오류:', err);
        setAiGenError(err instanceof Error ? err.message : '이미지 생성에 실패했습니다.');
      }
    };

    // 프롬프트 편집 시작
    const handleStartEditPrompt = () => {
      setPromptDraft(frame.imagePrompt ?? '');
      setIsEditingPrompt(true);
    };

    // 프롬프트 편집 완료 (blur 또는 Shift+Enter)
    const handleFinishEditPrompt = () => {
      const trimmed = promptDraft.trim();
      if (trimmed && trimmed !== frame.imagePrompt) {
        updateFrame(frame.frameType as FrameType, { imagePrompt: trimmed });
      }
      setIsEditingPrompt(false);
    };

    // 프롬프트 textarea 키 입력 처리
    const handlePromptKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        handleFinishEditPrompt();
      }
      if (e.key === 'Escape') {
        setIsEditingPrompt(false);
      }
    };

    // 프롬프트 클립보드 복사
    const handleCopyPrompt = () => {
      if (frame.imagePrompt) {
        navigator.clipboard.writeText(frame.imagePrompt).catch((err) => {
          console.error('[FrameCard] 클립보드 복사 오류:', err);
        });
      }
    };

    // 현재 프레임의 생성 진행 중 여부
    const isGeneratingThisFrame = generatingImageForFrame === frame.frameType;

    // 다른 프레임 생성 중 (동시 생성 1개 제한)
    const isAnotherFrameGenerating = generatingImageForFrame !== null && !isGeneratingThisFrame;

    return (
      <div
        ref={ref}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          position: 'relative',
          maxWidth: '960px',
          margin: '0 auto',
          width: '100%',
        }}
      >
        {/* 카드 헤더 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 2px' }}>
          <span style={{ fontFamily: 'monospace', fontSize: '12px', color: '#6366f1', fontWeight: '700' }}>
            {indexLabel}
          </span>
          <span style={{ fontSize: '13px', color: '#d1d5db', fontWeight: '500' }}>
            {labelKo}
          </span>
          {hasCustomImage && (
            <span
              style={{
                fontSize: '10px',
                color: '#34d399',
                backgroundColor: '#064e3b',
                padding: '1px 6px',
                borderRadius: '4px',
                fontWeight: '600',
              }}
            >
              커스텀
            </span>
          )}

          {/* 이미지 변경 아이콘 버튼 (상시 노출) */}
          <button
            onClick={(e) => { e.stopPropagation(); setShowPicker((v) => !v); }}
            title="이미지 변경"
            style={{
              marginLeft: 'auto',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '4px 8px',
              fontSize: '12px',
              borderRadius: '6px',
              border: showPicker ? '1px solid #6366f1' : '1px solid #3f3f46',
              backgroundColor: showPicker ? 'rgba(99,102,241,0.15)' : 'transparent',
              color: showPicker ? '#818cf8' : '#71717a',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            <ImagePlus size={13} />
          </button>

          {/* 저장 아이콘 버튼 (상시 노출) */}
          <button
            onClick={handleSaveImage}
            disabled={isSaving}
            title="이미지 저장"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '4px 8px',
              fontSize: '12px',
              borderRadius: '6px',
              border: '1px solid #3f3f46',
              backgroundColor: 'transparent',
              color: isSaving ? '#52525b' : '#71717a',
              cursor: isSaving ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {isSaving ? <Loader2 size={13} /> : <Download size={13} />}
          </button>

          {/* 이미지 조정 버튼 */}
          <button
            onClick={() => setShowImageAdjust((v) => !v)}
            style={{
              padding: '4px 12px',
              fontSize: '12px',
              fontWeight: '600',
              borderRadius: '6px',
              border: showImageAdjust ? '1px solid #f59e0b' : '1px solid #3f3f46',
              backgroundColor: showImageAdjust ? 'rgba(245,158,11,0.15)' : 'transparent',
              color: showImageAdjust ? '#fbbf24' : '#71717a',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            이미지 조정
          </button>

          {/* 편집 토글 버튼 */}
          <button
            onClick={() => {
              if (isEditing) {
                // 편집 종료 전 contenteditable 요소 blur 강제 호출 → 마지막 입력 누락 방지
                templateRef.current
                  ?.querySelectorAll('[contenteditable]')
                  .forEach((el) => (el as HTMLElement).blur());
              }
              setIsEditing((v) => !v);
            }}
            style={{
              padding: '4px 12px',
              fontSize: '12px',
              fontWeight: '600',
              borderRadius: '6px',
              border: isEditing ? '1px solid #6366f1' : '1px solid #3f3f46',
              backgroundColor: isEditing ? 'rgba(99,102,241,0.15)' : 'transparent',
              color: isEditing ? '#818cf8' : '#71717a',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {isEditing ? '완료' : '편집'}
          </button>

          {/* 삭제 버튼 */}
          <button
            onClick={() => {
              if (window.confirm(`"${labelKo}" 템플릿을 삭제할까요?`)) {
                removeFrame(frame.frameType as FrameType);
              }
            }}
            title="템플릿 삭제"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '4px 8px',
              fontSize: '12px',
              borderRadius: '6px',
              border: '1px solid #3f3f46',
              backgroundColor: 'transparent',
              color: '#71717a',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = '#ef4444';
              (e.currentTarget as HTMLButtonElement).style.color = '#ef4444';
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(239,68,68,0.1)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = '#3f3f46';
              (e.currentTarget as HTMLButtonElement).style.color = '#71717a';
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
            }}
          >
            <Trash2 size={13} />
          </button>
        </div>

        {/* 미리보기 래퍼 — 컨테이너 너비 측정용 */}
        <div ref={containerRef} style={{ width: '100%' }}>
          <div
            style={{
              position: 'relative',
              width: `${previewWidth}px`,
              height: `${previewHeight}px`,
              borderRadius: '10px',
              overflow: 'hidden',
              cursor: isEditing ? 'default' : 'pointer',
              border: isEditing
                ? '2px solid #6366f1'
                : aiGenSuccess
                  ? '2px solid #34d399'
                  : hasCustomImage
                    ? '1px solid #34d399'
                    : '1px solid #27272a',
              boxShadow: isEditing
                ? '0 0 0 2px rgba(99,102,241,0.2)'
                : aiGenSuccess
                  ? '0 0 0 3px rgba(52,211,153,0.3)'
                  : '0 2px 8px rgba(0,0,0,0.3)',
              transition: 'border 0.3s, box-shadow 0.3s',
            }}
            onMouseEnter={() => !isEditing && setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
          >
            {/* 실제 780×1100 템플릿 (scale로 축소 표시) */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                transformOrigin: 'top left',
                transform: `scale(${scale})`,
                width: `${TEMPLATE_W}px`,
                height: `${TEMPLATE_H}px`,
                // 편집 모드가 아닐 때는 포인터 이벤트 차단
                pointerEvents: isEditing ? 'auto' : 'none',
                userSelect: isEditing ? 'text' : 'none',
              }}
            >
              <div ref={templateRef} style={{ width: `${TEMPLATE_W}px`, height: `${TEMPLATE_H}px` }}>
                <TemplateComponent
                  frame={frame}
                  imageUrl={assignedImageUrl}
                  imageUrls={imageUrls}
                  isEditable={isEditing}
                  onFieldChange={handleFieldChange}
                  onImageAdd={handleImageAdd}
                  theme={theme}
                  imageFit={frameImageFit[frame.frameType]?.['main'] ?? 'cover'}
                  imageScale={slotSettings['main']?.scale ?? 1}
                  imageOffsetX={slotSettings['main']?.x ?? 50}
                  imageOffsetY={slotSettings['main']?.y ?? 50}
                  imageSlotSettings={slotSettings}
                />
              </div>
            </div>

            {/* 호버 오버레이 (편집 모드가 아닐 때만) */}
            {isHovered && !isEditing && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  backgroundColor: 'rgba(0,0,0,0.6)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '10px',
                  zIndex: 10,
                }}
              >
                {/* 이미지 저장 버튼 */}
                <button
                  onClick={handleSaveImage}
                  disabled={isSaving}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    backgroundColor: '#6366f1',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '10px',
                    padding: '9px 16px',
                    fontSize: '13px',
                    fontWeight: '600',
                    cursor: isSaving ? 'not-allowed' : 'pointer',
                    opacity: isSaving ? 0.7 : 1,
                    width: '140px',
                    justifyContent: 'center',
                  }}
                >
                  {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  {isSaving ? '저장 중...' : '이미지 저장'}
                </button>

                {/* 피그마용 고해상도 PNG 저장 버튼 */}
                <button
                  onClick={handleSaveSvg}
                  disabled={isSaving}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    backgroundColor: '#18181b',
                    color: '#a1a1aa',
                    border: '1px solid #3f3f46',
                    borderRadius: '10px',
                    padding: '9px 16px',
                    fontSize: '13px',
                    fontWeight: '600',
                    cursor: isSaving ? 'not-allowed' : 'pointer',
                    opacity: isSaving ? 0.7 : 1,
                    width: '140px',
                    justifyContent: 'center',
                  }}
                >
                  {isSaving ? <Loader2 size={14} className="animate-spin" /> : <FileCode2 size={14} />}
                  {isSaving ? '저장 중...' : '피그마용 PNG'}
                </button>

                {/* 이미지 변경 버튼 (항상 표시) */}
                <button
                  onClick={(e) => { e.stopPropagation(); setShowPicker((v) => !v); }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    backgroundColor: '#18181b',
                    color: '#a1a1aa',
                    border: '1px solid #3f3f46',
                    borderRadius: '10px',
                    padding: '9px 16px',
                    fontSize: '13px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    width: '140px',
                    justifyContent: 'center',
                  }}
                >
                  <ImagePlus size={14} />
                  이미지 변경
                </button>

                {/* AI 이미지 생성 버튼 — imagePrompt 있을 때 (hero 포함 모든 프레임) */}
                {frame.imagePrompt && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setAiGenError(null);
                      generateFrameImageAction(frame.frameType as FrameType)
                        .then(() => {
                          setAiGenSuccess(true);
                          setTimeout(() => setAiGenSuccess(false), 1500);
                        })
                        .catch((err: unknown) => {
                          setAiGenError(err instanceof Error ? err.message : '이미지 생성에 실패했습니다.');
                        });
                    }}
                    disabled={isGeneratingThisFrame || isAnotherFrameGenerating}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      backgroundColor: isGeneratingThisFrame || isAnotherFrameGenerating
                        ? 'rgba(99,102,241,0.1)'
                        : 'rgba(99,102,241,0.25)',
                      color: '#818cf8',
                      border: '1px solid #6366f1',
                      borderRadius: '10px',
                      padding: '9px 16px',
                      fontSize: '13px',
                      fontWeight: '600',
                      cursor: isGeneratingThisFrame || isAnotherFrameGenerating ? 'not-allowed' : 'pointer',
                      width: '140px',
                      justifyContent: 'center',
                      opacity: isAnotherFrameGenerating ? 0.5 : 1,
                    }}
                  >
                    {isGeneratingThisFrame ? (
                      <><Loader2 size={14} className="animate-spin" />생성 중...</>
                    ) : (
                      <><Sparkles size={14} />AI 이미지</>
                    )}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 이미지 조정 패널 */}
        {showImageAdjust && (
          <div style={{
            backgroundColor: '#18181b',
            border: '1px solid #3f3f46',
            borderRadius: '10px',
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}>
            <span style={{ fontSize: '11px', color: '#f59e0b', fontWeight: '700', letterSpacing: '0.05em' }}>
              이미지 조정
            </span>

            {/* 크기/좌우/상하 슬라이더 */}
            {[
              { label: '크기', key: 'scale' as const, min: 0.5, max: 3, step: 0.05, value: frameImageSettings[frame.frameType]?.['main']?.scale ?? 1, format: (v: number) => `${Math.round(v * 100)}%` },
              { label: '좌우', key: 'x' as const, min: 0, max: 100, step: 1, value: frameImageSettings[frame.frameType]?.['main']?.x ?? 50, format: (v: number) => `${v}` },
              { label: '상하', key: 'y' as const, min: 0, max: 100, step: 1, value: frameImageSettings[frame.frameType]?.['main']?.y ?? 50, format: (v: number) => `${v}` },
            ].map(({ label, key, min, max, step, value, format }) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '11px', color: '#a1a1aa', width: '28px', flexShrink: 0 }}>{label}</span>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={value}
                  onChange={(e) => setFrameImageSettings(frame.frameType as FrameType, 'main', { [key]: parseFloat(e.target.value) })}
                  style={{ flex: 1, accentColor: '#f59e0b', cursor: 'pointer' }}
                />
                <span style={{ fontSize: '11px', color: '#71717a', width: '36px', textAlign: 'right', flexShrink: 0 }}>
                  {format(value)}
                </span>
              </div>
            ))}

            {/* 초기화 버튼 */}
            <button
              onClick={() => setFrameImageSettings(frame.frameType as FrameType, 'main', { scale: 1, x: 50, y: 50 })}
              style={{
                marginTop: '2px',
                padding: '5px',
                backgroundColor: 'transparent',
                border: '1px solid #3f3f46',
                borderRadius: '6px',
                color: '#71717a',
                fontSize: '11px',
                cursor: 'pointer',
                width: '100%',
              }}
            >
              초기화
            </button>
          </div>
        )}

        {/* 이미지 선택 팝오버 */}
        {showPicker && (
          <div
            ref={pickerRef}
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              zIndex: 50,
              marginTop: '8px',
              backgroundColor: '#18181b',
              border: '1px solid #3f3f46',
              borderRadius: '12px',
              padding: '12px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              width: `${Math.min(previewWidth, 320)}px`,
            }}
          >
            {/* 숨겨진 file input */}
            <input
              ref={pickerFileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handlePickerFileSelect}
            />

            {/* 팝오버 헤더 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <span style={{ fontSize: '12px', color: '#a1a1aa', fontWeight: '600' }}>
                이미지 선택
              </span>
              <button
                onClick={() => setShowPicker(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#71717a', padding: '2px' }}
              >
                <X size={14} />
              </button>
            </div>

            {/* PC 업로드 버튼 */}
            <button
              onClick={() => pickerFileInputRef.current?.click()}
              style={{
                width: '100%',
                marginBottom: '10px',
                padding: '8px',
                backgroundColor: 'rgba(99,102,241,0.1)',
                border: '1px dashed #6366f1',
                borderRadius: '8px',
                color: '#818cf8',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
              }}
            >
              <ImagePlus size={13} />
              PC에서 새 사진 업로드
            </button>

            {/* 이미지 그리드 — 업로드된 이미지 없을 때 안내 */}
            {uploadedImages.length === 0 ? (
              <p style={{
                margin: '0 0 10px',
                padding: '12px',
                fontSize: '12px',
                color: '#71717a',
                textAlign: 'center',
                backgroundColor: '#09090b',
                borderRadius: '8px',
                border: '1px dashed #3f3f46',
              }}>
                업로드된 이미지가 없습니다.
                <br />
                위 버튼으로 새 사진을 업로드해주세요.
              </p>
            ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '0' }}>
              {uploadedImages.map((img) => {
                const url = img.storageUrl ?? img.url;
                const isSelected = frameImages[frame.frameType]?.['main'] === url;
                return (
                  <button
                    key={img.id}
                    onClick={() => handleSelectImage(img)}
                    style={{
                      padding: 0,
                      border: isSelected ? '2px solid #6366f1' : '2px solid transparent',
                      borderRadius: '8px',
                      overflow: 'hidden',
                      cursor: 'pointer',
                      aspectRatio: '1',
                      position: 'relative',
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt={img.name}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                    {isSelected && (
                      <div style={{
                        position: 'absolute', inset: 0,
                        backgroundColor: 'rgba(99,102,241,0.3)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <span style={{ color: '#fff', fontSize: '18px', fontWeight: '700' }}>✓</span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            )}

            {/* 이미지 Fit 설정 */}
            <div style={{ marginTop: '10px', display: 'flex', gap: '6px' }}>
              <span style={{ fontSize: '11px', color: '#71717a', alignSelf: 'center' }}>맞춤:</span>
              {(['cover', 'contain'] as const).map((fit) => {
                const active = (frameImageFit[frame.frameType]?.['main'] ?? 'cover') === fit;
                return (
                  <button
                    key={fit}
                    onClick={() => setFrameImageFit(frame.frameType as FrameType, 'main', fit)}
                    style={{
                      flex: 1,
                      padding: '5px',
                      fontSize: '11px',
                      borderRadius: '6px',
                      border: active ? '1px solid #6366f1' : '1px solid #3f3f46',
                      backgroundColor: active ? 'rgba(99,102,241,0.15)' : 'transparent',
                      color: active ? '#818cf8' : '#71717a',
                      cursor: 'pointer',
                      fontWeight: active ? '600' : '400',
                    }}
                  >
                    {fit === 'cover' ? '꽉 채우기' : '맞춤 보기'}
                  </button>
                );
              })}
            </div>

            {/* 커스텀 이미지 해제 버튼 */}
            {hasCustomImage && (
              <button
                onClick={handleRemoveCustomImage}
                style={{
                  marginTop: '10px',
                  width: '100%',
                  padding: '7px',
                  backgroundColor: 'transparent',
                  border: '1px solid #3f3f46',
                  borderRadius: '8px',
                  color: '#71717a',
                  fontSize: '12px',
                  cursor: 'pointer',
                }}
              >
                기본 이미지로 되돌리기
              </button>
            )}

            {/* AI 이미지 생성 영역 — 모든 프레임 (hero 포함) */}
            <>
              {/* 구분선 */}
              <hr style={{ margin: '12px 0 10px', border: 'none', borderTop: '1px solid #27272a' }} />

              {/* Task 3-3: 프롬프트 미리보기 + 편집 UI */}
                {frame.imagePrompt && (
                  <div style={{ marginBottom: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '5px' }}>
                      <span style={{ fontSize: '10px', color: '#6366f1', fontWeight: '700', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                        AI 프롬프트
                      </span>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {/* 복사 버튼 */}
                        <button
                          onClick={handleCopyPrompt}
                          title="프롬프트 복사"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '3px',
                            padding: '3px 7px',
                            backgroundColor: 'transparent',
                            border: '1px solid #3f3f46',
                            borderRadius: '5px',
                            color: '#71717a',
                            fontSize: '10px',
                            cursor: 'pointer',
                          }}
                        >
                          <Copy size={10} />
                          복사
                        </button>
                        {/* 수정 버튼 */}
                        <button
                          onClick={handleStartEditPrompt}
                          title="프롬프트 수정"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '3px',
                            padding: '3px 7px',
                            backgroundColor: isEditingPrompt ? 'rgba(99,102,241,0.15)' : 'transparent',
                            border: isEditingPrompt ? '1px solid #6366f1' : '1px solid #3f3f46',
                            borderRadius: '5px',
                            color: isEditingPrompt ? '#818cf8' : '#71717a',
                            fontSize: '10px',
                            cursor: 'pointer',
                          }}
                        >
                          <Pencil size={10} />
                          수정
                        </button>
                      </div>
                    </div>

                    {/* 편집 모드: textarea */}
                    {isEditingPrompt ? (
                      <div>
                        <textarea
                          value={promptDraft}
                          onChange={(e) => setPromptDraft(e.target.value)}
                          onBlur={handleFinishEditPrompt}
                          onKeyDown={handlePromptKeyDown}
                          autoFocus
                          rows={3}
                          style={{
                            width: '100%',
                            padding: '7px 9px',
                            backgroundColor: '#09090b',
                            border: '1px solid #6366f1',
                            borderRadius: '7px',
                            color: '#d4d4d8',
                            fontSize: '11px',
                            lineHeight: '1.5',
                            resize: 'vertical',
                            outline: 'none',
                            fontFamily: 'inherit',
                            boxSizing: 'border-box',
                          }}
                        />
                        <p style={{ margin: '3px 0 0', fontSize: '10px', color: '#52525b' }}>
                          Shift+Enter 또는 포커스 해제 시 저장
                        </p>
                      </div>
                    ) : (
                      /* 읽기 전용 텍스트 — 최대 2줄 말줄임 */
                      <p
                        style={{
                          margin: 0,
                          fontSize: '11px',
                          color: '#a1a1aa',
                          lineHeight: '1.5',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                          backgroundColor: '#09090b',
                          padding: '6px 9px',
                          borderRadius: '7px',
                          border: '1px solid #27272a',
                          cursor: 'text',
                        }}
                        onClick={handleStartEditPrompt}
                        title={frame.imagePrompt}
                      >
                        {frame.imagePrompt}
                      </p>
                    )}
                  </div>
                )}

              {/* AI 이미지 생성 버튼 */}
              <button
                onClick={handleGenerateAIImage}
                disabled={isGeneratingThisFrame || isAnotherFrameGenerating || !frame.imagePrompt}
                style={{
                  width: '100%',
                  padding: '9px',
                  backgroundColor:
                    isGeneratingThisFrame || isAnotherFrameGenerating || !frame.imagePrompt
                      ? 'rgba(99,102,241,0.1)'
                      : 'rgba(99,102,241,0.2)',
                  border: '1px solid #6366f1',
                  borderRadius: '8px',
                  color:
                    isGeneratingThisFrame || isAnotherFrameGenerating || !frame.imagePrompt
                      ? '#6366f1'
                      : '#818cf8',
                  fontSize: '12px',
                  fontWeight: '600',
                  cursor:
                    isGeneratingThisFrame || isAnotherFrameGenerating || !frame.imagePrompt
                      ? 'not-allowed'
                      : 'pointer',
                  opacity:
                    isAnotherFrameGenerating || !frame.imagePrompt ? 0.5 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  transition: 'all 0.15s',
                }}
              >
                {isGeneratingThisFrame ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    이미지 생성 중...
                  </>
                ) : (
                  <>
                    <Sparkles size={13} />
                    {frame.needsProductImage === true
                      ? 'AI 이미지 생성 (상품 참조)'
                      : 'AI 이미지 생성'}
                  </>
                )}
              </button>
            </>
          </div>
        )}

        {/* 촬영 팁 — 커스텀 이미지 또는 프레임 지정 이미지가 있으면 숨김 */}
        {frame.imageDirection && !hasCustomImage && !frameImages[frame.frameType]?.['main'] && (
          <p style={{ fontSize: '11px', color: '#71717a', margin: 0, lineHeight: '1.5', padding: '0 2px' }}>
            <span style={{ color: '#6366f1', fontWeight: '600' }}>촬영 팁: </span>
            {frame.imageDirection}
          </p>
        )}

        {/* AI 이미지 생성 에러 — 카드 하단 고정 (수동 닫기 가능) */}
        {aiGenError && (
          <div style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px',
            padding: '10px 12px',
            backgroundColor: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: '8px',
          }}>
            <p style={{ flex: 1, margin: 0, fontSize: '12px', color: '#f87171', lineHeight: '1.5' }}>
              {aiGenError}
            </p>
            <button
              onClick={() => setAiGenError(null)}
              style={{
                flexShrink: 0,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: '#71717a',
                padding: '1px',
                lineHeight: 0,
              }}
              title="닫기"
            >
              <X size={13} />
            </button>
          </div>
        )}
      </div>
    );
  },
);

FrameCard.displayName = 'FrameCard';

export default FrameCard;
