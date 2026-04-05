'use client';

/**
 * 로그인 / 회원가입 페이지
 *
 * - 자체 JWT 인증 API (/api/auth/login, /api/auth/signup) 사용
 * - 로그인과 회원가입을 하나의 페이지에서 토글로 전환
 * - 성공 시 redirectTo 쿼리 파라미터가 있으면 해당 경로로, 없으면 /로 이동
 */

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

// ─────────────────────────────────────────
// 상수
// ─────────────────────────────────────────

const ACCENT = '#be0014';
const ACCENT_HOVER = '#990010';
const BACKGROUND = '#0f0f0f';
const SURFACE = '#1a1a1a';
const BORDER = '#2a2a2a';
const TEXT_PRIMARY = '#f5f5f5';
const TEXT_SECONDARY = '#888';
const INPUT_BG = '#111';

// ─────────────────────────────────────────
// 컴포넌트
// ─────────────────────────────────────────

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirectTo') ?? '/';

  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isHovering, setIsHovering] = useState(false);

  // 모드 전환 시 에러/메시지 초기화
  useEffect(() => {
    setError(null);
    setMessage(null);
  }, [mode]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setIsLoading(true);

    const endpoint =
      mode === 'login' ? '/api/auth/login' : '/api/auth/signup';

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = (await res.json()) as { error?: string; success?: boolean };

      if (!res.ok) {
        setError(data.error ?? '요청 처리 중 오류가 발생했습니다.');
        return;
      }

      // 성공 — router.refresh()로 서버 컴포넌트 캐시를 무효화한 뒤 이동
      router.refresh();
      router.push(redirectTo);
    } catch {
      setError('요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: BACKGROUND,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        fontFamily: "'Noto Sans KR', sans-serif",
      }}
    >
      {/* 로그인 카드 */}
      <div
        style={{
          width: '100%',
          maxWidth: '400px',
          backgroundColor: SURFACE,
          border: `1px solid ${BORDER}`,
          borderRadius: '12px',
          padding: '40px 36px',
        }}
      >
        {/* 앱 이름 */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div
            style={{
              display: 'inline-block',
              width: '40px',
              height: '40px',
              backgroundColor: ACCENT,
              borderRadius: '10px',
              marginBottom: '16px',
            }}
          />
          <h1
            style={{
              margin: 0,
              fontSize: '20px',
              fontWeight: 700,
              color: TEXT_PRIMARY,
              letterSpacing: '-0.3px',
            }}
          >
            Smart Seller Studio
          </h1>
          <p
            style={{
              margin: '6px 0 0',
              fontSize: '13px',
              color: TEXT_SECONDARY,
            }}
          >
            {mode === 'login' ? '계정에 로그인하세요' : '새 계정을 만드세요'}
          </p>
        </div>

        {/* 로그인 폼 */}
        <form onSubmit={handleSubmit} noValidate>
          {/* 이메일 입력 */}
          <div style={{ marginBottom: '16px' }}>
            <label
              htmlFor="email"
              style={{
                display: 'block',
                fontSize: '13px',
                fontWeight: 500,
                color: TEXT_SECONDARY,
                marginBottom: '6px',
              }}
            >
              이메일
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="hello@example.com"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '10px 12px',
                backgroundColor: INPUT_BG,
                border: `1px solid ${BORDER}`,
                borderRadius: '8px',
                fontSize: '14px',
                color: TEXT_PRIMARY,
                outline: 'none',
                transition: 'border-color 0.15s',
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = ACCENT;
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = BORDER;
              }}
            />
          </div>

          {/* 비밀번호 입력 */}
          <div style={{ marginBottom: '24px' }}>
            <label
              htmlFor="password"
              style={{
                display: 'block',
                fontSize: '13px',
                fontWeight: 500,
                color: TEXT_SECONDARY,
                marginBottom: '6px',
              }}
            >
              비밀번호
            </label>
            <input
              id="password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'signup' ? '최소 6자 이상' : '••••••••'}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '10px 12px',
                backgroundColor: INPUT_BG,
                border: `1px solid ${BORDER}`,
                borderRadius: '8px',
                fontSize: '14px',
                color: TEXT_PRIMARY,
                outline: 'none',
                transition: 'border-color 0.15s',
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = ACCENT;
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = BORDER;
              }}
            />
          </div>

          {/* 에러 메시지 */}
          {error && (
            <div
              role="alert"
              style={{
                marginBottom: '16px',
                padding: '10px 12px',
                backgroundColor: 'rgba(190, 0, 20, 0.1)',
                border: `1px solid rgba(190, 0, 20, 0.3)`,
                borderRadius: '8px',
                fontSize: '13px',
                color: '#ff6b7a',
                lineHeight: '1.5',
              }}
            >
              {error}
            </div>
          )}

          {/* 성공/안내 메시지 */}
          {message && (
            <div
              role="status"
              style={{
                marginBottom: '16px',
                padding: '10px 12px',
                backgroundColor: 'rgba(34, 197, 94, 0.1)',
                border: '1px solid rgba(34, 197, 94, 0.3)',
                borderRadius: '8px',
                fontSize: '13px',
                color: '#86efac',
                lineHeight: '1.5',
              }}
            >
              {message}
            </div>
          )}

          {/* 제출 버튼 */}
          <button
            type="submit"
            disabled={isLoading}
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
            style={{
              width: '100%',
              padding: '11px',
              backgroundColor: isLoading
                ? '#555'
                : isHovering
                ? ACCENT_HOVER
                : ACCENT,
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 600,
              color: '#fff',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              transition: 'background-color 0.15s',
              letterSpacing: '0.3px',
            }}
          >
            {isLoading
              ? mode === 'login'
                ? '로그인 중...'
                : '가입 중...'
              : mode === 'login'
              ? '로그인'
              : '회원가입'}
          </button>
        </form>

        {/* 모드 전환 링크 */}
        <div
          style={{
            marginTop: '24px',
            textAlign: 'center',
            fontSize: '13px',
            color: TEXT_SECONDARY,
          }}
        >
          {mode === 'login' ? (
            <>
              계정이 없으신가요?{' '}
              <button
                type="button"
                onClick={() => setMode('signup')}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  color: ACCENT,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontSize: '13px',
                  textDecoration: 'underline',
                  textUnderlineOffset: '2px',
                }}
              >
                회원가입
              </button>
            </>
          ) : (
            <>
              이미 계정이 있으신가요?{' '}
              <button
                type="button"
                onClick={() => setMode('login')}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  color: ACCENT,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontSize: '13px',
                  textDecoration: 'underline',
                  textUnderlineOffset: '2px',
                }}
              >
                로그인
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
