import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DetailPlanReview from '@/components/listing/detail-maker/DetailPlanReview';
import type { DetailSection, SceneStoryboardItem } from '@/types/detail-page';

const heroSection: DetailSection = {
  id: 'sec-hero',
  type: 'hero',
  content: { type: 'hero', headline: '최고의 필통', subheadline: '180도 오픈' },
  attachedImages: [],
};

const spSection: DetailSection = {
  id: 'sec-sp',
  type: 'selling_points',
  content: { type: 'selling_points', points: [{ icon: '✓', title: '가벼움', description: '150g' }] },
  attachedImages: [],
};

const scene: SceneStoryboardItem = {
  id: 'scene-1',
  title: '히어로 씬',
  description: '상품 전면',
  prompt: 'white desk, product centered',
  sourceImageIndex: 0,
  mode: 'ai',
  sectionId: 'sec-hero',
};

const baseProps = {
  sections: [heroSection, spSection],
  storyboard: [scene],
  uploadedUrls: ['https://example.com/img1.jpg'],
  isHtmlReady: true,
  isGeneratingScenes: false,
  onSectionsChange: vi.fn(),
  onScenesChange: vi.fn(),
  onGenerate: vi.fn(),
};

describe('DetailPlanReview', () => {
  beforeEach(() => vi.clearAllMocks());

  it('위저드 헤더에 두 스텝이 표시된다', () => {
    render(<DetailPlanReview {...baseProps} />);
    expect(screen.getByText('기획 확인')).toBeInTheDocument();
    expect(screen.getByText('이미지 생성')).toBeInTheDocument();
  });

  it('hero 섹션 헤드라인이 카드에 표시된다', () => {
    render(<DetailPlanReview {...baseProps} />);
    expect(screen.getByDisplayValue('최고의 필통')).toBeInTheDocument();
  });

  it('hero 섹션 이미지 프롬프트가 표시된다', () => {
    render(<DetailPlanReview {...baseProps} />);
    expect(screen.getByDisplayValue('white desk, product centered')).toBeInTheDocument();
  });

  it('selling_points 섹션은 텍스트 카드로 렌더된다', () => {
    render(<DetailPlanReview {...baseProps} />);
    expect(screen.getByText('가벼움')).toBeInTheDocument();
  });

  it('isHtmlReady=false면 로딩 인디케이터가 표시된다', () => {
    render(<DetailPlanReview {...baseProps} isHtmlReady={false} sections={[]} />);
    expect(screen.getByText(/텍스트 구조 생성 중/)).toBeInTheDocument();
  });

  it('"이미지 생성" 버튼 클릭 시 onGenerate가 호출된다', () => {
    render(<DetailPlanReview {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Gemini로 이미지 생성/ }));
    expect(baseProps.onGenerate).toHaveBeenCalledTimes(1);
  });

  it('storyboard가 빈 배열이면 이미지 기획 실패 안내가 표시된다', () => {
    render(<DetailPlanReview {...baseProps} storyboard={[]} />);
    expect(screen.getByText(/이미지 기획 생성 실패/)).toBeInTheDocument();
  });

  it('isGeneratingScenes=true면 생성 버튼이 비활성화된다', () => {
    render(<DetailPlanReview {...baseProps} isGeneratingScenes={true} />);
    expect(screen.getByRole('button', { name: /Gemini로 이미지 생성/ })).toBeDisabled();
  });
});
