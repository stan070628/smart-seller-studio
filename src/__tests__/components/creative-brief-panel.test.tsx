import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CreativeBriefPanel from '@/components/listing/detail-maker/CreativeBriefPanel';

describe('CreativeBriefPanel', () => {
  it('추천 무드 라벨을 보여준다', () => {
    render(
      <CreativeBriefPanel
        suggestedMoodIds={['luxury_dark']}
        selectedMoodId={null}
        isSuggesting={false}
        onSelectMood={vi.fn()}
      />,
    );
    expect(screen.getByText('럭셔리 다크')).toBeInTheDocument();
  });

  it('무드 클릭 시 onSelectMood(id) 호출', () => {
    const onSelect = vi.fn();
    render(
      <CreativeBriefPanel
        suggestedMoodIds={['luxury_dark']}
        selectedMoodId={null}
        isSuggesting={false}
        onSelectMood={onSelect}
      />,
    );
    fireEvent.click(screen.getByText('럭셔리 다크'));
    expect(onSelect).toHaveBeenCalledWith('luxury_dark');
  });

  it('"프리셋 더보기" 클릭 시 전체 카탈로그(8개)를 펼친다', () => {
    render(
      <CreativeBriefPanel
        suggestedMoodIds={['luxury_dark']}
        selectedMoodId={null}
        isSuggesting={false}
        onSelectMood={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText(/프리셋 더보기/));
    expect(screen.getByText('북유럽 미니멀')).toBeInTheDocument();
  });
});
