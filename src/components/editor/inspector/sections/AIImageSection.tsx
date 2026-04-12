'use client';

/**
 * AIImageSection.tsx
 * 인스펙터 패널 — AI 이미지 통합 섹션
 *
 * PromptSection + AIGenerateSection을 하나의 섹션으로 통합:
 *   1. 섹션 헤더 "AI 이미지"
 *   2. 연출 안내 카드 (편집 가능 — 수정 완료 시 프롬프트 자동 재생성)
 *   3. 이미지 참조 세그먼트 컨트롤 (상품 포함 / AI 순수 생성)
 *   4. 프롬프트 접기/펼치기 (textarea + 복사 버튼)
 *   5. AI 이미지 생성 버튼 (로딩/성공/에러 상태)
 *
 * 변경 2: TEXT_ONLY_FRAMES에 해당하는 프레임은 섹션을 비활성화 처리
 * 변경 3: hero는 이미지 있는 프레임으로 정상 동작
 */

import React, { useRef, useState } from 'react';
import {
  Wand2,
  Loader2,
  Copy,
  Check,
  X,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
  Pencil,
} from 'lucide-react';
import type { FrameType, GeneratedFrame } from '@/types/frames';
import useEditorStore from '@/store/useEditorStore';

// ─────────────────────────────────────────────────────────────
// 이미지 영역이 없는 텍스트 전용 프레임 목록
// hero, pain_point, detail_1, detail_2, spec, custom_3col,
// custom_gallery 는 이미지 있는 프레임이므로 포함하지 않음
// ─────────────────────────────────────────────────────────────
const TEXT_ONLY_FRAMES: FrameType[] = [
  'before_after',
  'cta',
  'faq',
  'social_proof',
  'solution',
  'target',
  'usp',
  'custom_notice',
  'custom_return_notice',
  'custom_privacy',
];

interface AIImageSectionProps {
  frameType: FrameType;
  /** 프레임 인스턴스 고유 ID */
  frameId: string;
  imagePrompt?: string | null;
  imageDirection?: string | null;
  needsProductImage?: boolean;
  /** 현재 프레임의 텍스트 필드 (프롬프트 갱신 요청에 사용) */
  frame?: GeneratedFrame;
  /** 현재 활성 슬롯 키 — AI 생성 결과를 저장할 대상 슬롯 */
  activeSlotKey?: string;
}

