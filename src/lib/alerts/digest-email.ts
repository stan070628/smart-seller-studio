import type { Alert } from './types';

export interface AlertRow extends Omit<Alert, 'createdAt' | 'readAt' | 'emailedAt'> {
  id: number;
  createdAt: Date;
}

const TYPE_LABELS: Record<string, string> = {
  roas_low: '🔻 광고 ROAS 미달',
  stock_low: '📦 재고 부족',
  negative_review: '⚠️ 부정 리뷰',
  winner_lost: '🏃 위너 빼앗김',
  sourcing_recommendation: '💡 사입 추천',
  review_milestone: '🎉 리뷰 도달',
  inbound_return_warning: '📤 회송 경고',
  channel_distribution: '📊 채널 분배',
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#DC2626',
  high: '#EA580C',
  medium: '#CA8A04',
  low: '#16A34A',
};

export function buildDigestHtml(alerts: AlertRow[]): {
  subject: string;
  html: string;
  text: string;
} {
  const date = new Date().toISOString().slice(0, 10);
  const grouped: Record<string, AlertRow[]> = {};
  for (const a of alerts) {
    grouped[a.type] = grouped[a.type] ?? [];
    grouped[a.type].push(a);
  }

  const sections = Object.entries(grouped)
    .map(
      ([type, items]) => `
        <h3 style="margin-top: 20px; color: #1F2937;">${TYPE_LABELS[type] ?? type} (${items.length}건)</h3>
        <ul style="margin: 0; padding-left: 20px;">
          ${items
            .map(
              (a) =>
                `<li style="margin: 4px 0; color: ${SEVERITY_COLORS[a.severity] ?? '#374151'}">${a.message}</li>`,
            )
            .join('')}
        </ul>
      `,
    )
    .join('');

  const html = `
    <html><body style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="border-bottom: 2px solid #2563EB; padding-bottom: 8px;">📊 일일 알림 다이제스트 ${date}</h2>
      <p style="color: #6B7280;">총 ${alerts.length}건 알림.</p>
      ${sections}
      <p style="margin-top: 30px; color: #9CA3AF; font-size: 12px;">
        SmartSellerStudio · 전략 v2 §2.A
      </p>
    </body></html>
  `;

  const text = alerts.map((a) => `[${a.severity}] ${a.message}`).join('\n');

  return {
    subject: `📊 알림 다이제스트 (${alerts.length}건) — ${date}`,
    html,
    text,
  };
}
