import AppNav from '@/components/AppNav';

export default function OrdersLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <AppNav />
      <div style={{ flex: 1, overflow: 'auto' }}>{children}</div>
    </div>
  );
}
