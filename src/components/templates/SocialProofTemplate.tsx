/**
 * SocialProofTemplate.tsx - 780×1100 세로형
 */
import React from 'react';
import type { TemplateProps } from './HeroTemplate';
import { DEFAULT_THEME } from '@/lib/themes';
import EditableText from './EditableText';

interface ReviewItem { text: string; author?: string; rating?: number; }

const StarRating: React.FC<{ rating: number; accentColor: string }> = ({ rating, accentColor }) => {
  const stars = Math.min(5, Math.max(0, Math.round(rating)));
  return (
    <div style={{ display: 'flex', gap: '4px' }}>
      {[1,2,3,4,5].map((i) => (
        <span key={i} style={{ color: i <= stars ? accentColor : '#374151', fontSize: '18px' }}>★</span>
      ))}
    </div>
  );
};

const SocialProofTemplate: React.FC<TemplateProps> = ({
  frame, isEditable = false, onFieldChange, theme = DEFAULT_THEME,
}) => {
  if (frame.skip) return null;

  const rawReviews = Array.isArray(frame.metadata?.reviews)
    ? (frame.metadata.reviews as (string | ReviewItem)[]).slice(0, 3)
    : [];

  const reviews: ReviewItem[] = rawReviews.length > 0
    ? rawReviews.map((r) => {
        if (typeof r === 'string') return { text: r, author: '구매자', rating: 5 };
        return { text: r.text ?? '', author: r.author ?? '구매자', rating: r.rating ?? 5 };
      })
    : [
        { text: '정말 만족스럽습니다. 품질이 기대 이상이에요. 강력 추천합니다!', author: '김*지', rating: 5 },
        { text: '가격 대비 최고입니다. 배송도 빠르고 포장도 꼼꼼해요.', author: '이*은', rating: 5 },
        { text: '재구매 의사 100%입니다. 주변에도 많이 추천하고 있어요.', author: '박*수', rating: 5 },
      ];

  const starColor = theme.key === 'beauty' ? '#E07060' : '#FBBF24';

  return (
    <div style={{
      width: '780px', height: '1100px',
      backgroundColor: theme.bgDark,
      fontFamily: theme.fontFamily,
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
      padding: '60px 52px',
    }}>
      {/* 헤더 */}
      <div style={{ flexShrink: 0, marginBottom: '36px' }}>
        <div style={{ width: '48px', height: '4px', backgroundColor: starColor, borderRadius: '2px', marginBottom: '24px' }} />
        <EditableText value={frame.headline || '실제 구매자들의 생생한 후기'} field="headline"
          isEditable={isEditable} onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
          tag="h1"
          style={{ color: theme.headingLight, fontSize: '34px', fontWeight: '800', lineHeight: '1.3', margin: '0 0 12px 0', letterSpacing: '-0.5px', display: 'block' }}
        />
        {frame.subheadline && (
          <EditableText value={frame.subheadline} field="subheadline"
            isEditable={isEditable} onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
            tag="p"
            style={{ color: theme.mutedLight, fontSize: '17px', margin: 0, display: 'block' }}
          />
        )}
      </div>

      {/* 리뷰 카드 목록 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {reviews.map((review, i) => (
          <div key={i} style={{
            flex: 1,
            backgroundColor: theme.uspDarkerBg,
            borderRadius: '20px', padding: '28px 32px',
            border: `1px solid ${theme.uspRowEven}`,
            display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '16px',
          }}>
            <StarRating rating={review.rating ?? 5} accentColor={starColor} />
            <EditableText value={`"${review.text}"`} field={`metadata.reviews.${i}.text`}
              isEditable={isEditable} onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
              tag="p"
              style={{ color: theme.headingLight, fontSize: '17px', lineHeight: '1.75', margin: 0, fontStyle: 'italic' as const, display: 'block', flex: 1 }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{
                width: '36px', height: '36px', backgroundColor: theme.accent,
                borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#ffffff', fontSize: '14px', fontWeight: '700', flexShrink: 0,
              }}>
                {review.author?.charAt(0) ?? 'U'}
              </div>
              <div>
                <EditableText value={review.author ?? '구매자'} field={`metadata.reviews.${i}.author`}
                  isEditable={isEditable} onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
                  tag="p"
                  style={{ color: theme.mutedLight, fontSize: '14px', fontWeight: '600', margin: 0, display: 'block' }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
export default SocialProofTemplate;