const AIImageSection: React.FC<AIImageSectionProps> = ({
  frameType,
  frameId,
  imagePrompt,
  imageDirection,
  needsProductImage,
  frame,
  activeSlotKey = 'main',
}) => {
  // 프롬프트 접기/펼치기 상태 (기본: 접힘)
  const [showPrompt, setShowPrompt] = useState(false);
  // 클립보드 복사 성공 상태
  const [copied, setCopied] = useState(false);
  // AI 이미지 생성 에러/성공 상태
  const [aiGenError, setAiGenError] = useState<string | null>(null);
  const [aiGenSuccess, setAiGenSuccess] = useState(false);
  // 프롬프트 갱신 로딩/에러 상태
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);

  // ─── 변경 1: 연출 안내 편집 상태 ───
  const [isEditingDirection, setIsEditingDirection] = useState(false);
  const [directionDraft, setDirectionDraft] = useState('');
  const [isRegeneratingFromDirection, setIsRegeneratingFromDirection] = useState(false);

  // debounce 타이머 ref
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 스토어에서 필요한 상태/액션 구독
  const uploadedImages = useEditorStore((s) => s.uploadedImages);
  const updateFrame = useEditorStore((s) => s.updateFrame);
  const generatingImageForFrame = useEditorStore((s) => s.generatingImageForFrame);
  const generateFrameImage = useEditorStore((s) => s.generateFrameImage);
  const isPromptOutdated = useEditorStore((s) => s.promptOutdatedFrames.has(frameType));
  const removePromptOutdated = useEditorStore((s) => s.removePromptOutdated);
  const setFrameImage = useEditorStore((s) => s.setFrameImage);

  // 생성 상태 플래그 (frameId 기준)
  const isGeneratingThisFrame = generatingImageForFrame === frameId;
  const isAnotherFrameGenerating = generatingImageForFrame !== null && !isGeneratingThisFrame;
  const hasPrompt = !!imagePrompt;
  const hasUploadedImages = uploadedImages.length > 0;

  // ─── 변경 2: 텍스트 전용 프레임 여부 ───
  const isTextOnly = TEXT_ONLY_FRAMES.includes(frameType);

  // ----------------------------------------------------------------
  // 핸들러: 프롬프트 textarea
  // ----------------------------------------------------------------
  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      updateFrame(frameType, { imagePrompt: value });
    }, 300);
  };

  const handlePromptBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    e.currentTarget.style.borderColor = '#eeeeee';
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    updateFrame(frameType, { imagePrompt: e.target.value });
  };

  const handlePromptFocus = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    e.currentTarget.style.borderColor = '#6366f1';
  };

  // ----------------------------------------------------------------
  // 핸들러: 클립보드 복사
  // ----------------------------------------------------------------
  const handleCopy = () => {
    if (!imagePrompt) return;
    navigator.clipboard
      .writeText(imagePrompt)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch((err) => {
        console.error('[AIImageSection] 클립보드 복사 오류:', err);
      });
  };

  // ----------------------------------------------------------------
  // 핸들러: 이미지 참조 세그먼트 토글
  // ----------------------------------------------------------------
  const handleNeedsProductImage = (value: boolean) => {
    updateFrame(frameType, { needsProductImage: value });
  };

  // ----------------------------------------------------------------
  // 핸들러: 프롬프트 갱신 (outdated 배너에서 호출)
  // ----------------------------------------------------------------
  const handleRegeneratePrompt = async () => {
    if (isRegenerating || !frame) return;
    setIsRegenerating(true);
    setRegenError(null);

    try {
      const res = await fetch('/api/ai/regenerate-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frameType,
          headline: frame.headline,
          subheadline: frame.subheadline ?? undefined,
          bodyText: frame.bodyText ?? undefined,
          imageDirection: frame.imageDirection ?? undefined,
        }),
      });

      const json = (await res.json()) as
        | { success: true; data: { imagePrompt: string } }
        | { success: false; error: string };

      if (!json.success) {
        throw new Error(json.error);
      }

      updateFrame(frameType, { imagePrompt: json.data.imagePrompt });
      removePromptOutdated(frameType);
    } catch (err) {
      console.error('[AIImageSection] 프롬프트 갱신 오류:', err);
      setRegenError(err instanceof Error ? err.message : '프롬프트 갱신에 실패했습니다.');
    } finally {
      setIsRegenerating(false);
    }
  };

  // ----------------------------------------------------------------
  // 핸들러: 연출 안내 수정 시작
  // ----------------------------------------------------------------
  const handleStartEditDirection = () => {
    setDirectionDraft(imageDirection ?? '');
    setIsEditingDirection(true);
  };

  // ----------------------------------------------------------------
  // 핸들러: 연출 안내 취소
  // ----------------------------------------------------------------
  const handleCancelEditDirection = () => {
    setIsEditingDirection(false);
    setDirectionDraft('');
  };

  // ----------------------------------------------------------------
  // 핸들러: 연출 안내 완료 → imageDirection 저장 + 프롬프트 재생성
  // ----------------------------------------------------------------
  const handleConfirmEditDirection = async () => {
    if (isRegeneratingFromDirection) return;

    // 1. 스토어에 수정된 imageDirection 저장
    updateFrame(frameType, { imageDirection: directionDraft });
    setIsEditingDirection(false);

    // 2. API로 프롬프트 재생성 (수정된 imageDirection 우선 반영)
    setIsRegeneratingFromDirection(true);
    setRegenError(null);

    try {
      const currentFrame = frame;
      const res = await fetch('/api/ai/regenerate-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frameType,
          headline: currentFrame?.headline ?? '',
          subheadline: currentFrame?.subheadline ?? undefined,
          bodyText: currentFrame?.bodyText ?? undefined,
          imageDirection: directionDraft,
        }),
      });

      const json = (await res.json()) as
        | { success: true; data: { imagePrompt: string } }
        | { success: false; error: string };

      if (!json.success) {
        throw new Error(json.error);
      }

      // 3. 새 프롬프트 저장 + outdated 플래그 해제
      updateFrame(frameType, { imagePrompt: json.data.imagePrompt });
      removePromptOutdated(frameType);
    } catch (err) {
      console.error('[AIImageSection] 연출 안내 기반 프롬프트 재생성 오류:', err);
      setRegenError(err instanceof Error ? err.message : '프롬프트 생성에 실패했습니다.');
    } finally {
      setIsRegeneratingFromDirection(false);
      setDirectionDraft('');
    }
  };

  // ----------------------------------------------------------------
  // 핸들러: AI 이미지 생성
  // generateFrameImage는 store 내부에서 항상 'main' 슬롯에 저장함.
  // activeSlotKey가 'main'이 아닌 경우, 생성 완료 후 해당 슬롯으로 복사.
  // ----------------------------------------------------------------
  const isGenDisabled = !hasPrompt || isGeneratingThisFrame || isAnotherFrameGenerating;

  const handleGenerate = async () => {
    if (isGenDisabled) return;
    setAiGenError(null);
    try {
      await generateFrameImage(frameId);

      // activeSlotKey가 'main'이 아니면 main → activeSlotKey로 복사
      if (activeSlotKey !== 'main') {
        const mainUrl = useEditorStore.getState().frameImages[frameId]?.['main'];
        if (mainUrl) {
          setFrameImage(frameId, activeSlotKey, mainUrl);
        }
      }

      setAiGenSuccess(true);
      setTimeout(() => setAiGenSuccess(false), 1500);
    } catch (err) {
      console.error('[AIImageSection] AI 이미지 생성 오류:', err);
      setAiGenError(err instanceof Error ? err.message : '이미지 생성에 실패했습니다.');
    }
  };

  // ----------------------------------------------------------------
  // 연출 안내 카드에 표시할 텍스트 결정
  // ----------------------------------------------------------------
  const directionText = imageDirection ?? null;
  const fallbackText = imagePrompt ? imagePrompt.slice(0, 80) : null;
  // 이미지 프레임이면 연출 안내 카드를 항상 표시 (빈 상태에서도 추가 가능)
  const showDirectionCard = !isTextOnly;

  // ----------------------------------------------------------------
  // 렌더
  // ----------------------------------------------------------------

  // ─── 변경 2: 텍스트 전용 프레임 — 비활성화 안내 표시 ───
  if (isTextOnly) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
        }}
      >
        {/* CSS 애니메이션 */}
        <style>{`
          @keyframes ai-image-spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>

        {/* 섹션 헤더 */}
        <span
          style={{
            fontSize: '13px',
            fontWeight: 600,
            color: '#926f6b',
          }}
        >
          AI 이미지
        </span>

        {/* 비활성화 안내 카드 */}
        <div
          style={{
            backgroundColor: '#f3f3f3',
            borderRadius: '8px',
            padding: '14px 12px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px',
            opacity: 0.7,
          }}
        >
          <X size={14} style={{ color: '#926f6b', flexShrink: 0, marginTop: '1px' }} />
          <p
            style={{
              margin: 0,
              fontSize: '12px',
              color: '#926f6b',
              lineHeight: 1.55,
            }}
          >
            이 프레임은 이미지 영역이 없습니다.
            <br />
            텍스트 전용 템플릿입니다.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
      }}
    >
      {/* CSS 애니메이션 (spin) */}
      <style>{`
        @keyframes ai-image-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>

      {/* 1. 섹션 헤더 */}
      <span
        style={{
          fontSize: '13px',
          fontWeight: 600,
          color: '#1a1c1c',
        }}
      >
        AI 이미지
      </span>

      {/* 2. 연출 안내 카드 (편집 가능) */}
      {showDirectionCard && (
        <div
          style={{
            backgroundColor: '#f3f3f3',
            borderRadius: '8px',
            padding: '12px',
          }}
        >
          {/* 카드 헤더: 레이블 + 수정 버튼 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '6px',
            }}
          >
            <span
              style={{
                fontSize: '11px',
                color: '#a78bfa',
                fontWeight: 600,
              }}
            >
              연출 안내
            </span>

            {/* 편집 모드가 아닐 때만 수정 버튼 표시 */}
            {!isEditingDirection && (
              <button
                onClick={handleStartEditDirection}
                title="연출 안내 수정"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                  background: 'none',
                  border: 'none',
                  padding: '2px 4px',
                  borderRadius: '4px',
                  color: '#926f6b',
                  fontSize: '11px',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = '#6366f1';
                  e.currentTarget.style.backgroundColor = '#eeeeee';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = '#926f6b';
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                <Pencil size={11} />
                수정
              </button>
            )}
          </div>

          {/* 편집 모드 */}
          {isEditingDirection ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <textarea
                value={directionDraft}
                onChange={(e) => setDirectionDraft(e.target.value)}
                disabled={isRegeneratingFromDirection}
                style={{
                  backgroundColor: '#ffffff',
                  border: '1px solid #6366f1',
                  borderRadius: '6px',
                  padding: '8px',
                  color: '#1a1c1c',
                  width: '100%',
                  fontSize: '13px',
                  lineHeight: 1.5,
                  resize: 'vertical',
                  minHeight: '80px',
                  outline: 'none',
                  boxSizing: 'border-box',
                  fontFamily: 'inherit',
                  opacity: isRegeneratingFromDirection ? 0.6 : 1,
                }}
              />

              {/* 완료 / 취소 버튼 */}
              <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                <button
                  onClick={handleCancelEditDirection}
                  disabled={isRegeneratingFromDirection}
                  style={{
                    padding: '5px 10px',
                    fontSize: '12px',
                    fontWeight: 500,
                    borderRadius: '5px',
                    border: '1px solid #eeeeee',
                    backgroundColor: 'transparent',
                    color: '#926f6b',
                    cursor: isRegeneratingFromDirection ? 'not-allowed' : 'pointer',
                    opacity: isRegeneratingFromDirection ? 0.5 : 1,
                  }}
                >
                  취소
                </button>
                <button
                  onClick={handleConfirmEditDirection}
                  disabled={isRegeneratingFromDirection}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    padding: '5px 10px',
                    fontSize: '12px',
                    fontWeight: 500,
                    borderRadius: '5px',
                    border: 'none',
                    backgroundColor: isRegeneratingFromDirection ? '#3730a3' : '#4f46e5',
                    color: '#ffffff',
                    cursor: isRegeneratingFromDirection ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isRegeneratingFromDirection ? (
                    <>
                      <Loader2
                        size={11}
                        style={{ animation: 'ai-image-spin 1s linear infinite' }}
                      />
                      프롬프트 생성 중...
                    </>
                  ) : (
                    '완료'
                  )}
                </button>
              </div>
            </div>
          ) : (
            /* 읽기 모드 */
            <p
              style={{
                margin: 0,
                fontSize: '13px',
                color: (directionText || fallbackText) ? '#1a1c1c' : '#926f6b',
                lineHeight: 1.5,
                fontStyle: directionText ? 'normal' : 'italic',
              }}
            >
              {directionText ?? fallbackText ?? '수정 버튼을 눌러 원하는 이미지를 설명해주세요'}
            </p>
          )}
        </div>
      )}

      {/* 3. 이미지 참조 세그먼트 컨트롤 */}
      <div>
        <span
          style={{
            display: 'block',
            fontSize: '12px',
            color: '#926f6b',
            marginBottom: '6px',
          }}
        >
          이미지 참조
        </span>
        <div
          style={{
            display: 'flex',
            gap: 0,
          }}
        >
          {/* 상품 포함 버튼 */}
          <button
            onClick={() => handleNeedsProductImage(true)}
            disabled={!hasUploadedImages}
            style={{
              flex: 1,
              padding: '7px 0',
              fontSize: '12px',
              fontWeight: 500,
              borderRadius: '6px 0 0 6px',
              border: '1px solid #eeeeee',
              borderRight: 'none',
              backgroundColor: needsProductImage === true ? '#4f46e5' : '#f3f3f3',
              color: needsProductImage === true ? '#ffffff' : '#926f6b',
              cursor: !hasUploadedImages ? 'not-allowed' : 'pointer',
              opacity: !hasUploadedImages ? 0.5 : 1,
              transition: 'background-color 0.15s, color 0.15s',
            }}
          >
            상품 포함
          </button>
          {/* AI 순수 생성 버튼 */}
          <button
            onClick={() => handleNeedsProductImage(false)}
            style={{
              flex: 1,
              padding: '7px 0',
              fontSize: '12px',
              fontWeight: 500,
              borderRadius: '0 6px 6px 0',
              border: '1px solid #eeeeee',
              backgroundColor: needsProductImage === false ? '#4f46e5' : '#f3f3f3',
              color: needsProductImage === false ? '#ffffff' : '#926f6b',
              cursor: 'pointer',
              transition: 'background-color 0.15s, color 0.15s',
            }}
          >
            AI 순수 생성
          </button>
        </div>

        {/* 상품 이미지 미업로드 힌트 */}
        {!hasUploadedImages && (
          <p
            style={{
              margin: '6px 0 0',
              fontSize: '11px',
              color: '#f59e0b',
            }}
          >
            상품 이미지를 먼저 업로드해주세요
          </p>
        )}
      </div>

      {/* 4-a. 프롬프트 outdated 배너 */}
      {isPromptOutdated && imagePrompt != null && (
        <div
          style={{
            backgroundColor: '#422006',
            border: '1px solid #854d0e',
            borderRadius: '8px',
            padding: '10px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          {/* 경고 아이콘 + 메시지 */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
            <AlertTriangle size={13} style={{ color: '#fbbf24', flexShrink: 0, marginTop: '1px' }} />
            <p style={{ margin: 0, fontSize: '12px', color: '#fbbf24', lineHeight: 1.5 }}>
              텍스트가 변경되었습니다.
              <br />
              프롬프트가 현재 텍스트와 다를 수 있어요.
            </p>
          </div>

          {/* 갱신 에러 메시지 */}
          {regenError && (
            <p style={{ margin: 0, fontSize: '11px', color: '#fca5a5', lineHeight: 1.4 }}>
              {regenError}
            </p>
          )}

          {/* 갱신 버튼 (오른쪽 정렬) */}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={handleRegeneratePrompt}
              disabled={isRegenerating}
              style={{
                backgroundColor: '#854d0e',
                color: '#fbbf24',
                border: 'none',
                borderRadius: '4px',
                padding: '5px 10px',
                fontSize: '12px',
                fontWeight: 500,
                cursor: isRegenerating ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                opacity: isRegenerating ? 0.7 : 1,
              }}
            >
              {isRegenerating ? (
                <>
                  <Loader2
                    size={11}
                    style={{ animation: 'ai-image-spin 1s linear infinite' }}
                  />
                  갱신 중...
                </>
              ) : (
                '프롬프트 갱신'
              )}
            </button>
          </div>
        </div>
      )}

      {/* 연출 안내 수정 후 프롬프트 재생성 에러 (outdated 배너 없을 때도 표시) */}
      {regenError && !isPromptOutdated && (
        <div
          style={{
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            borderRadius: '8px',
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '6px',
          }}
        >
          <AlertTriangle size={13} style={{ color: '#f87171', flexShrink: 0, marginTop: '1px' }} />
          <p style={{ margin: 0, fontSize: '12px', color: '#fca5a5', lineHeight: 1.5, flex: 1 }}>
            {regenError}
          </p>
          <button
            onClick={() => setRegenError(null)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#f87171',
              padding: '1px',
              flexShrink: 0,
            }}
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* 4-b. 프롬프트 접기/펼치기 */}
      <div>
        {/* 토글 헤더 */}
        <button
          onClick={() => setShowPrompt((prev) => !prev)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            background: 'none',
            border: 'none',
            padding: '0',
            cursor: 'pointer',
            color: '#926f6b',
            fontSize: '12px',
            fontWeight: 500,
          }}
        >
          {showPrompt ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          프롬프트 보기/수정
        </button>

        {/* 펼쳐진 상태 */}
        {showPrompt && (
          <div
            style={{
              marginTop: '8px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            {imagePrompt != null ? (
              <>
                <textarea
                  key={`${frameType}-${imagePrompt}`}
                  defaultValue={imagePrompt}
                  onChange={handlePromptChange}
                  onFocus={handlePromptFocus}
                  onBlur={handlePromptBlur}
                  style={{
                    backgroundColor: '#f3f3f3',
                    border: '1px solid #eeeeee',
                    borderRadius: '8px',
                    padding: '8px',
                    color: '#1a1c1c',
                    width: '100%',
                    fontSize: '12px',
                    lineHeight: 1.6,
                    resize: 'vertical',
                    minHeight: '120px',
                    outline: 'none',
                    boxSizing: 'border-box',
                    fontFamily: 'inherit',
                  }}
                />
                {/* 복사 버튼 (오른쪽 정렬) */}
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    onClick={handleCopy}
                    title="클립보드에 복사"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '4px 8px',
                      backgroundColor: 'transparent',
                      border: 'none',
                      borderRadius: '6px',
                      color: copied ? '#4ade80' : '#926f6b',
                      fontSize: '12px',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => {
                      if (!copied) e.currentTarget.style.color = '#1a1c1c';
                    }}
                    onMouseLeave={(e) => {
                      if (!copied) e.currentTarget.style.color = '#926f6b';
                    }}
                  >
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                    {copied ? '복사됨' : '복사'}
                  </button>
                </div>
              </>
            ) : (
              <p
                style={{
                  margin: 0,
                  padding: '10px 12px',
                  backgroundColor: '#f3f3f3',
                  border: '1px solid #eeeeee',
                  borderRadius: '8px',
                  fontSize: '12px',
                  color: '#926f6b',
                  lineHeight: 1.5,
                }}
              >
                카피를 먼저 생성하면 프롬프트가 자동으로 만들어집니다
              </p>
            )}
          </div>
        )}
      </div>

      {/* 5. AI 이미지 생성 에러 메시지 */}
      {aiGenError && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px',
            padding: '10px 12px',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            borderRadius: '8px',
          }}
        >
          <span
            style={{
              flex: 1,
              fontSize: '12px',
              color: '#fca5a5',
              lineHeight: 1.5,
              wordBreak: 'break-word',
            }}
          >
            {aiGenError}
          </span>
          <button
            onClick={() => setAiGenError(null)}
            style={{
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#f87171',
              padding: '1px',
            }}
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* 6. AI 이미지 생성 버튼 */}
      <button
        onClick={handleGenerate}
        disabled={isGenDisabled}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '7px',
          width: '100%',
          padding: '10px',
          borderRadius: '8px',
          border: 'none',
          backgroundColor: aiGenSuccess
            ? '#059669'
            : isGenDisabled
              ? '#eeeeee'
              : '#4f46e5',
          color: isGenDisabled && !aiGenSuccess ? '#926f6b' : '#ffffff',
          fontSize: '13px',
          fontWeight: 600,
          cursor: isGenDisabled ? 'not-allowed' : 'pointer',
          transition: 'background-color 0.2s',
        }}
      >
        {isGeneratingThisFrame ? (
          <>
            <Loader2
              size={14}
              style={{ animation: 'ai-image-spin 1s linear infinite' }}
            />
            생성 중...
          </>
        ) : (
          <>
            <Wand2 size={14} />
            AI 이미지 생성
          </>
        )}
      </button>

      {/* 다른 프레임 생성 중 안내 */}
      {isAnotherFrameGenerating && (
        <p
          style={{
            margin: 0,
            fontSize: '11px',
            color: '#926f6b',
            textAlign: 'center',
          }}
        >
          다른 프레임 이미지 생성 중... 잠시 기다려주세요.
        </p>
      )}

      {/* imagePrompt 없을 때: 텍스트/연출 안내 기반으로 프롬프트 생성 버튼 표시 */}
      {!hasPrompt && !isGeneratingThisFrame && (
        <button
          onClick={handleRegeneratePrompt}
          disabled={isRegenerating || !frame}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            width: '100%',
            padding: '9px',
            borderRadius: '8px',
            border: '1px solid #eeeeee',
            backgroundColor: '#f3f3f3',
            color: isRegenerating ? '#926f6b' : '#6366f1',
            fontSize: '12px',
            fontWeight: 500,
            cursor: (isRegenerating || !frame) ? 'not-allowed' : 'pointer',
          }}
        >
          {isRegenerating ? (
            <>
              <Loader2 size={13} style={{ animation: 'ai-image-spin 1s linear infinite' }} />
              프롬프트 생성 중...
            </>
          ) : (
            <>
              <Wand2 size={13} />
              AI 이미지 프롬프트 생성
            </>
          )}
        </button>
      )}
    </div>
  );
};

export default AIImageSection;
