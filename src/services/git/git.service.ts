/**
 * Git service: clone repos once, then pull on subsequent deploys.
 * Repos persist at PROJECTS_DIR/<slug>/ across deployments.
 */

import * as fs from 'fs';
import * as path from 'path';
import { simpleGit } from 'simple-git';
import { getConfig } from '@/lib/config';

export interface IGitService {
  /**
   * Returns the deterministic work directory for a project.
   */
  getWorkDir(projectSlug: string): string;

  /**
   * Clone (first time) or fetch+reset (subsequent) the repo at the given branch.
   * Returns the work directory path.
   */
  ensureRepo(repoUrl: string, projectSlug: string, branch: string): Promise<string>;
}

export class GitService implements IGitService {
  getWorkDir(projectSlug: string): string {
    return path.join(getConfig().PROJECTS_DIR, projectSlug);
  }

  async ensureRepo(
    repoUrl: string,
    projectSlug: string,
    branch: string,
  ): Promise<string> {
    const workDir = this.getWorkDir(projectSlug);
    await fs.promises.mkdir(getConfig().PROJECTS_DIR, { recursive: true });

    const gitDir = path.join(workDir, '.git');
    const exists = await fs.promises
      .stat(gitDir)
      .then(() => true)
      .catch(() => false);

    if (exists) {
      // Repo already cloned – fetch latest and hard-reset to the target branch
      console.log(`[git] Pulling latest for ${projectSlug} on branch ${branch}`);
      const git = simpleGit(workDir);

      // Ensure the fetch refspec covers all remote branches.
      // Shallow single-branch clones only track the originally-cloned branch,
      // so `origin/<other>` refs are missing. Fix the refspec before fetching.
      await git.raw([
        'config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*',
      ]);

      // Unshallow if needed, then fetch all branches
      const isShallow = await fs.promises
        .stat(path.join(gitDir, 'shallow'))
        .then(() => true)
        .catch(() => false);
      if (isShallow) {
        await git.fetch(['origin', '--unshallow', '--prune']);
      } else {
        await git.fetch(['origin', '--prune']);
      }

      // Switch to the target branch
      try {
        await git.checkout(branch);
      } catch {
        // Branch may not exist locally yet – create tracking branch
        await git.checkoutBranch(branch, `origin/${branch}`);
      }
      await git.reset(['--hard', `origin/${branch}`]);
    } else {
      // First deploy – full clone so branch switching works immediately
      console.log(`[git] Cloning ${repoUrl} (branch: ${branch}) into ${workDir}`);
      const git = simpleGit();
      await git.clone(repoUrl, workDir, ['-b', branch]);
    }

    return workDir;
  }
}

export const gitService = new GitService();
