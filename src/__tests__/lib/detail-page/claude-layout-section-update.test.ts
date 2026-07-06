import { describe, it, expect } from 'vitest';
import type { DetailSection, ClaudeLayoutContent, AttachedImage } from '@/types/detail-page';

/**
 * DetailPageEditor.handleSectionUpdate 동작을 순수 함수로 추출하여 테스트합니다.
 * 실제 React 렌더링 없이 로직만 검증합니다.
 */
function applySectionUpdate(
  sections: DetailSection[],
  id: string,
  updates: Partial<ClaudeLayoutContent> & { attachedImages?: AttachedImage[] },
): DetailSection[] {
  const { attachedImages, ...contentUpdates } = updates;
  return sections.map((s) => {
    if (s.id !== id) return s;
    return {
      ...s,
      content: { ...s.content, ...contentUpdates } as ClaudeLayoutContent,
      attachedImages: attachedImages ?? s.attachedImages,
    };
  });
}

function makeClaudeSection(overrides: Partial<ClaudeLayoutContent> = {}): DetailSection {
  return {
    id: 'section-1',
    type: 'claude_layout',
    content: {
      type: 'claude_layout',
      title: '원본 제목',
      blocks: [],
      bgStyle: 'white',
      points: ['포인트 1', '포인트 2'],
      ...overrides,
    } as ClaudeLayoutContent,
    attachedImages: [{ url: 'https://example.com/img.jpg', order: 0, processingMode: 'original' }],
  };
}

describe('applySectionUpdate — claude_layout 섹션 업데이트', () => {
  it('title만 업데이트하면 다른 content 필드는 유지된다', () => {
    const sections = [makeClaudeSection()];
    const result = applySectionUpdate(sections, 'section-1', { title: '새 제목' });

    const updated = result[0]!.content as ClaudeLayoutContent;
    expect(updated.title).toBe('새 제목');
    expect(updated.bgStyle).toBe('white');
    expect(updated.points).toEqual(['포인트 1', '포인트 2']);
  });

  it('bgStyle 업데이트 시 title과 blocks는 유지된다', () => {
    const sections = [makeClaudeSection({ title: '유지할 제목', blocks: [{ type: 'divider' }] })];
    const result = applySectionUpdate(sections, 'section-1', { bgStyle: 'dark' });

    const updated = result[0]!.content as ClaudeLayoutContent;
    expect(updated.bgStyle).toBe('dark');
    expect(updated.title).toBe('유지할 제목');
    expect(updated.blocks).toHaveLength(1);
  });

  it('attachedImages 업데이트 시 이미지 배열이 교체된다', () => {
    const sections = [makeClaudeSection()];
    const newImages: AttachedImage[] = [
      { url: 'https://example.com/new1.jpg', order: 0, processingMode: 'bg_removed' },
      { url: 'https://example.com/new2.jpg', order: 1, processingMode: 'bg_removed' },
    ];
    const result = applySectionUpdate(sections, 'section-1', { attachedImages: newImages });

    expect(result[0]!.attachedImages).toHaveLength(2);
    expect(result[0]!.attachedImages[0]!.url).toBe('https://example.com/new1.jpg');
  });

  it('attachedImages 없이 업데이트하면 기존 이미지가 유지된다', () => {
    const sections = [makeClaudeSection()];
    const result = applySectionUpdate(sections, 'section-1', { title: '새 제목' });

    expect(result[0]!.attachedImages).toHaveLength(1);
    expect(result[0]!.attachedImages[0]!.url).toBe('https://example.com/img.jpg');
  });

  it('다른 섹션 id는 영향을 받지 않는다', () => {
    const sections = [makeClaudeSection(), { ...makeClaudeSection(), id: 'section-2' }];
    const result = applySectionUpdate(sections, 'section-1', { title: '변경됨' });

    expect((result[0]!.content as ClaudeLayoutContent).title).toBe('변경됨');
    expect((result[1]!.content as ClaudeLayoutContent).title).toBe('원본 제목');
  });

  it('points 배열 업데이트', () => {
    const sections = [makeClaudeSection()];
    const result = applySectionUpdate(sections, 'section-1', { points: ['새 포인트 1', '새 포인트 2', '새 포인트 3'] });

    const updated = result[0]!.content as ClaudeLayoutContent;
    expect(updated.points).toEqual(['새 포인트 1', '새 포인트 2', '새 포인트 3']);
  });
});
