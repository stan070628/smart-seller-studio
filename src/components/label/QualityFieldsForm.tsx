'use client';

import type { QualityFields } from '@/lib/label/label-templates';

interface Props {
  fields: QualityFields;
  onChange: (fields: QualityFields) => void;
}

const INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  border: '1px solid #d1d5db',
  borderRadius: 4,
  fontSize: 12,
  boxSizing: 'border-box',
};

const FIELD_CONFIGS: { key: keyof QualityFields; placeholder: string }[] = [
  { key: 'productName', placeholder: '품명 (예: 세차타월)' },
  { key: 'material', placeholder: '소재 (예: 극세사 80% / 폴리아미드 20%)' },
  { key: 'size', placeholder: '크기 (예: 40×40cm)' },
  { key: 'country', placeholder: '제조국 (예: 중국)' },
  { key: 'importer', placeholder: '수입원/판매원 (예: ㈜ 회사명)' },
  { key: 'address', placeholder: '주소' },
  { key: 'phone', placeholder: '전화번호' },
  { key: 'extra', placeholder: '기타 (KC인증번호 등, 선택)' },
];

export default function QualityFieldsForm({ fields, onChange }: Props) {
  const handleChange = (key: keyof QualityFields, value: string) => {
    onChange({ ...fields, [key]: value });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {FIELD_CONFIGS.map(({ key, placeholder }) => (
        <input
          key={key}
          style={INPUT_STYLE}
          placeholder={placeholder}
          value={fields[key]}
          onChange={(e) => handleChange(key, e.target.value)}
        />
      ))}
    </div>
  );
}
