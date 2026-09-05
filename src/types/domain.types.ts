import type { DomainStatus } from '@prisma/client';

export type { DomainStatus };

export type DnsRecordKind = 'A' | 'CNAME' | 'TXT';

/** One DNS record the user must publish, rendered verbatim in the dashboard. */
export interface DnsInstruction {
  kind: DnsRecordKind;
  /** The name to enter at the registrar, relative to the zone where possible. */
  name: string;
  value: string;
  note?: string;
}

/**
 * A custom domain as the API returns it and the settings panel renders it.
 *
 * Dates are ISO strings, not `Date`, because this crosses the wire — the client
 * component consumes exactly this shape.
 */
export interface DomainView {
  id: string;
  hostname: string;
  status: DomainStatus;
  isPrimary: boolean;
  redirectToPrimary: boolean;
  isApex: boolean;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
  dnsRecords: DnsInstruction[];
}
