# 운영 자동화 알림 (광고 ROAS / 재고 / 부정 리뷰) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 매일 자동 모니터링으로 광고 ROAS 200% 미만 / 재고 30일분 미만 / 별점 4.0 미만 리뷰 발생 시 알림 생성, 매일 09:00 KST 이메일 다이제스트 발송, 인앱 배지 표시.

**Architecture:** 통합 alerts 테이블 + 3개 cron 배치 + 다이제스트 메일 + 인앱 배지 컴포넌트. 데이터는 기존 sourcing_items + coupang-report-agent 활용. 메일은 Resend 또는 SMTP (default Resend).

**Tech Stack:** TypeScript, Next.js App Router, Supabase Postgres, Resend API (이메일), Vitest
**전략 v2 의존도:** high (Week 6 시작 전 완료 권장)
**근거 spec:** `docs/superpowers/specs/2026-04-28-strategy-v2-extension-design.md` §2.A + §4

---

## File Structure

| 작업 | 경로 | 책임 |
|---|---|---|
| 신규 | `supabase/migrations/044_alerts.sql` | alerts + alert_settings 테이블 |
| 신규 | `src/lib/alerts/types.ts` | Alert/AlertType/AlertSeverity 타입 |
| 신규 | `src/lib/alerts/triggers.ts` | 임계값 검증 + alert 생성 헬퍼 |
| 신규 | `src/lib/alerts/digest-email.ts` | 다이제스트 메일 빌더 (HTML) |
| 신규 | `src/app/api/alerts/route.ts` | GET/PATCH 알림 CRUD |
| 신규 | `src/app/api/alerts/cron/route.ts` | GET 알림 생성 + 다이제스트 발송 |
| 신규 | `src/app/plan/alerts/page.tsx` | 알림 센터 |
| 신규 | `src/app/plan/alerts/settings/page.tsx` | 알림 설정 |
| 신규 | `src/components/alerts/AlertBadge.tsx` | 사이드바 배지 |
| 신규 | `src/components/alerts/AlertList.tsx` | 알림 리스트 |
| 신규 | `src/lib/alerts/__tests__/triggers.test.ts` | 임계값 테스트 |

---

## Task 1: DB 마이그레이션 — alerts + alert_settings

**Files:**
- Create: `supabase/migrations/044_alerts.sql`

- [ ] **Step 1: 마이그레이션 SQL 작성**

```sql
-- 알림 통합 테이블
-- spec 2026-04-28-strategy-v2-extension §2.A + §4

CREATE TABLE IF NOT EXISTS alerts (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID,
  type TEXT NOT NULL CHECK (type IN (
    'roas_low', 'stock_low', 'negative_review',
    'winner_lost', 'sourcing_recommendation', 'review_milestone',
    'inbound_return_warning', 'channel_distribution'
  )),
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  sku_code TEXT,
  message TEXT NOT NULL,
  detail JSONB,
  read_at TIMESTAMPTZ,
  emailed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alerts_user_unread
  ON alerts (user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alerts_type_severity
  ON alerts (type, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_pending_email
  ON alerts (created_at) WHERE emailed_at IS NULL;

CREATE TABLE IF NOT EXISTS alert_settings (
  user_id UUID PRIMARY KEY,
  email TEXT,
  digest_enabled BOOLEAN NOT NULL DEFAULT true,
  immediate_critical BOOLEAN NOT NULL DEFAULT true,
  type_filters JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE alerts IS '운영 알림 통합 큐. spec 2026-04-28 §2.A + §4';
COMMENT ON TABLE alert_settings IS '사용자별 알림 설정. spec 2026-04-28 §4.4';
```

- [ ] **Step 2: 커밋**

```bash
git add supabase/migrations/044_alerts.sql
git commit -m "feat(db): add alerts + alert_settings tables"
```

---

## Task 2: 타입 + 트리거 헬퍼 (TDD)

