'use client';
import { useState } from 'react';

export interface DeliveryValue {
  deliveryMethod: 'SEQUENCIAL' | 'VENDOR_DIRECT';
  deliveryChargeType: 'FREE' | 'NOT_FREE';
  deliveryCharge: number;
  outboundShippingPlaceCode: string;
  returnCenterCode: string;
}

interface Props {
  initialValue: DeliveryValue;
  onNext: (value: DeliveryValue) => void;
  onBack: () => void;
}

export function Step5Delivery({ initialValue, onNext, onBack }: Props) {
  const [value, setValue] = useState<DeliveryValue>(initialValue);

  return (
    <div className="flex flex-col gap-5">
      <h3 className="font-semibold text-gray-900">배송 · 반품 정보 확인</h3>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">배송 방법</label>
          <select
            value={value.deliveryMethod}
            onChange={(e) =>
              setValue({ ...value, deliveryMethod: e.target.value as DeliveryValue['deliveryMethod'] })
            }
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          >
            <option value="SEQUENCIAL">순차배송</option>
            <option value="VENDOR_DIRECT">직배송</option>
          </select>
        </div>

        <div className="flex gap-4">
          <div className="flex flex-col gap-1 flex-1">
            <label className="text-sm font-medium text-gray-700">배송비 유형</label>
            <select
              value={value.deliveryChargeType}
              onChange={(e) =>
                setValue({ ...value, deliveryChargeType: e.target.value as 'FREE' | 'NOT_FREE' })
              }
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="FREE">무료</option>
              <option value="NOT_FREE">유료</option>
            </select>
          </div>
          {value.deliveryChargeType === 'NOT_FREE' && (
            <div className="flex flex-col gap-1 flex-1">
              <label className="text-sm font-medium text-gray-700">배송비 (원)</label>
              <input
                type="number"
                value={value.deliveryCharge}
                onChange={(e) => setValue({ ...value, deliveryCharge: Number(e.target.value) })}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">출하지 코드</label>
          <input
            value={value.outboundShippingPlaceCode}
            onChange={(e) => setValue({ ...value, outboundShippingPlaceCode: e.target.value })}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">반품센터 코드</label>
          <input
            value={value.returnCenterCode}
            onChange={(e) => setValue({ ...value, returnCenterCode: e.target.value })}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="flex gap-3 justify-end mt-2">
        <button
          onClick={onBack}
          className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
        >
          이전
        </button>
        <button
          onClick={() => onNext(value)}
          disabled={!value.outboundShippingPlaceCode || !value.returnCenterCode}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          다음
        </button>
      </div>
    </div>
  );
}
