/**
 * audit/log.ts — records platform-admin actions to the AdminAuditLog table.
 *
 * Fire-and-forget: never throws, so a logging failure can't break the action
 * that triggered it. Call it right after a successful admin mutation.
 */

import { prisma } from '../../config/database';
import { logger } from '../../config/logger';

interface AuditInput {
  actorEmail: string;
  action: string;
  clinicId?: string | null;
  clinicName?: string | null;
  detail?: string | null;
  metadata?: Record<string, unknown>;
}

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.adminAuditLog.create({
      data: {
        actorEmail: input.actorEmail,
        action: input.action,
        clinicId: input.clinicId ?? null,
        clinicName: input.clinicName ?? null,
        detail: input.detail ?? null,
        metadata: (input.metadata ?? {}) as any,
      },
    });
  } catch (err) {
    logger.error('Failed to write audit log', { action: input.action, error: (err as Error).message });
  }
}