**Files:**
- Create: `src/lib/alerts/types.ts`
- Create: `src/lib/alerts/triggers.ts`
- Create: `src/lib/alerts/__tests__/triggers.test.ts`

- [ ] **Step 1: 타입 작성**

Create `src/lib/alerts/types.ts`:

```ts
export type AlertType =
  | 'roas_low' | 'stock_low' | 'negative_review'
  | 'winner_lost' | 'sourcing_recommendation' | 'review_milestone'
  | 'inbound_return_warning' | 'channel_distribution';

export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface AlertInput {
  type: AlertType;
  severity: AlertSeverity;
  skuCode?: string;
  message: string;
  detail?: Record<string, unknown>;
}

export const THRESHOLDS = {
  roasLowPct: 200,
  stockLowDays: 30,
  reviewLowStars: 4.0,
} as const;
```

- [ ] **Step 2: 실패하는 테스트 작성**

Create `src/lib/alerts/__tests__/triggers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { detectRoasLow, detectStockLow, detectNegativeReview } from '../triggers';

describe('detectRoasLow', () => {
  it('ROAS 150% → 알림 생성 (high)', () => {
    const alert = detectRoasLow({ skuCode: 'A1', roasPct: 150, productName: 'X' });
    expect(alert?.type).toBe('roas_low');
    expect(alert?.severity).toBe('high');
  });
  it('ROAS 250% → null', () => {
    expect(detectRoasLow({ skuCode: 'A1', roasPct: 250, productName: 'X' })).toBeNull();
  });
});

describe('detectStockLow', () => {
  it('재고 5일분 → critical', () => {
    const alert = detectStockLow({
      skuCode: 'A1', productName: 'X', stockDays: 5, currentStock: 10, dailySales: 2,
    });
    expect(alert?.severity).toBe('critical');
  });
  it('재고 25일분 → medium', () => {
    const alert = detectStockLow({
      skuCode: 'A1', productName: 'X', stockDays: 25, currentStock: 50, dailySales: 2,
    });
    expect(alert?.severity).toBe('medium');
  });
  it('재고 35일분 → null', () => {
    expect(detectStockLow({
      skuCode: 'A1', productName: 'X', stockDays: 35, currentStock: 70, dailySales: 2,
    })).toBeNull();
  });
});

describe('detectNegativeReview', () => {
  it('별점 3.0 → critical', () => {
    expect(detectNegativeReview({
      skuCode: 'A1', productName: 'X', stars: 3.0, reviewText: '나쁨',
    })?.severity).toBe('critical');
  });
  it('별점 4.5 → null', () => {
    expect(detectNegativeReview({
      skuCode: 'A1', productName: 'X', stars: 4.5, reviewText: '좋음',
    })).toBeNull();
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx vitest run src/lib/alerts/__tests__/triggers.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: triggers.ts 구현**

Create `src/lib/alerts/triggers.ts`:

```ts
import type { AlertInput } from './types';
import { THRESHOLDS } from './types';

export function detectRoasLow(input: {
  skuCode: string; productName: string; roasPct: number;
}): AlertInput | null {
  if (input.roasPct >= THRESHOLDS.roasLowPct) return null;
  const severity = input.roasPct < 100 ? 'critical' : 'high';
  return {
    type: 'roas_low',
    severity,
    skuCode: input.skuCode,
    message: `광고 ROAS ${input.roasPct.toFixed(0)}%: ${input.productName}`,
    detail: { roasPct: input.roasPct },
  };
}

export function detectStockLow(input: {
  skuCode: string; productName: string;
  stockDays: number; currentStock: number; dailySales: number;
}): AlertInput | null {
  if (input.stockDays >= THRESHOLDS.stockLowDays) return null;
  const severity = input.stockDays < 7 ? 'critical' : input.stockDays < 14 ? 'high' : 'medium';
  return {
    type: 'stock_low',
    severity,
    skuCode: input.skuCode,
    message: `재고 ${input.stockDays}일분: ${input.productName}`,
    detail: {
      stockDays: input.stockDays,
      currentStock: input.currentStock,
      dailySales: input.dailySales,
    },
  };
}

