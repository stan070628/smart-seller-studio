import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LabelReader from '@/components/listing/LabelReader';

/** canvas·createImageBitmap은 jsdom에 없다 — 판독 요청까지만 검증한다 */
function stubImagePipeline() {
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 800, height: 600 }));
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({ drawImage: vi.fn() }) as never;
  HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue('data:image/jpeg;base64,AAAA');
}

const READING = {
  material: { raw: '겉감 폴리에스터 96%', value: '겉감 폴리에스터 96%', imageIndex: 0 },
  origin: { raw: 'BANGLADESH', value: '방글라데시', imageIndex: 0 },
  features: [{ raw: 'QUICK DRY', value: '빠른 건조', imageIndex: 1 }],
  certifications: [{ raw: 'FSC C176065', value: 'FSC 인증 재생지', imageIndex: 1 }],
};

function mockRead(body: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    json: async () => body,
  }));
}

async function uploadAndRead() {
  const file = new File(['x'], 'label.jpg', { type: 'image/jpeg' });
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  fireEvent.click(screen.getByText('읽기'));
}

describe('LabelReader', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    stubImagePipeline();
  });

  it('사진이 없으면 읽기 버튼이 비활성이다', () => {
    render(<LabelReader productName="반바지" />);
    expect((screen.getByText('읽기') as HTMLButtonElement).disabled).toBe(true);
  });

  it('판독 결과의 고시정보와 판매 포인트를 보여준다', async () => {
    mockRead({
      success: true,
      data: {
        reading: READING,
        keyPoints: ['빠른 건조', '겉감 폴리에스터 96%'],
        notice: { material: '겉감 폴리에스터 96%', origin: '방글라데시', manufacturer: '', careInstructions: '' },
        readCount: 3,
      },
    });
    render(<LabelReader productName="반바지" />);
    await uploadAndRead();

    await waitFor(() => expect(screen.getByText(/3개 항목을 읽었습니다/)).toBeTruthy());
    expect(screen.getByText('방글라데시')).toBeTruthy();
    expect(screen.getByText(/· 빠른 건조/)).toBeTruthy();
    // 못 읽은 칸은 비었다고 표시한다 — 자리표시 문구를 넣지 않는다
    expect(screen.getAllByText('읽지 못함').length).toBe(2);
  });

  it('인증·라이선스는 판매 포인트와 분리해 참고로만 보여준다', async () => {
    mockRead({
      success: true,
      data: {
        reading: READING,
        keyPoints: ['빠른 건조'],
        notice: { material: '', origin: '', manufacturer: '', careInstructions: '' },
        readCount: 3,
      },
    });
    render(<LabelReader productName="반바지" />);
    await uploadAndRead();

    await waitFor(() => expect(screen.getByText(/인증·라이선스/)).toBeTruthy());
    // 인증은 "참고" 블록에만 나타난다. 판매 포인트 목록은 keyPoints만 그리므로
    // FSC가 화면에 딱 한 번만 등장해야 한다 (두 번이면 양쪽에 들어간 것)
    expect(screen.getAllByText(/FSC 인증 재생지/)).toHaveLength(1);
  });

  it('적용 버튼은 기존 입력을 지우지 않고 덧붙인다', async () => {
    mockRead({
      success: true,
      data: {
        reading: READING,
        keyPoints: ['빠른 건조', '신축 원단'],
        notice: { material: '', origin: '', manufacturer: '', careInstructions: '' },
        readCount: 2,
      },
    });
    const onApply = vi.fn();
    render(<LabelReader productName="반바지" onApplyKeyPoints={onApply} />);
    await uploadAndRead();

    await waitFor(() => expect(screen.getByText(/핵심 판매 포인트에 추가/)).toBeTruthy());
    fireEvent.click(screen.getByText(/핵심 판매 포인트에 추가/));
    expect(onApply).toHaveBeenCalledWith(['빠른 건조', '신축 원단']);
  });

  it('읽어낸 게 없으면 다시 찍으라고 안내한다', async () => {
    mockRead({
      success: true,
      data: {
        reading: { features: [], certifications: [] },
        keyPoints: [],
        notice: { material: '', origin: '', manufacturer: '', careInstructions: '' },
        readCount: 0,
      },
      warning: '라벨에서 읽어낸 정보가 없습니다. 글자가 흐리거나 라벨이 아닌 사진일 수 있습니다.',
    });
    render(<LabelReader productName="반바지" />);
    await uploadAndRead();

    await waitFor(() => expect(screen.getByText(/읽어낸 정보가 없습니다/)).toBeTruthy());
    // 결과 블록 자체를 그리지 않는다 ("N개 항목을 읽었습니다"는 결과 블록 안에만 있다)
    expect(screen.queryByText(/개 항목을 읽었습니다/)).toBeNull();
    expect(screen.queryByText(/고시정보 복사/)).toBeNull();
  });

  it('서버 오류를 화면에 보여준다', async () => {
    mockRead({ success: false, error: '라벨 판독 실패: timeout' });
    render(<LabelReader productName="반바지" />);
    await uploadAndRead();
    await waitFor(() => expect(screen.getByText(/라벨 판독 실패: timeout/)).toBeTruthy());
  });
});
