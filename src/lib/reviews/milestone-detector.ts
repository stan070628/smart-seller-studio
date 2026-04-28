export interface DetectInput {
  previousCount: number;
  currentCount: number;
  previousReached50: boolean;
  previousReached100: boolean;
}

export interface DetectResult {
  justReached50: boolean;
  justReached100: boolean;
}

export function detectMilestones(input: DetectInput): DetectResult {
  return {
    justReached50: !input.previousReached50 && input.currentCount >= 50,
    justReached100: !input.previousReached100 && input.currentCount >= 100,
  };
}