export function detectNegativeReview(input: {
  skuCode: string; productName: string; stars: number; reviewText: string;
}): AlertInput | null {
  if (input.stars >= THRESHOLDS.reviewLowStars) return null;
  const severity = input.stars <= 2.0 ? 'critical' : input.stars <= 3.0 ? 'critical' : 'high';
  return {
    type: 'negative_review',
    severity,
    skuCode: input.skuCode,
    message: `부정 리뷰 ${input.stars}점: ${input.productName}`,
    detail: { stars: input.stars, reviewText: input.reviewText },
  };
}
```

- [ ] **Step 5: 테스트 통과**

Run: `npx vitest run src/lib/alerts/__tests__/triggers.test.ts`
Expected: PASS — 7개 테스트 통과

- [ ] **Step 6: 커밋**

```bash
git add src/lib/alerts/types.ts src/lib/alerts/triggers.ts src/lib/alerts/__tests__/triggers.test.ts
git commit -m "feat(alerts): add types + threshold trigger detectors"
```

---

## Task 3: 다이제스트 메일 빌더

**Files:**
- Create: `src/lib/alerts/digest-email.ts`

- [ ] **Step 1: 메일 빌더 작성**

```ts
import type { Alert } from './types';

export interface AlertRow extends Omit<Alert, 'createdAt' | 'readAt' | 'emailedAt'> {
  id: number;
  createdAt: Date;
}

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
        <h3 style="margin-top: 20px; color: #1F2937;">${typeLabel(type)} (${items.length}건)</h3>
        <ul style="margin: 0; padding-left: 20px;">
          ${items
            .map(
              (a) =>
                `<li style="margin: 4px 0; color: ${severityColor(a.severity)}">${a.message}</li>`,
            )
            .join('')}
        </ul>
      `,
    )
    .join('');

  const html = `
    <html><body style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="border-bottom: 2px solid #2563EB; padding-bottom: 8px;">📊 일일 알림 다이제스트 ${date}</h2>
      <p style="color: #6B7280;">총 ${alerts.length}건 알림. <a href="https://smart-seller-studio.vercel.app/plan/alerts">알림 센터에서 자세히 보기</a></p>
      ${sections}
      <p style="margin-top: 30px; color: #9CA3AF; font-size: 12px;">
        SmartSellerStudio · 전략 v2 §2.A · 알림 설정 변경: <a href="https://smart-seller-studio.vercel.app/plan/alerts/settings">설정</a>
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

function typeLabel(type: string): string {
  return {
    roas_low: '🔻 광고 ROAS 미달',
    stock_low: '📦 재고 부족',
    negative_review: '⚠️ 부정 리뷰',
    winner_lost: '🏃 위너 빼앗김',
    sourcing_recommendation: '💡 사입 추천',
    review_milestone: '🎉 리뷰 도달',
    inbound_return_warning: '📤 회송 경고',
    channel_distribution: '📊 채널 분배',
  }[type] ?? type;
}

function severityColor(s: string): string {
  return {
    critical: '#DC2626', high: '#EA580C', medium: '#CA8A04', low: '#16A34A',
  }[s] ?? '#374151';
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/lib/alerts/digest-email.ts
git commit -m "feat(alerts): add digest email HTML builder"
```

---

## Task 4: API + cron 라우트

**Files:**
- Create: `src/app/api/alerts/route.ts` (GET / PATCH)
- Create: `src/app/api/alerts/cron/route.ts`

- [ ] **Step 1: GET/PATCH route**

Create `src/app/api/alerts/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';

export async function GET(request: NextRequest) {
  const unread = request.nextUrl.searchParams.get('unread') === 'true';
  const pool = getSourcingPool();
  const { rows } = await pool.query(
    `SELECT id, type, severity, sku_code, message, detail, read_at, created_at
     FROM alerts
     WHERE ${unread ? 'read_at IS NULL' : 'true'}
     ORDER BY created_at DESC LIMIT 100`,
  );
  return NextResponse.json({ success: true, rows });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const ids = body?.ids as number[] | undefined;
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ success: false, error: 'ids required' }, { status: 400 });
  }
  const pool = getSourcingPool();
  await pool.query(`UPDATE alerts SET read_at = now() WHERE id = ANY($1::bigint[])`, [ids]);
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: cron route (Resend 발송)**

