/**
 * PlanProgressCard 컴포넌트 테스트
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PlanProgressCard from '@/components/dashboard/PlanProgressCard';

describe('PlanProgressCard', () => {
  it('주차/주간목표/실제/진행률을 표시한다', () => {
    render(
      <PlanProgressCard
        weekNumber={1}
        weekTitle="기반 세팅"
        weekTargetMan={50}
        weekActualMan={12}
        daysIntoWeek={5}
        keyMission="도매꾹 위 키워드 매칭 100개 선별"
      />
    );
    expect(screen.getByText(/Week 1/)).toBeInTheDocument();
    expect(screen.getByText('기반 세팅')).toBeInTheDocument();
    expect(screen.getAllByText(/50만원/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/12만원/)).toBeInTheDocument();
    expect(screen.getByText(/24%/)).toBeInTheDocument();
    expect(screen.getByText('도매꾹 위 키워드 매칭 100개 선별')).toBeInTheDocument();
    expect(screen.getByText(/D\+5\/7/)).toBeInTheDocument();
  });

  it('keyMission이 null이면 "이번주 미션 완료" 메시지 표시', () => {
    render(
      <PlanProgressCard
        weekNumber={1}
        weekTitle="기반 세팅"
        weekTargetMan={50}
        weekActualMan={50}
        daysIntoWeek={7}
        keyMission={null}
      />
    );
    expect(screen.getByText(/이번주 미션 완료/)).toBeInTheDocument();
  });

  it('weekTargetMan=0인 경우 진행률을 0%로 표시한다', () => {
    render(
      <PlanProgressCard
        weekNumber={1}
        weekTitle="기반 세팅"
        weekTargetMan={0}
        weekActualMan={0}
        daysIntoWeek={1}
        keyMission="첫 미션"
      />
    );
    expect(screen.getByText(/0%/)).toBeInTheDocument();
  });
});
