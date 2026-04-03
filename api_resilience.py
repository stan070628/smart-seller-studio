"""
API 탄력성 유틸리티
- 지수 백오프 with jitter
- 비동기 HTTP 클라이언트 (httpx)
- 429/503/5xx 자동 재시도
- 다중 provider fallback
"""
import asyncio
import random
import logging
from typing import Callable, TypeVar, Any, Optional
from functools import wraps
import httpx

logger = logging.getLogger(__name__)
T = TypeVar("T")

# ── 지수 백오프 설정 ─────────────────────────────
RETRYABLE_STATUS = {429, 500, 502, 503, 504}
DEFAULT_MAX_RETRIES = 3
DEFAULT_BASE_DELAY = 1.0   # seconds
DEFAULT_MAX_DELAY = 60.0   # seconds
DEFAULT_JITTER = 0.2       # ±20%


def calc_backoff(
    attempt: int,
    base: float = DEFAULT_BASE_DELAY,
    max_delay: float = DEFAULT_MAX_DELAY,
    jitter: float = DEFAULT_JITTER,
) -> float:
    """지수 백오프 + jitter 계산"""
    delay = min(base * (2 ** attempt), max_delay)
    jitter_range = delay * jitter
    return delay + random.uniform(-jitter_range, jitter_range)


def with_retry(
    max_retries: int = DEFAULT_MAX_RETRIES,
    retryable_exceptions: tuple = (
        httpx.HTTPStatusError,
        httpx.ConnectError,
        httpx.TimeoutException,
    ),
):
    """비동기 함수용 지수 백오프 재시도 데코레이터"""
    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        @wraps(func)
        async def wrapper(*args, **kwargs):
            last_exc = None
            for attempt in range(max_retries + 1):
                try:
                    return await func(*args, **kwargs)
                except retryable_exceptions as e:
                    last_exc = e
                    # httpx.HTTPStatusError인 경우 상태 코드 확인
                    if isinstance(e, httpx.HTTPStatusError):
                        status = e.response.status_code
                        if status == 429:
                            # Retry-After 헤더 확인
                            retry_after = e.response.headers.get("Retry-After")
                            if retry_after:
                                wait = float(retry_after)
                            else:
                                wait = calc_backoff(attempt)
                            logger.warning(
                                f"[Rate Limit] {func.__name__} attempt {attempt+1}/{max_retries+1}, "
                                f"retry in {wait:.1f}s"
                            )
                        elif status in RETRYABLE_STATUS:
                            wait = calc_backoff(attempt)
                            logger.warning(
                                f"[HTTP {status}] {func.__name__} attempt {attempt+1}/{max_retries+1}, "
                                f"retry in {wait:.1f}s"
                            )
                        else:
                            # 4xx (429 제외)는 재시도 안함
                            raise
                    else:
                        wait = calc_backoff(attempt)
                        logger.warning(
                            f"[Error] {func.__name__} attempt {attempt+1}/{max_retries+1}: "
                            f"{e}, retry in {wait:.1f}s"
                        )

                    if attempt < max_retries:
                        await asyncio.sleep(wait)
                    else:
                        raise last_exc
            raise last_exc
        return wrapper
    return decorator


class AsyncHTTPClient:
    """재사용 가능한 비동기 HTTP 클라이언트 (연결 풀링 + 재시도)"""

    _instance: Optional["AsyncHTTPClient"] = None

    def __init__(self, timeout: float = 30.0):
        limits = httpx.Limits(max_keepalive_connections=10, max_connections=20)
        self._client = httpx.AsyncClient(timeout=timeout, limits=limits)

    @classmethod
    def get(cls) -> "AsyncHTTPClient":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    async def get_json(
        self,
        url: str,
        *,
        headers: dict = None,
        params: dict = None,
        max_retries: int = DEFAULT_MAX_RETRIES,
    ) -> dict:
        """GET 요청 + 재시도"""
        for attempt in range(max_retries + 1):
            try:
                resp = await self._client.get(
                    url, headers=headers or {}, params=params or {}
                )
                resp.raise_for_status()
                return resp.json()
            except httpx.HTTPStatusError as e:
                if e.response.status_code not in RETRYABLE_STATUS or attempt == max_retries:
                    raise
                wait = calc_backoff(attempt)
                logger.warning(
                    f"GET {url} failed ({e.response.status_code}), "
                    f"retry {attempt+1} in {wait:.1f}s"
                )
                await asyncio.sleep(wait)
            except (httpx.ConnectError, httpx.TimeoutException) as e:
                if attempt == max_retries:
                    raise
                wait = calc_backoff(attempt)
                logger.warning(
                    f"GET {url} network error, retry {attempt+1} in {wait:.1f}s"
                )
                await asyncio.sleep(wait)

    async def post_json(
        self,
        url: str,
        *,
        headers: dict = None,
        json: dict = None,
        max_retries: int = DEFAULT_MAX_RETRIES,
    ) -> dict:
        """POST 요청 + 재시도"""
        for attempt in range(max_retries + 1):
            try:
                resp = await self._client.post(
                    url, headers=headers or {}, json=json or {}
                )
                resp.raise_for_status()
                return resp.json()
            except httpx.HTTPStatusError as e:
                if e.response.status_code not in RETRYABLE_STATUS or attempt == max_retries:
                    raise
                wait = calc_backoff(attempt)
                logger.warning(
                    f"POST {url} failed ({e.response.status_code}), "
                    f"retry {attempt+1} in {wait:.1f}s"
                )
                await asyncio.sleep(wait)
            except (httpx.ConnectError, httpx.TimeoutException) as e:
                if attempt == max_retries:
                    raise
                wait = calc_backoff(attempt)
                logger.warning(
                    f"POST {url} network error, retry {attempt+1} in {wait:.1f}s"
                )
                await asyncio.sleep(wait)

    async def close(self):
        await self._client.aclose()


class ProviderFallbackChain:
    """다중 provider fallback 체인 (순서대로 시도)"""

    def __init__(self, providers: list, provider_names: list = None):
        self.providers = providers
        self.provider_names = provider_names or [
            f"provider_{i}" for i in range(len(providers))
        ]

    async def call(self, *args, **kwargs) -> Any:
        """모든 provider를 순서대로 시도, 전부 실패 시 마지막 예외 raise"""
        last_exc = None
        for i, provider in enumerate(self.providers):
            name = self.provider_names[i]
            try:
                result = await provider(*args, **kwargs)
                if i > 0:
                    logger.info(f"[Fallback] '{name}' 성공 (primary 실패 후 fallback)")
                return result
            except Exception as e:
                last_exc = e
                logger.warning(
                    f"[Fallback] '{name}' 실패: {type(e).__name__}: {e}"
                )
                continue
        raise last_exc