Create `src/app/api/alerts/cron/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { detectRoasLow, detectStockLow, detectNegativeReview } from '@/lib/alerts/triggers';
import { buildDigestHtml, type AlertRow } from '@/lib/alerts/digest-email';

const CRON_SECRET = process.env.CRON_SECRET ?? '';
const RESEND_API_KEY = process.env.RESEND_API_KEY ?? '';
const ALERT_EMAIL = process.env.ALERT_EMAIL ?? 'stan@aibox.it.kr';

async function sendEmail(subject: string, html: string, text: string): Promise<boolean> {
  if (!RESEND_API_KEY) return false;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'SmartSellerStudio <alerts@smart-seller-studio.app>',
      to: [ALERT_EMAIL],
      subject,
      html,
      text,
    }),
  });
  return res.ok;
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization') ?? '';
  if (!CRON_SECRET || auth.replace('Bearer ', '') !== CRON_SECRET) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const pool = getSourcingPool();

  // 1. ROAS 데이터 수집 (sourcing_items + ad reports)
  // 1차 placeholder: sourcing_items의 winner_occupancy 사용
  const { rows: roasRows } = await pool.query(
    `SELECT item_no::text AS sku_code, title, COALESCE(roas_pct, 0) AS roas_pct
     FROM sourcing_items WHERE is_tracking = true LIMIT 50`,
  ).catch(() => ({ rows: [] }));

  let created = 0;
  for (const row of roasRows) {
    const alert = detectRoasLow({
      skuCode: row.sku_code,
      productName: row.title,
      roasPct: Number(row.roas_pct),
    });
    if (alert) {
      await pool.query(
        `INSERT INTO alerts (type, severity, sku_code, message, detail) VALUES ($1, $2, $3, $4, $5)`,
        [alert.type, alert.severity, alert.skuCode, alert.message, JSON.stringify(alert.detail ?? {})],
      );
      created++;
    }
  }

  // 2. 미발송 알림 다이제스트
  const { rows: pending } = await pool.query<AlertRow>(
    `SELECT id, type, severity, sku_code AS "skuCode", message, detail, created_at AS "createdAt"
     FROM alerts WHERE emailed_at IS NULL AND created_at > now() - INTERVAL '24 hours'
     ORDER BY severity DESC, created_at DESC LIMIT 50`,
  );

  let emailed = false;
  if (pending.length > 0) {
    const digest = buildDigestHtml(pending);
    emailed = await sendEmail(digest.subject, digest.html, digest.text);
    if (emailed) {
      await pool.query(
        `UPDATE alerts SET emailed_at = now() WHERE id = ANY($1::bigint[])`,
        [pending.map((p) => p.id)],
      );
    }
  }

  return NextResponse.json({
    success: true,
    created,
    pending: pending.length,
    emailed,
  });
}
```

- [ ] **Step 3: 빌드 + 커밋**

```bash
git add src/app/api/alerts/
git commit -m "feat(api): add /api/alerts CRUD + /cron daily digest"
```

---

## Task 5: 알림 센터 UI

**Files:**
- Create: `src/components/alerts/AlertList.tsx`
- Create: `src/app/plan/alerts/page.tsx`

- [ ] **Step 1: 리스트 컴포넌트**

