'use client';

import { useEffect, useState } from 'react';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CreateProjectForm } from '@/components/features/create-project-form';
import { ProjectList } from '@/components/features/project-list';
import { Plus, X } from 'lucide-react';

export default function DashboardPage(): React.ReactElement {
  const [listRefresh, setListRefresh] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem('welcome-dismissed');
    if (!dismissed) {
      setShowWelcome(true);
    }
  }, []);

  const handleCreateSuccess = (): void => {
    setListRefresh((n) => n + 1);
    setCreateOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold">Dashboard</h2>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create project
          </Button>
          <DialogContent showClose={true}>
            <DialogHeader>
              <DialogTitle>Create project</DialogTitle>
              <DialogDescription>
                Add a new project. Choose a name, framework, and paste your GitHub repository URL.
              </DialogDescription>
            </DialogHeader>
            <CreateProjectForm embedded onSuccess={handleCreateSuccess} />
          </DialogContent>
        </Dialog>
      </div>

      {showWelcome && (
        <Card className="relative">
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-2 top-2 h-6 w-6"
            onClick={() => {
              setShowWelcome(false);
              localStorage.setItem('welcome-dismissed', 'true');
            }}
          >
            <X className="h-4 w-4" />
          </Button>
          <CardHeader>
            <CardTitle>Welcome</CardTitle>
            <CardDescription>
              Create a project with a name, framework, and description. Paste a GitHub repo URL and deploy to get a live link.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <ProjectList onRefresh={listRefresh} />
    </div>
  );
}
