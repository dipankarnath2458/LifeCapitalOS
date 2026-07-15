import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  actorId?: string | null;
  actorRole?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  /**
   * Tenant scope. Populated into the indexed `AuditLog.firmId` column for tenant-scoped
   * audit queries. Falls back to `metadata.firmId` when not passed explicitly, so every
   * existing call site (which already carries `firmId` in metadata) is covered without
   * change.
   */
  firmId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string;
}

/** Reads a firmId from the entry or its metadata (write-through to the indexed column). */
function resolveFirmId(entry: AuditEntry): string | null {
  if (typeof entry.firmId === 'string') return entry.firmId;
  const fromMeta = entry.metadata?.firmId;
  return typeof fromMeta === 'string' ? fromMeta : null;
}

/** Writes to the append-only AuditLog. Never updates or deletes existing rows. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        actorRole: entry.actorRole ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        firmId: resolveFirmId(entry),
        metadata: entry.metadata as object | undefined,
        ip: entry.ip,
      },
    });
  }
}
