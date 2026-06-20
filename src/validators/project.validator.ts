import { z } from 'zod';
import { parseSafeRepoUrl, hostMatchesSource } from '@/lib/git-url';

export const uploadProjectSchema = z.object({
  name: z.string().min(3).max(50).regex(/^[a-zA-Z0-9 _-]+$/, 'Only letters, numbers, spaces, hyphens, and underscores are allowed'),
});

// A git ref name we are willing to pass to `git clone -b` / `git checkout`.
// Disallows a leading "-" (option injection), whitespace, and ".." sequences.
const branchSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^(?!-)(?!.*\.\.)[^\s~^:?*\\[]+$/, 'Invalid branch name');

export const createProjectSchema = z
  .object({
    name: z.string().min(3).max(50),
    description: z.string().max(500).optional(),
    source: z.enum(['GITHUB', 'GITLAB']),
    githubUrl: z.string(),
    type: z.enum(['STATIC', 'NODEJS', 'NEXTJS', 'DJANGO', 'REACT', 'FASTAPI', 'FLASK', 'VUE', 'SVELTE', 'GO', 'RUST', 'JAVA']).optional(),
    branch: branchSchema.optional(),
    useStaticHosting: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    let host: string;
    try {
      host = parseSafeRepoUrl(data.githubUrl).host;
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['githubUrl'],
        message: err instanceof Error ? err.message : 'Invalid repository URL',
      });
      return;
    }
    if (!hostMatchesSource(host, data.source)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['githubUrl'],
        message: `Repository host (${host}) does not match the selected source (${data.source})`,
      });
    }
  });

export const updateProjectSchema = z.object({
  name: z.string().min(3).max(50).optional(),
  description: z.string().max(500).optional().nullable(),
  type: z.enum(['STATIC', 'NODEJS', 'NEXTJS', 'DJANGO', 'REACT', 'FASTAPI', 'FLASK', 'VUE', 'SVELTE', 'GO', 'RUST', 'JAVA']).optional(),
  branch: branchSchema.optional(),
  isPrivate: z.boolean().optional(),
  useStaticHosting: z.boolean().optional(),
});

export type CreateProjectDto = z.infer<typeof createProjectSchema>;
export type UpdateProjectDto = z.infer<typeof updateProjectSchema>;