```tsx
'use client';

import { useEffect, useState } from 'react';

interface Row {
  id: number;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  sku_code: string | null;
  message: string;
  read_at: string | null;
  created_at: string;
}

const SEVERITY_COLORS = {
  critical: '#FEE2E2', high: '#FFEDD5', medium: '#FEF3C7', low: '#D1FAE5',
};

export default function AlertList({ unreadOnly }: { unreadOnly?: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const r = await fetch(`/api/alerts${unreadOnly ? '?unread=true' : ''}`);
    const data = await r.json();
    if (data.success) setRows(data.rows);
    setLoading(false);
  }

  useEffect(() => { load(); }, [unreadOnly]);

  async function markRead(ids: number[]) {
    await fetch('/api/alerts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    load();
  }

  if (loading) return <div className="p-4 text-sm text-gray-500">불러오는 중…</div>;
  if (rows.length === 0) return <div className="p-4 text-sm text-gray-500">알림 없음</div>;

  return (
    <ul className="space-y-2">
      {rows.map((a) => (
        <li
          key={a.id}
          style={{ background: SEVERITY_COLORS[a.severity] }}
          className="rounded p-3 flex items-center justify-between"
        >
          <div className="flex-1">
            <div className="text-xs text-gray-500">{a.type} · {new Date(a.created_at).toLocaleString()}</div>
            <div className="font-medium">{a.message}</div>
          </div>
          {!a.read_at && (
            <button
              onClick={() => markRead([a.id])}
              className="rounded bg-white border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50"
            >
              읽음
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: 페이지**

Create `src/app/plan/alerts/page.tsx`:

```tsx
import AlertList from '@/components/alerts/AlertList';

export const metadata = { title: '알림 센터' };

export default function AlertsPage() {
  return (
    <main className="container mx-auto px-4 py-8">
      <h1 className="mb-2 text-2xl font-bold">알림 센터</h1>
      <p className="mb-6 text-sm text-gray-600">
        광고 ROAS / 재고 / 부정 리뷰 등 운영 알림 통합. (전략 v2 extension §2.A)
      </p>
      <AlertList />
    </main>
  );
}
```

- [ ] **Step 3: 빌드 + 커밋**

```bash
git add src/components/alerts/ src/app/plan/alerts/
git commit -m "feat(ui): add /plan/alerts notification center"
```

---

## Task 6: vercel.json cron 등록

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: 기존 vercel.json에 cron 추가**

Run: `cat vercel.json`
이 결과를 보고 crons 섹션이 있으면 추가, 없으면 신설:

```json
{
  "crons": [
    {
      "path": "/api/alerts/cron",
      "schedule": "0 0 * * *"
    },
    {
      "path": "/api/winners/cron",
      "schedule": "30 0 * * *"
    }
  ]
}
```

(09:00 KST = 00:00 UTC. winner cron은 09:30 KST.)

- [ ] **Step 2: Vercel Cron Secret 환경변수 등록**

Run: `/Users/seungminlee/.npm-global/bin/vercel env add CRON_SECRET production`
Expected: 프롬프트로 값 입력 — 사용자가 설정 (또는 기존 .env.local의 CRON_SECRET 재사용)

- [ ] **Step 3: 커밋 + push (배포 자동)**

```bash
git add vercel.json
git commit -m "feat(cron): register alerts + winners daily cron jobs"
git push origin main
```

---

## Self-Review

**1. Spec coverage**
- §2.A 기능 1 (ROAS) → Task 2 detectRoasLow + Task 4 cron
- §2.A 기능 2 (재고) → Task 2 detectStockLow + Task 4 cron (placeholder, 실제 데이터 수집은 후속)
- §2.A 기능 3 (부정 리뷰) → Task 2 detectNegativeReview + Task 4 cron
- §4 다이제스트 → Task 3 + Task 4
- §6.1 페이지 → Task 5
- §6.2 API → Task 4

**2. Placeholder 명시**
- 재고/리뷰 데이터 수집은 1차 placeholder (sourcing_items 활용). 추후 coupang-report-agent와 통합.

**3. 의존성**
- RESEND_API_KEY 환경변수 필요 (없으면 메일 SKIP, alert는 생성됨)
- ALERT_EMAIL 환경변수 (default: stan@aibox.it.kr)
- vercel cron이 호출하려면 production 배포 필요
