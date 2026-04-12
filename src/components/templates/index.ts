/**
 * templates/index.ts
 * frameType → 템플릿 컴포넌트 매핑 테이블
 */

import type { ComponentType } from 'react';
import type { FrameType } from '@/types/frames';
import type { TemplateProps } from './HeroTemplate';

import HeroTemplate from './HeroTemplate';
import PainPointTemplate from './PainPointTemplate';
import SolutionTemplate from './SolutionTemplate';
import UspTemplate from './UspTemplate';
import Detail1Template from './Detail1Template';
import Detail2Template from './Detail2Template';
import HowToUseTemplate from './HowToUseTemplate';
import BeforeAfterTemplate from './BeforeAfterTemplate';
import TargetTemplate from './TargetTemplate';
import SpecTemplate from './SpecTemplate';
import FaqTemplate from './FaqTemplate';
import SocialProofTemplate from './SocialProofTemplate';
import CtaTemplate from './CtaTemplate';
import Custom3ColTemplate from './Custom3ColTemplate';
import CustomGalleryTemplate from './CustomGalleryTemplate';
import NoticeTemplate from './NoticeTemplate';
import ReturnNoticeTemplate from './ReturnNoticeTemplate';
import PrivacyTemplate from './PrivacyTemplate';
import ThumbnailTemplate from './ThumbnailTemplate';

// 한국어 프레임 이름 매핑
export const FRAME_LABEL_KO: Record<FrameType, string> = {
  hero: '히어로',
  pain_point: '불편함 공감',
  solution: '해결책 제시',
  usp: '핵심 차별점',
  detail_1: '기능/소재',
  detail_2: '디자인/감성',
  how_to_use: '사용 방법',
  before_after: '비포&애프터',
  target: '타겟 고객',
  spec: '스펙/사이즈',
  faq: '자주 묻는 질문',
  social_proof: '신뢰도',
  cta: '구매 유도',
  custom_3col: '3컬럼 비교',
  custom_gallery: '이미지 갤러리',
  custom_notice: '공지/안내 + 배송흐름도',
  custom_return_notice: '반품/교환 + CS운영시간',
  custom_privacy: '개인정보 동의',
  thumbnail: '썸네일',
};

// frameType → 컴포넌트 매핑
export const TEMPLATE_MAP: Record<FrameType, ComponentType<TemplateProps>> = {
  hero: HeroTemplate,
  pain_point: PainPointTemplate,
  solution: SolutionTemplate,
  usp: UspTemplate,
  detail_1: Detail1Template,
  detail_2: Detail2Template,
  how_to_use: HowToUseTemplate,
  before_after: BeforeAfterTemplate,
  target: TargetTemplate,
  spec: SpecTemplate,
  faq: FaqTemplate,
  social_proof: SocialProofTemplate,
  cta: CtaTemplate,
  custom_3col: Custom3ColTemplate,
  custom_gallery: CustomGalleryTemplate,
  custom_notice: NoticeTemplate,
  custom_return_notice: ReturnNoticeTemplate,
  custom_privacy: PrivacyTemplate,
  thumbnail: ThumbnailTemplate,
};

// 개별 컴포넌트 re-export
export {
  HeroTemplate,
  PainPointTemplate,
  SolutionTemplate,
  UspTemplate,
  Detail1Template,
  Detail2Template,
  HowToUseTemplate,
  BeforeAfterTemplate,
  TargetTemplate,
  SpecTemplate,
  FaqTemplate,
  SocialProofTemplate,
  CtaTemplate,
  Custom3ColTemplate,
  CustomGalleryTemplate,
  NoticeTemplate,
  ReturnNoticeTemplate,
  PrivacyTemplate,
  ThumbnailTemplate,
};

export type { TemplateProps };
