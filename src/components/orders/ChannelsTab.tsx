'use client';

import React from 'react';
import { Plus, ExternalLink } from 'lucide-react';
import { PLATFORM_INFO, type OrderPlatform } from '@/types/orders';
import { E } from '@/lib/design-tokens';
import { bandStyle, thStyle, btnStyle, statusBarStyle, statNumStyle, Tag } from './erp-ui';

/**
 * 연동 현황을 한 화면에 편다.
 *
 * 카드 세 장을 세로로 쌓던 구조를 표 세 개로 바꿨다 — 항목마다 묻는 것이
 * "연동됐나 / 무엇이 필요한가" 둘뿐이라 행으로 세우는 편이 비교가 빠르다.
 */

interface ChannelConfig {
  platform: OrderPlatform;
  connected: boolean;
  envKeys: string[];
  guideUrl: string;
}

const CHANNELS: ChannelConfig[] = [
  { platform: 'coupang', connected: true, envKeys: ['COUPANG_ACCESS_KEY', 'COUPANG_SECRET_KEY', 'COUPANG_VENDOR_ID'], guideUrl: 'wing.coupang.com' },
  { platform: 'naver', connected: true, envKeys: ['NAVER_COMMERCE_CLIENT_ID', 'NAVER_COMMERCE_CLIENT_SECRET'], guideUrl: 'apicenter.commerce.naver.com' },
  { platform: 'gmarket', connected: false, envKeys: ['ESM_ACCESS_KEY', 'ESM_MASTER_ID'], guideUrl: 'esmplus.com' },
  { platform: 'elevenst', connected: false, envKeys: ['ELEVENST_API_KEY'], guideUrl: 'soffice.11st.co.kr' },
  { platform: 'shopee', connected: false, envKeys: ['SHOPEE_PARTNER_ID', 'SHOPEE_PARTNER_KEY', 'SHOPEE_SHOP_ID'], guideUrl: 'open.shopee.com' },
];

const SUPPLIERS = [
  { name: '도매꾹', connected: true, note: 'API 연동됨', envKeys: ['DOMEGGOOK_API_KEY'] },
  { name: '도매매', connected: false, note: '추후 지원 예정', envKeys: [] },
  { name: '직접 사입', connected: false, note: '수동 관리', envKeys: [] },
];

const RULES = [
  { name: '기본 규칙', description: '주문 접수 시 → 알림 전송 (수동 확인 후 발주)', action: 'notify_only', active: true },
  { name: '재고 자동발주', description: '재고 10개 이하 시 → 도매꾹 자동 재발주', action: 'auto_order', active: false },
];

const panelStyle: React.CSSProperties = {
  border: `1px solid ${E.line}`,
  background: E.surface,
  marginBottom: 10,
};

const tdStyle: React.CSSProperties = {
  borderBottom: `1px solid ${E.lineSoft}`,
  borderRight: `1px solid ${E.lineSoft}`,
  padding: '5px 8px',
  fontSize: 12,
  color: E.ink,
  verticalAlign: 'middle',
};

/** env 키 목록 — 무엇을 채워야 하는지 그대로 보여준다 */
function EnvKeys({ keys }: { keys: string[] }) {
  if (keys.length === 0) return <span style={{ color: E.inkMute }}>—</span>;
  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      {keys.map((k) => (
        <code
          key={k}
          style={{
            fontFamily: E.mono, fontSize: 10.5, padding: '1px 4px',
            border: `1px solid ${E.lineSoft}`, background: E.chrome2, color: E.inkSub,
          }}
        >
          {k}
        </code>
      ))}
    </span>
  );
}

function ConnectedTag({ on, onLabel, offLabel }: { on: boolean; onLabel: string; offLabel: string }) {
  return on
    ? <Tag tone={E.profit}>{onLabel}</Tag>
    : <Tag tone={E.inkMute}>{offLabel}</Tag>;
}

