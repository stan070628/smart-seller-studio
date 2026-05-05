import { Suspense } from 'react';
import EventCardEditor from '@/components/label/EventCardEditor';

export default function EventCardPage() {
  return (
    <Suspense>
      <EventCardEditor />
    </Suspense>
  );
}
