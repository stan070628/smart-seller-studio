export interface ShotCard {
  sectionTitle: string;
  subject: string;
  angle: string;
  framing: string;
  lighting: string;
  background: string;
  tip: string;
}

export interface ShotGuideInput {
  sectionIndex: number;
  slotIndex: number;
  sectionTitle: string;
  promptHint: string;
}

export interface ShootSlot {
  sectionIndex: number;
  slotIndex: number;
  uploadedUrl: string | null;
  retouchedUrl?: string | null; // Phase 4: 보정본 URL
}
