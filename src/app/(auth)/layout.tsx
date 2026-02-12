import { AuthHeader } from '@/components/features/auth-header';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 relative">
      <AuthHeader />
      {children}
    </div>
  );
}
