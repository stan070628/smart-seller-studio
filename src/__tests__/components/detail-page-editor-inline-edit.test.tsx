/**
 * detail-page-editor-inline-edit.test.tsx
 * DetailPageEditor — 미리보기 인라인 편집 postMessage 처리 검증
 *
 * - 'input' 타입: 미리보기 재렌더링(onSectionsChange) 없이 내부 ref만 갱신 (스크롤 리셋 방지)
 * - 'commit' 타입(blur): onSectionsChange 1회 호출 + 누적 입력값 반영
 * - 'scroll'/'ready' 타입: 스크롤 위치 저장 → 새 문서 로드 시 복원
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import DetailPageEditor from '@/components/listing/detail-editor/DetailPageEditor';
import type { DetailSection, DetailPageTheme } from '@/types/detail-page';

const THEME: DetailPageTheme = {
  palette: 'warm_cream',
  primaryColor: '#F5F0E8',
  accentColor: '#7A5C10',
  fontStyle: 'sans',
  imageLayout: 'fullbleed',
  layoutMode: 'mobile',
};

const HERO_SECTION: DetailSection = {
  id: 'sec-hero',
  type: 'hero',
  order: 0,
  content: { type: 'hero', headline: '원래 제목', subheadline: '부제' },
  attachedImages: [],
};

const onSectionsChange = vi.fn();
const onThemeChange = vi.fn();
const onSectionAiEdit = vi.fn();

function renderEditor() {
  return render(
    <DetailPageEditor
      sections={[HERO_SECTION]}
      theme={THEME}
      onSectionsChange={onSectionsChange}
      onThemeChange={onThemeChange}
      onSectionAiEdit={onSectionAiEdit}
      generatedHtml="<div>preview</div>"
    />,
  );
}

function postPreviewMessage(data: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { source: 'detail-preview-inline-editor', ...data },
        origin: window.location.origin,
      }),
    );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DetailPageEditor — 인라인 편집 메시지 처리', () => {
  it("'input' 타입은 onSectionsChange를 호출하지 않는다 (매 입력마다 재렌더링 방지)", () => {
    renderEditor();
    postPreviewMessage({ type: 'input', sectionId: 'sec-hero', path: 'content.headline', value: '수정 중' });
    postPreviewMessage({ type: 'input', sectionId: 'sec-hero', path: 'content.headline', value: '수정 중인 제목' });
    expect(onSectionsChange).not.toHaveBeenCalled();
  });

  it("'commit' 타입은 onSectionsChange를 1회 호출하고 최종 입력값을 반영한다", () => {
    renderEditor();
    postPreviewMessage({ type: 'input', sectionId: 'sec-hero', path: 'content.headline', value: '수정 중' });
    postPreviewMessage({ type: 'commit', sectionId: 'sec-hero', path: 'content.headline', value: '최종 제목' });
    expect(onSectionsChange).toHaveBeenCalledTimes(1);
    const next = onSectionsChange.mock.calls[0][0] as DetailSection[];
    expect((next[0].content as { headline: string }).headline).toBe('최종 제목');
  });

  it("출처가 다른 메시지는 무시한다", () => {
    renderEditor();
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { source: 'other', type: 'commit', sectionId: 'sec-hero', path: 'content.headline', value: 'x' },
          origin: window.location.origin,
        }),
      );
    });
    expect(onSectionsChange).not.toHaveBeenCalled();
  });
});

describe('DetailPageEditor — 미리보기 스크롤 복원', () => {
  it("'scroll'로 저장한 위치를 'ready' 수신 시 iframe에 복원한다", () => {
    const { container } = renderEditor();
    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    const scrollToSpy = vi.fn();
    // jsdom iframe contentWindow의 scrollTo를 스파이로 대체
    Object.defineProperty(iframe!, 'contentWindow', {
      value: { scrollTo: scrollToSpy },
      configurable: true,
    });

    postPreviewMessage({ type: 'scroll', y: 420 });
    postPreviewMessage({ type: 'ready' });

    expect(scrollToSpy).toHaveBeenCalledWith(0, 420);
  });

  it("'scroll' 메시지가 없으면 0으로 복원한다", () => {
    const { container } = renderEditor();
    const iframe = container.querySelector('iframe')!;
    const scrollToSpy = vi.fn();
    Object.defineProperty(iframe, 'contentWindow', {
      value: { scrollTo: scrollToSpy },
      configurable: true,
    });

    postPreviewMessage({ type: 'ready' });

    expect(scrollToSpy).toHaveBeenCalledWith(0, 0);
  });
});
