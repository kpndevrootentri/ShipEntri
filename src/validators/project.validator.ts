import { z } from 'zod';

export const createProjectSchema = z.object({
  name: z.string().min(3).max(50),
  description: z.string().max(500).optional(),
  source: z.literal('GITHUB'),
  githubUrl: z.string().url(),
  type: z.enum(['STATIC', 'NODEJS', 'NEXTJS', 'DJANGO']).optional(),
  branch: z.string().max(100).optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().min(3).max(50).optional(),
  description: z.string().max(500).optional().nullable(),
  type: z.enum(['STATIC', 'NODEJS', 'NEXTJS', 'DJANGO']).optional(),
  branch: z.string().max(100).optional(),
});

export type CreateProjectDto = z.infer<typeof createProjectSchema>;
export type UpdateProjectDto = z.infer<typeof updateProjectSchema>;
