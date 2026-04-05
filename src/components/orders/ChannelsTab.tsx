'use client';

import React from 'react';
import { Link2, Plus, CheckCircle2, AlertCircle } from 'lucide-react';
import { PLATFORM_INFO, type OrderPlatform } from '@/types/orders';

interface ChannelConfig {
  platform: OrderPlatform;
  connected: boolean;
  envKeys: string[];
  guideUrl: string;
}

const CHANNELS: ChannelConfig[] = [
  { platform: 'coupang', connected: false, envKeys: ['COUPANG_ACCESS_KEY', 'COUPANG_SECRET_KEY', 'COUPANG_VENDOR_ID'], guideUrl: 'wing.coupang.com' },
  { platform: 'naver', connected: false, envKeys: ['NAVER_COMMERCE_CLIENT_ID', 'NAVER_COMMERCE_CLIENT_SECRET'], guideUrl: 'apicenter.commerce.naver.com' },
  { platform: 'gmarket', connected: false, envKeys: ['ESM_ACCESS_KEY', 'ESM_MASTER_ID'], guideUrl: 'esmplus.com' },
  { platform: 'elevenst', connected: false, envKeys: ['ELEVENST_API_KEY'], guideUrl: 'soffice.11st.co.kr' },
  { platform: 'shopee', connected: false, envKeys: ['SHOPEE_PARTNER_ID', 'SHOPEE_PARTNER_KEY', 'SHOPEE_SHOP_ID'], guideUrl: 'open.shopee.com' },
];

const SUPPLIERS = [
  { name: '도매꾹', connected: true, note: 'API 연동됨 (DOMEGGOOK_API_KEY)' },
  { name: '도매매', connected: false, note: '추후 지원 예정' },
  { name: '직접 사입', connected: false, note: '수동 관리' },
];

export default function ChannelsTab() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 판매 채널 */}
      <div style={{ backgroundColor: '#fff', borderRadius: '14px', border: '1px solid #e5e5e5', padding: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
          <Link2 size={16} color="#2563eb" />
          <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#18181b', margin: 0 }}>판매 채널</h3>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {CHANNELS.map((ch) => {
            const info = PLATFORM_INFO[ch.platform];
            return (
              <div key={ch.platform} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderRadius: '10px', backgroundColor: '#fafafa', border: '1px solid #f4f4f5' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: ch.connected ? '#16a34a' : '#d4d4d8' }} />
                  <div>
                    <span style={{ fontSize: '14px', fontWeight: 600, color: info.color }}>{info.label}</span>
                    <p style={{ fontSize: '11px', color: '#a1a1aa', margin: '2px 0 0' }}>
                      {ch.connected ? '연동됨 · 주문 자동수집 활성' : `${ch.guideUrl}에서 API 키 발급`}
                    </p>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {ch.connected ? (
                    <span style={{ fontSize: '12px', fontWeight: 600, color: '#16a34a', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <CheckCircle2 size={14} /> 연동됨
                    </span>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '12px', color: '#a1a1aa', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <AlertCircle size={12} /> .env.local 설정 필요
                      </span>
                      <button style={{ fontSize: '12px', fontWeight: 500, color: '#2563eb', background: 'none', border: '1px solid #bfdbfe', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer' }}>
                        설정 가이드
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 공급처 */}
      <div style={{ backgroundColor: '#fff', borderRadius: '14px', border: '1px solid #e5e5e5', padding: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
          <Package size={16} color="#7c3aed" />
          <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#18181b', margin: 0 }}>공급처</h3>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {SUPPLIERS.map((s) => (
            <div key={s.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderRadius: '10px', backgroundColor: '#fafafa', border: '1px solid #f4f4f5' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: s.connected ? '#16a34a' : '#d4d4d8' }} />
                <div>
                  <span style={{ fontSize: '14px', fontWeight: 600, color: '#18181b' }}>{s.name}</span>
                  <p style={{ fontSize: '11px', color: '#a1a1aa', margin: '2px 0 0' }}>{s.note}</p>
                </div>
              </div>
              {s.connected ? (
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#16a34a', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <CheckCircle2 size={14} /> 활성
                </span>
              ) : (
                <button style={{ fontSize: '12px', fontWeight: 500, color: '#71717a', background: 'none', border: '1px solid #e5e5e5', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Plus size={12} /> 연동하기
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 발주 규칙 */}
      <div style={{ backgroundColor: '#fff', borderRadius: '14px', border: '1px solid #e5e5e5', padding: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#18181b', margin: 0 }}>📋 발주 규칙</h3>
          <button style={{ fontSize: '12px', fontWeight: 500, color: '#2563eb', background: 'none', border: '1px solid #bfdbfe', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Plus size={12} /> 규칙 추가
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <RuleCard name="기본 규칙" description="주문 접수 시 → 알림 전송 (수동 확인 후 발주)" action="notify_only" active />
          <RuleCard name="재고 자동발주" description="재고 10개 이하 시 → 도매꾹 자동 재발주" action="auto_order" active={false} />
        </div>

        <p style={{ fontSize: '11px', color: '#a1a1aa', marginTop: '12px' }}>
          * 자동 발주 규칙은 판매 채널과 공급처가 모두 연동된 후 활성화됩니다.
        </p>
      </div>
    </div>
  );
}

function Package({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m7.5 4.27 9 5.15" /><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" />
    </svg>
  );
}

function RuleCard({ name, description, action, active }: { name: string; description: string; action: string; active: boolean }) {
  const actionLabel = action === 'auto_order' ? '자동 발주' : action === 'notify_only' ? '알림만' : '수동';
  const actionColor = action === 'auto_order' ? '#16a34a' : '#d97706';
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderRadius: '10px', backgroundColor: active ? '#fafafa' : '#f9f9f9', border: '1px solid #f4f4f5', opacity: active ? 1 : 0.6 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#18181b' }}>{name}</span>
          <span style={{ fontSize: '10px', fontWeight: 600, color: actionColor, backgroundColor: `${actionColor}15`, padding: '2px 6px', borderRadius: '4px' }}>{actionLabel}</span>
        </div>
        <p style={{ fontSize: '12px', color: '#71717a', margin: '4px 0 0' }}>{description}</p>
      </div>
      <div style={{ width: '36px', height: '20px', borderRadius: '10px', backgroundColor: active ? '#16a34a' : '#d4d4d8', position: 'relative', cursor: 'pointer', transition: 'background 0.2s' }}>
        <div style={{ width: '16px', height: '16px', borderRadius: '50%', backgroundColor: '#fff', position: 'absolute', top: '2px', left: active ? '18px' : '2px', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }} />
      </div>
    </div>
  );
}
