import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';

export default function HomePage(): React.ReactElement {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 relative">
      <div className="absolute top-4 right-4">
        <ThemeToggle variant="ghost" size="icon" />
      </div>
      <h1 className="text-3xl font-bold mb-4">DropDeploy</h1>
      <p className="text-muted-foreground mb-8 text-center max-w-md">
        Deploy projects instantly by dragging a folder or pasting a GitHub URL.
      </p>
      <div className="flex gap-4">
        <Button variant="outline" asChild>
          <Link href="/login">Log in</Link>
        </Button>
        <Button asChild>
          <Link href="/register">Sign up</Link>
        </Button>
      </div>
    </main>
  );
}
