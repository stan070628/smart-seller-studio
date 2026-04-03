/**
 * PrivacyTemplate.tsx - 미니멀 그레이 개인정보제공 동의 780×1100
 */
import React from 'react';
import type { TemplateProps } from './HeroTemplate';
import { DEFAULT_THEME } from '@/lib/themes';
import EditableText from './EditableText';
import { BG_GRAY, TEXT_DARK, TEXT_MUTED, ThreeDots, CheckIcon } from './MinimalNoticeBase';

const PrivacyTemplate: React.FC<TemplateProps> = ({
  frame, isEditable = false, onFieldChange,
}) => {
  if (frame.skip) return null;

  const onFC = onFieldChange as ((f: string, v: string) => void) | undefined;

  const handle = (frame.metadata?.handle as string) ?? '@reallygreatsite';
  const intro = (frame.metadata?.intro as string) ??
    '본 상품 및 서비스는 원활한 의사소통 및 배송, 상담 등 거래 이행을 위하여 고객의 개인정보를 제공합니다.';

  const privacyItems = [
    {
      value: (frame.metadata?.privacyItem1 as string) ?? '개인정보를 제공받는 자 :\n상품 및 서비스 제공 위탁업체, 중개업체, 택배사',
      field: 'metadata.privacyItem1',
    },
    {
      value: (frame.metadata?.privacyItem2 as string) ?? '제공하는 개인정보 :\n이름, 전화번호, 구매정보, 배송주소, 배송메세지',
      field: 'metadata.privacyItem2',
    },
    {
      value: (frame.metadata?.privacyItem3 as string) ?? '개인정보를 제공받는 자의 이용목적 :\n거래 진행, 고객 상담, 불만처리, 상품 배송·교환·반품',
      field: 'metadata.privacyItem3',
    },
    {
      value: (frame.metadata?.privacyItem4 as string) ?? '개인정보 보유 및 이용기간 :\n이용목적 달성 시까지 보존 후 삭제합니다.',
      field: 'metadata.privacyItem4',
    },
  ];

  return (
    <div style={{
      width: '780px', height: '1100px',
      backgroundColor: BG_GRAY,
      fontFamily: '"Pretendard", "Apple SD Gothic Neo", sans-serif',
      overflow: 'hidden',
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      padding: '52px 60px',
    }}>
      <ThreeDots />

      {/* 타이틀 */}
      <div style={{ marginTop: '100px' }}>
        <EditableText
          value={frame.headline || 'Privacy'}
          field="headline"
          isEditable={isEditable}
          onFieldChange={onFC}
          tag="h1"
          style={{
            fontSize: '100px',
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
            fontSize: '17px',
            color: TEXT_MUTED,
            margin: '14px 0 0 0',
            fontWeight: '400',
            display: 'block',
          }}
        />
      </div>

      {/* 인트로 텍스트 */}
      <EditableText
        value={intro}
        field="metadata.intro"
        isEditable={isEditable}
        onFieldChange={onFC}
        tag="p"
        style={{
          fontSize: '15px',
          color: '#555',
          margin: '36px 0 0 0',
          lineHeight: '1.65',
          display: 'block',
        }}
      />

      {/* 스페이서 */}
      <div style={{ flex: 1 }} />

      {/* 항목 리스트 */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: '18px',
        marginBottom: '60px',
      }}>
        {privacyItems.map((item, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
            <CheckIcon size={36} />
            <EditableText
              value={item.value}
              field={item.field}
              isEditable={isEditable}
              onFieldChange={onFC}
              tag="p"
              style={{
                fontSize: '16px',
                fontWeight: '600',
                color: TEXT_DARK,
                margin: 0,
                lineHeight: '1.65',
                display: 'block',
                whiteSpace: 'pre-line',
                letterSpacing: '-0.2px',
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default PrivacyTemplate;