export default function ChannelsTab() {
  const connectedChannels = CHANNELS.filter((c) => c.connected).length;
  const connectedSuppliers = SUPPLIERS.filter((s) => s.connected).length;
  const activeRules = RULES.filter((r) => r.active).length;

  return (
    <div style={{ background: E.ground, minHeight: '100%', paddingBottom: 4 }}>

      {/* ══ 판매 채널 ══ */}
      <div style={panelStyle}>
        <div style={bandStyle}>
          판매 채널 <span style={{ fontWeight: 400, color: E.inkMute }}>주문 자동수집 대상</span>
          <span style={{ marginLeft: 'auto', fontWeight: 400, color: E.inkMute, fontFamily: E.mono }}>
            {connectedChannels} / {CHANNELS.length} 연동
          </span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 720 }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, textAlign: 'left', width: '16%', minWidth: 120 }}>채널</th>
                <th style={{ ...thStyle, width: 80 }}>상태</th>
                <th style={{ ...thStyle, textAlign: 'left' }}>필요한 환경변수</th>
                <th style={{ ...thStyle, textAlign: 'left', width: '24%', minWidth: 200, borderRight: 'none' }}>키 발급처</th>
              </tr>
            </thead>
            <tbody>
              {CHANNELS.map((ch, i) => {
                const info = PLATFORM_INFO[ch.platform];
                return (
                  <tr key={ch.platform} style={{ background: i % 2 === 1 ? E.chrome2 : E.surface }}>
                    <td style={tdStyle}>
                      <span style={{ fontWeight: 600, color: info.color }}>{info.label}</span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <ConnectedTag on={ch.connected} onLabel="연동됨" offLabel="미연동" />
                    </td>
                    <td style={tdStyle}><EnvKeys keys={ch.envKeys} /></td>
                    <td style={{ ...tdStyle, borderRight: 'none', color: ch.connected ? E.inkMute : E.ink }}>
                      {ch.connected ? (
                        <span style={{ color: E.inkMute }}>주문 자동수집 활성</span>
                      ) : (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <ExternalLink size={11} color={E.inkMute} />
                          <span style={{ fontFamily: E.mono, fontSize: 11 }}>{ch.guideUrl}</span>
                          <span style={{ color: E.inkMute }}>에서 발급</span>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ══ 공급처 ══ */}
      <div style={panelStyle}>
        <div style={bandStyle}>
          공급처 <span style={{ fontWeight: 400, color: E.inkMute }}>사입·발주 경로</span>
          <span style={{ marginLeft: 'auto', fontWeight: 400, color: E.inkMute, fontFamily: E.mono }}>
            {connectedSuppliers} / {SUPPLIERS.length} 연동
          </span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 720 }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, textAlign: 'left', width: '16%', minWidth: 120 }}>공급처</th>
                <th style={{ ...thStyle, width: 80 }}>상태</th>
                <th style={{ ...thStyle, textAlign: 'left' }}>필요한 환경변수</th>
                <th style={{ ...thStyle, textAlign: 'left', width: '24%', minWidth: 200, borderRight: 'none' }}>비고</th>
              </tr>
            </thead>
            <tbody>
              {SUPPLIERS.map((s, i) => (
                <tr key={s.name} style={{ background: i % 2 === 1 ? E.chrome2 : E.surface }}>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{s.name}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    <ConnectedTag on={s.connected} onLabel="활성" offLabel="미연동" />
                  </td>
                  <td style={tdStyle}><EnvKeys keys={s.envKeys} /></td>
                  <td style={{ ...tdStyle, borderRight: 'none', color: E.inkMute }}>{s.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ══ 발주 규칙 ══ */}
      <div style={panelStyle}>
        <div style={bandStyle}>
          발주 규칙
          <span style={{ marginLeft: 'auto' }}>
            <button style={{ ...btnStyle, height: 22 }}>
              <Plus size={11} /> 규칙 추가
            </button>
          </span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 720 }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, textAlign: 'left', width: '16%', minWidth: 120 }}>규칙</th>
                <th style={{ ...thStyle, width: 80 }}>동작</th>
                <th style={{ ...thStyle, textAlign: 'left' }}>조건 → 처리</th>
                <th style={{ ...thStyle, width: 80, borderRight: 'none' }}>사용</th>
              </tr>
            </thead>
            <tbody>
              {RULES.map((r, i) => {
                const isAuto = r.action === 'auto_order';
                return (
                  <tr
                    key={r.name}
                    style={{ background: i % 2 === 1 ? E.chrome2 : E.surface, opacity: r.active ? 1 : 0.6 }}
                  >
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{r.name}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <Tag tone={isAuto ? E.profit : E.warn} filled={isAuto ? undefined : E.warnSoft}>
                        {isAuto ? '자동 발주' : '알림만'}
                      </Tag>
                    </td>
                    <td style={{ ...tdStyle, color: E.inkSub }}>{r.description}</td>
                    <td style={{ ...tdStyle, textAlign: 'center', borderRight: 'none' }}>
                      <ConnectedTag on={r.active} onLabel="켜짐" offLabel="꺼짐" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '5px 12px', background: E.chrome2, borderTop: `1px solid ${E.lineSoft}`, fontSize: 10.5, color: E.inkMute }}>
          자동 발주 규칙은 판매 채널과 공급처가 모두 연동된 뒤에 켤 수 있습니다.
        </div>
      </div>

      {/* ══ 상태바 ══ */}
      <div style={{ ...statusBarStyle, borderTop: `1px solid ${E.line}` }}>
        <span>판매 채널 <b style={statNumStyle}>{connectedChannels}</b>/{CHANNELS.length} 연동</span>
        <span>공급처 <b style={statNumStyle}>{connectedSuppliers}</b>/{SUPPLIERS.length} 연동</span>
        <span>발주 규칙 <b style={statNumStyle}>{activeRules}</b>/{RULES.length} 사용</span>
        <span style={{ marginLeft: 'auto', fontSize: 10.5, color: E.inkMute }}>
          환경변수는 .env.local에 넣고 서버를 다시 시작해야 반영됩니다
        </span>
      </div>
    </div>
  );
}
