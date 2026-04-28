import { describe, it, expect } from 'vitest';
import { detectMilestones } from '../milestone-detector';

describe('detectMilestones', () => {
  it('45 → 55 → reached_50 true', () => {
    const r = detectMilestones({
      previousCount: 45, currentCount: 55,
      previousReached50: false, previousReached100: false,
    });
    expect(r.justReached50).toBe(true);
    expect(r.justReached100).toBe(false);
  });

  it('95 → 105 → reached_100 true', () => {
    const r = detectMilestones({
      previousCount: 95, currentCount: 105,
      previousReached50: true, previousReached100: false,
    });
    expect(r.justReached100).toBe(true);
  });

  it('55 → 60 (이미 50 도달) → just false', () => {
    const r = detectMilestones({
      previousCount: 55, currentCount: 60,
      previousReached50: true, previousReached100: false,
    });
    expect(r.justReached50).toBe(false);
    expect(r.justReached100).toBe(false);
  });

  it('45 → 110 한 번에 둘 다', () => {
    const r = detectMilestones({
      previousCount: 45, currentCount: 110,
      previousReached50: false, previousReached100: false,
    });
    expect(r.justReached50).toBe(true);
    expect(r.justReached100).toBe(true);
  });
});
