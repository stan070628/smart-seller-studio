/**
 * ReturnNoticeTemplate.tsx - 반품/교환 주의사항 + 고객센터 운영시간 통합 780×1100
 * 상단: 미니멀 Return 체크리스트
 * 하단: CS Hours 운영시간 안내
 */
import React from 'react';
import type { TemplateProps } from './HeroTemplate';
import EditableText from './EditableText';
import { BG_GRAY, TEXT_DARK, TEXT_MUTED, ThreeDots, CheckIcon } from './MinimalNoticeBase';

const ReturnNoticeTemplate: React.FC<TemplateProps> = ({
  frame, isEditable = false, onFieldChange,
}) => {
  if (frame.skip) return null;

  const onFC = onFieldChange as ((f: string, v: string) => void) | undefined;

  // ─── 상단: Return 체크리스트 ───
  const handle = (frame.metadata?.handle as string) ?? '@reallygreatsite';
  const item1 = (frame.metadata?.item1 as string) ??
    '반품 및 교환 전 판매자에게 꼭! 문자 문의 부탁드립니다.';
  const item2 = (frame.metadata?.item2 as string) ??
    '판매자 주소로 임의 반송 시 착불로 재발송됩니다.';
  const item3 = (frame.metadata?.item3 as string) ??
    '출고지와 반품지가 달라 자동수거와 묶음 배송이 불가합니다.';
  const checkItems = [
    { value: item1, field: 'metadata.item1' },
    { value: item2, field: 'metadata.item2' },
    { value: item3, field: 'metadata.item3' },
  ];

  // ─── 하단: CS Hours ───
  const csTitle = (frame.metadata?.csTitle as string) ?? 'CS Hours';
  const hours = (frame.metadata?.hours as string) ?? '10:00 ~ 16:00';
  const closed = (frame.metadata?.closed as string) ?? '주말, 공휴일 휴무';
  const description = (frame.metadata?.description as string) ??
    '유선상담이 원활하지 않을 수 있습니다.\n문의사항을 사이트 내 문의기능 또는 문자를 이용하여\n남겨주시면 빠르게 확인 후 처리 도와드리겠습니다.';
  const email = (frame.metadata?.email as string) ?? 'example@gmail.com';

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

      {/* ══════════════ 상단: Return (570px) ══════════════ */}
      <div style={{
        height: '570px',
        flexShrink: 0,
        padding: '52px 60px 40px',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* 타이틀 */}
        <div style={{ marginTop: '80px' }}>
          <EditableText
            value={frame.headline || 'Return'}
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

      {/* ══════════════ 하단: CS Hours (나머지) ══════════════ */}
      <div style={{
        flex: 1,
        padding: '40px 60px 52px',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* CS 소제목 */}
        <EditableText
          value={csTitle}
          field="metadata.csTitle"
          isEditable={isEditable}
          onFieldChange={onFC}
          tag="h2"
          style={{
            fontSize: '32px',
            fontWeight: '900',
            color: TEXT_DARK,
            margin: 0,
            letterSpacing: '-0.8px',
            display: 'block',
          }}
        />

        {/* 구분선 */}
        <div style={{ height: '2px', backgroundColor: TEXT_DARK, margin: '20px 0 24px 0' }} />

        {/* 운영시간 */}
        <EditableText
          value={hours}
          field="metadata.hours"
          isEditable={isEditable}
          onFieldChange={onFC}
          tag="p"
          style={{
            fontSize: '44px',
            fontWeight: '900',
            color: TEXT_DARK,
            margin: 0,
            letterSpacing: '-1px',
            display: 'block',
          }}
        />

        {/* 휴무 */}
        <EditableText
          value={closed}
          field="metadata.closed"
          isEditable={isEditable}
          onFieldChange={onFC}
          tag="p"
          style={{
            fontSize: '18px',
            fontWeight: '600',
            color: '#555',
            margin: '6px 0 0 0',
            display: 'block',
          }}
        />

        {/* 스페이서 */}
        <div style={{ flex: 1 }} />

        {/* 안내 문구 */}
        <EditableText
          value={description}
          field="metadata.description"
          isEditable={isEditable}
          onFieldChange={onFC}
          tag="p"
          style={{
            fontSize: '16px',
            fontWeight: '500',
            color: TEXT_DARK,
            margin: '0 0 14px 0',
            lineHeight: '1.75',
            display: 'block',
            whiteSpace: 'pre-line',
          }}
        />

        {/* 이메일 */}
        <EditableText
          value={email}
          field="metadata.email"
          isEditable={isEditable}
          onFieldChange={onFC}
          tag="p"
          style={{
            fontSize: '16px',
            fontWeight: '700',
            color: '#444',
            margin: 0,
            display: 'block',
          }}
        />
      </div>
    </div>
  );
};

export default ReturnNoticeTemplate;
