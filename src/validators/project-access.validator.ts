import { z } from 'zod';

// Bare email domain, e.g. "entri.me". A leading "@" is stripped before validation.
const domainRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * Grant body: exactly one of `email` (a specific user) or `domain` (a whole
 * email domain). Domains are normalised to lowercase with any leading "@" removed.
 */
export const grantAccessSchema = z
  .object({
    email: z.string().email().optional(),
    domain: z
      .string()
      .transform((d) => d.trim().replace(/^@/, '').toLowerCase())
      .refine((d) => domainRegex.test(d), 'Must be a valid domain like "entri.me"')
      .optional(),
  })
  .refine(
    (data) => (data.email ? 1 : 0) + (data.domain ? 1 : 0) === 1,
    'Provide exactly one of email or domain',
  );

export type GrantAccessDto = z.infer<typeof grantAccessSchema>;
