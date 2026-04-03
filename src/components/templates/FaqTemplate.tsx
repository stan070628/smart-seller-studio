/**
 * FaqTemplate.tsx - 780×1100 세로형
 */
import React from 'react';
import type { TemplateProps } from './HeroTemplate';
import { DEFAULT_THEME } from '@/lib/themes';
import EditableText from './EditableText';

interface QnA { q?: string; a?: string; question?: string; answer?: string; }

const FaqTemplate: React.FC<TemplateProps> = ({
  frame, isEditable = false, onFieldChange, theme = DEFAULT_THEME,
}) => {
  if (frame.skip) return null;

  const rawQuestions = Array.isArray(frame.metadata?.questions)
    ? (frame.metadata.questions as (string | QnA)[]).slice(0, 3)
    : [];

  const qnaList = rawQuestions.length > 0
    ? rawQuestions.map((q) => {
        if (typeof q === 'string') return { question: q, answer: '상세 페이지에서 확인해 주세요.' };
        return { question: q.q ?? q.question ?? '', answer: q.a ?? q.answer ?? '' };
      })
    : [
        { question: '반품/교환은 어떻게 하나요?', answer: '구매 후 7일 이내 무료 반품/교환이 가능합니다.' },
        { question: 'A/S는 얼마나 지원되나요?', answer: '구매일로부터 1년 무상 A/S를 제공합니다.' },
        { question: '배송은 얼마나 걸리나요?', answer: '주문 후 1~2일 내 출고, 2~3일 내 수령 가능합니다.' },
      ];

  return (
    <div style={{
      width: '780px', height: '1100px',
      backgroundColor: theme.bgPage,
      fontFamily: theme.fontFamily,
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
      padding: '60px 52px',
    }}>
      {/* 헤더 */}
      <div style={{ flexShrink: 0, marginBottom: '40px' }}>
        <div style={{ width: '48px', height: '4px', backgroundColor: theme.accent, borderRadius: '2px', marginBottom: '24px' }} />
        <EditableText value={frame.headline || '자주 묻는 질문'} field="headline"
          isEditable={isEditable} onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
          tag="h1"
          style={{ color: theme.headingDark, fontSize: '36px', fontWeight: '800', lineHeight: '1.3', margin: '0 0 12px 0', letterSpacing: '-0.5px', display: 'block' }}
        />
        {frame.subheadline && (
          <EditableText value={frame.subheadline} field="subheadline"
            isEditable={isEditable} onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
            tag="p"
            style={{ color: theme.mutedDark, fontSize: '17px', margin: 0, display: 'block' }}
          />
        )}
      </div>

      {/* Q&A 목록 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {qnaList.map((item, i) => (
          <div key={i} style={{
            flex: 1,
            backgroundColor: theme.bgCard, borderRadius: '20px', overflow: 'hidden',
            boxShadow: `0 2px 12px rgba(0,0,0,0.05)`, border: `1px solid ${theme.border}`,
            display: 'flex', flexDirection: 'column',
          }}>
            {/* 질문 */}
            <div style={{ flex: 1, padding: '24px 28px', display: 'flex', alignItems: 'center', gap: '16px', borderBottom: `1px solid ${theme.border}` }}>
              <div style={{
                width: '32px', height: '32px', backgroundColor: theme.accent, flexShrink: 0,
                borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#ffffff', fontWeight: '700', fontSize: '15px',
              }}>Q</div>
              <EditableText value={item.question} field={`metadata.questions.${i}.question`}
                isEditable={isEditable} onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
                tag="p"
                style={{ color: theme.headingDark, fontSize: '18px', fontWeight: '700', margin: 0, lineHeight: '1.5', display: 'block' }}
              />
            </div>
            {/* 답변 */}
            <div style={{ flex: 1, padding: '20px 28px', display: 'flex', alignItems: 'center', gap: '16px', backgroundColor: theme.bgSubtle }}>
              <div style={{
                width: '32px', height: '32px', backgroundColor: theme.border, flexShrink: 0,
                borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: theme.mutedDark, fontWeight: '700', fontSize: '15px',
              }}>A</div>
              <EditableText value={item.answer} field={`metadata.questions.${i}.answer`}
                isEditable={isEditable} onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
                tag="p"
                style={{ color: theme.bodyDark, fontSize: '16px', margin: 0, lineHeight: '1.7', display: 'block' }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
export default FaqTemplate;
