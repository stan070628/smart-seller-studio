'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Calculator, BarChart3 } from 'lucide-react';
import CoupangTab from './tabs/CoupangTab';
import NaverTab from './tabs/NaverTab';
import GmarketTab from './tabs/GmarketTab';
import ElevenstTab from './tabs/ElevenstTab';
import ShopeeTab from './tabs/ShopeeTab';
import CompareMode from './CompareMode';

type Tab = 'coupang' | 'naver' | 'gmarket' | 'elevenst' | 'shopee';

const TABS: { id: Tab; label: string; color: string }[] = [
  { id: 'coupang', label: '쿠팡', color: '#be0014' },
  { id: 'naver', label: '네이버', color: '#03c75a' },
  { id: 'gmarket', label: 'G마켓', color: '#6dbe46' },
  { id: 'elevenst', label: '11번가', color: '#ff0038' },
  { id: 'shopee', label: 'Shopee', color: '#ee4d2d' },
];

export default function CalculatorClient() {
  const [activeTab, setActiveTab] = useState<Tab>('coupang');
  const [showCompare, setShowCompare] = useState(false);

  return (
    <div className="flex min-h-screen flex-col bg-[#f5f5f7]">
      {/* 헤더 */}
      <header className="sticky top-0 z-50 flex h-[52px] flex-shrink-0 items-center justify-between border-b border-[#eee] bg-white px-4 md:px-5">
        <div className="flex items-center gap-4 md:gap-6">
          <Link href="/editor" className="flex items-center gap-2 no-underline">
            <span className="text-sm font-bold tracking-tight text-[#1a1c1c] md:text-base">
              Smart<span className="text-[#be0014]">Seller</span>Studio
            </span>
            <span className="rounded-full border border-[rgba(190,0,20,0.2)] bg-[rgba(190,0,20,0.08)] px-2 py-0.5 text-[10px] font-semibold text-[#be0014] md:text-[11px]">
              Beta
            </span>
          </Link>

          <nav className="flex items-center gap-1">
            {[
              { href: '/dashboard', label: '대시보드' },
              { href: '/sourcing', label: '소싱' },
              { href: '/editor', label: '에디터' },
              { href: '/listing', label: '상품등록' },
              { href: '/orders', label: '주문/매출' },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-2.5 py-1 text-xs font-medium text-[#71717a] no-underline md:px-3 md:text-[13px]"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      {/* 메인 */}
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-5 md:px-6 md:py-8">
        {/* 타이틀 */}
        <div className="mb-5 flex flex-col gap-2 md:mb-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#be0014]/10">
              <Calculator size={18} className="text-[#be0014]" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-[#18181b] md:text-xl">마진 계산기</h1>
              <p className="text-xs text-[#71717a]">플랫폼별 수수료 자동 계산</p>
            </div>
          </div>
          <button
            onClick={() => setShowCompare(!showCompare)}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors md:text-sm ${
              showCompare
                ? 'border-[#be0014]/30 bg-[#be0014]/5 text-[#be0014]'
                : 'border-[#e5e5e5] bg-white text-[#52525b] hover:border-[#d4d4d8]'
            }`}
          >
            <BarChart3 size={15} />
            {showCompare ? '개별 계산 모드' : '플랫폼 비교 모드'}
          </button>
        </div>

        {showCompare ? (
          <CompareMode />
        ) : (
          <>
            {/* 플랫폼 탭 */}
            <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-white p-1 shadow-sm md:mb-5">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium transition-all md:text-sm ${
                    activeTab === tab.id
                      ? 'shadow-sm'
                      : 'text-[#71717a] hover:text-[#18181b]'
                  }`}
                  style={
                    activeTab === tab.id
                      ? { backgroundColor: tab.color + '10', color: tab.color, fontWeight: 600 }
                      : undefined
                  }
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* 탭 콘텐츠 */}
            {activeTab === 'coupang' && <CoupangTab />}
            {activeTab === 'naver' && <NaverTab />}
            {activeTab === 'gmarket' && <GmarketTab />}
            {activeTab === 'elevenst' && <ElevenstTab />}
            {activeTab === 'shopee' && <ShopeeTab />}
          </>
        )}

        {/* 푸터 안내 */}
        <p className="mt-6 text-center text-[10px] leading-relaxed text-[#a1a1aa] md:text-xs">
          수수료는 2025년 10월 기준이며, 플랫폼 정책 변경에 따라 달라질 수 있습니다.
          <br />
          정확한 수수료는 각 플랫폼 판매자센터에서 확인하세요.
        </p>
      </main>
    </div>
  );
}
