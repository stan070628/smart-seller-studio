/**
 * NoticeTemplate.tsx - 공지/안내 + 배송흐름도 통합 템플릿 780×1100
 * 상단: 미니멀 Notice 체크리스트
 * 하단: 5단계 배송 흐름도
 */
import React from 'react';
import type { TemplateProps } from './HeroTemplate';
import EditableText from './EditableText';
import { BG_GRAY, TEXT_DARK, TEXT_MUTED, ThreeDots, CheckIcon } from './MinimalNoticeBase';

const NoticeTemplate: React.FC<TemplateProps> = ({
  frame, isEditable = false, onFieldChange,
}) => {
  if (frame.skip) return null;

  const onFC = onFieldChange as ((f: string, v: string) => void) | undefined;

  // ─── 상단: Notice 체크리스트 ───
  const handle = (frame.metadata?.handle as string) ?? '@reallygreatsite';
  const item1 = (frame.metadata?.item1 as string) ?? '평일 기준 주문 후 1~3일 이내 출고됩니다.';
  const item2 = (frame.metadata?.item2 as string) ?? '교환/반품은 수령 후 7일 이내 신청 가능합니다.';
  const item3 = (frame.metadata?.item3 as string) ?? '취소 및 변경은 상품 준비 전에만 가능합니다.';
  const checkItems = [
    { value: item1, field: 'metadata.item1' },
    { value: item2, field: 'metadata.item2' },
    { value: item3, field: 'metadata.item3' },
  ];

  // ─── 하단: Shipping 흐름도 ───
  const shippingTitle = (frame.metadata?.shippingTitle as string) ?? 'Shipping';
  const defaultStepLabels = ['주문접수', '상품구매', '포장', '상품 출고', '배송완료'];
  const stepLabels = Array.isArray(frame.metadata?.stepLabels)
    ? (frame.metadata.stepLabels as string[])
    : defaultStepLabels;

  return (
    <div style={{
      width: '780px', height: '1100px',
      backgroundColor: BG_GRAY,
      fontFamily: '"Pretendard", "Apple SD Gothic Neo", sans-serif',
      overflow: 'hidden',
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <ThreeDots />

      {/* ══════════════ 상단: Notice (580px) ══════════════ */}
      <div style={{
        height: '580px',
        flexShrink: 0,
        padding: '52px 60px 40px',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* 타이틀 */}
        <div style={{ marginTop: '80px' }}>
          <EditableText
            value={frame.headline || 'Notice'}
            field="headline"
            isEditable={isEditable}
            onFieldChange={onFC}
            tag="h1"
            style={{
              fontSize: '84px',
              fontWeight: '900',
              color: TEXT_DARK,
              margin: 0,
              lineHeight: '1.0',
              letterSpacing: '-2px',
              display: 'block',
            }}
          />
          <EditableText
            value={handle}
            field="metadata.handle"
            isEditable={isEditable}
            onFieldChange={onFC}
            tag="p"
            style={{
              fontSize: '16px',
              color: TEXT_MUTED,
              margin: '12px 0 0 0',
              fontWeight: '400',
              display: 'block',
            }}
          />
        </div>

        {/* 스페이서 */}
        <div style={{ flex: 1 }} />

        {/* 체크리스트 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {checkItems.map((item, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
              <CheckIcon size={38} />
              <EditableText
                value={item.value}
                field={item.field}
                isEditable={isEditable}
                onFieldChange={onFC}
                tag="p"
                style={{
                  fontSize: '22px',
                  fontWeight: '700',
                  color: TEXT_DARK,
                  margin: 0,
                  lineHeight: '1.45',
                  display: 'block',
                  letterSpacing: '-0.3px',
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* 구분선 */}
      <div style={{
        height: '1.5px',
        backgroundColor: '#b8b8b8',
        margin: '0 60px',
        flexShrink: 0,
      }} />

      {/* ══════════════ 하단: Shipping Flow (나머지) ══════════════ */}
      <div style={{
        flex: 1,
        padding: '44px 60px 56px',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* Shipping 소제목 */}
        <EditableText
          value={shippingTitle}
          field="metadata.shippingTitle"
          isEditable={isEditable}
          onFieldChange={onFC}
          tag="h2"
          style={{
            fontSize: '32px',
            fontWeight: '900',
            color: TEXT_DARK,
            margin: '0 0 0 0',
            letterSpacing: '-0.8px',
            display: 'block',
          }}
        />

        {/* 스페이서 */}
        <div style={{ flex: 1 }} />

        {/* 5단계 흐름도 */}
        <div style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
        }}>
          {stepLabels.map((label, i) => (
            <React.Fragment key={i}>
              {/* 단계 */}
              <div style={{
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', gap: '14px',
                flex: 1,
              }}>
                {/* 번호 원 */}
                <div style={{
                  width: '72px', height: '72px',
                  borderRadius: '50%',
                  backgroundColor: TEXT_DARK,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <span style={{ color: '#fff', fontSize: '24px', fontWeight: '900' }}>
                    {i + 1}
                  </span>
                </div>

                {/* 라벨 */}
                <EditableText
                  value={label}
                  field={`metadata.stepLabels.${i}`}
                  isEditable={isEditable}
                  onFieldChange={onFC}
                  tag="p"
                  style={{
                    color: TEXT_DARK, fontSize: '14px',
                    fontWeight: '700', margin: 0,
                    textAlign: 'center', display: 'block',
                    letterSpacing: '-0.2px',
                  }}
                />
              </div>

              {/* 화살표 */}
              {i < stepLabels.length - 1 && (
                <div style={{
                  marginTop: '24px', flexShrink: 0,
                  fontSize: '20px', color: '#888',
                  padding: '0 2px',
                }}>
                  →
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
};

export default NoticeTemplate;
