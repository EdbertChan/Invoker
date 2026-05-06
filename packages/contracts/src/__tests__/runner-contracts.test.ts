import { describe, it, expect } from 'vitest';
import type {
  RunnerIdentity,
  RunnerCapabilities,
  RunnerRegistrationRequest,
  RunnerRegistrationResponse,
  RunnerHeartbeat,
  RunnerStatus,
  TaskClaimMetadata,
  RunnerEnvelopeMetadata,
} from '../index.js';

/**
 * Tests for dormant BYO runner protocol contracts.
 *
 * These tests verify:
 * 1. Interfaces are assignable (type-level contract validation)
 * 2. Optional fields default to undefined
 * 3. No coupling to existing scheduler or executor codepaths
 *
 * Feature state: dormant — no active codepath uses these types yet.
 */

describe('runner-contracts (dormant)', () => {
  describe('RunnerIdentity', () => {
    it('accepts minimal runner identity', () => {
      const identity: RunnerIdentity = { runnerId: 'runner-1' };
      expect(identity.runnerId).toBe('runner-1');
      expect(identity.label).toBeUndefined();
      expect(identity.tenantId).toBeUndefined();
    });

    it('accepts identity with all fields', () => {
      const identity: RunnerIdentity = {
        runnerId: 'runner-1',
        label: 'gpu-builder-us-east-1',
        tenantId: 'tenant-1',
      };
      expect(identity.runnerId).toBe('runner-1');
      expect(identity.label).toBe('gpu-builder-us-east-1');
      expect(identity.tenantId).toBe('tenant-1');
    });
  });

  describe('RunnerCapabilities', () => {
    it('accepts capabilities with required fields', () => {
      const caps: RunnerCapabilities = {
        executorTypes: ['docker'],
        maxConcurrency: 4,
      };
      expect(caps.executorTypes).toEqual(['docker']);
      expect(caps.maxConcurrency).toBe(4);
      expect(caps.labels).toBeUndefined();
    });

    it('accepts capabilities with affinity labels', () => {
      const caps: RunnerCapabilities = {
        executorTypes: ['docker', 'ssh'],
        maxConcurrency: 8,
        labels: { gpu: 'a100', region: 'us-east-1' },
      };
      expect(caps.labels).toEqual({ gpu: 'a100', region: 'us-east-1' });
    });
  });

  describe('RunnerRegistrationRequest', () => {
    it('accepts registration without pre-assigned runnerId', () => {
      const req: RunnerRegistrationRequest = {
        capabilities: { executorTypes: ['worktree'], maxConcurrency: 2 },
        protocolVersion: '1.0.0',
      };
      expect(req.runnerId).toBeUndefined();
      expect(req.protocolVersion).toBe('1.0.0');
    });

    it('accepts registration with pre-assigned runnerId', () => {
      const req: RunnerRegistrationRequest = {
        runnerId: 'runner-existing',
        label: 'my-runner',
        capabilities: { executorTypes: ['docker'], maxConcurrency: 1 },
        protocolVersion: '1.0.0',
      };
      expect(req.runnerId).toBe('runner-existing');
    });
  });

  describe('RunnerRegistrationResponse', () => {
    it('represents accepted registration', () => {
      const res: RunnerRegistrationResponse = {
        runnerId: 'runner-1',
        heartbeatIntervalMs: 30000,
        accepted: true,
      };
      expect(res.accepted).toBe(true);
      expect(res.rejectionReason).toBeUndefined();
    });

    it('represents rejected registration', () => {
      const res: RunnerRegistrationResponse = {
        runnerId: '',
        heartbeatIntervalMs: 0,
        accepted: false,
        rejectionReason: 'unsupported protocol version',
      };
      expect(res.accepted).toBe(false);
      expect(res.rejectionReason).toBe('unsupported protocol version');
    });
  });

  describe('RunnerHeartbeat', () => {
    it('represents a healthy heartbeat', () => {
      const hb: RunnerHeartbeat = {
        runnerId: 'runner-1',
        activeTaskCount: 3,
        status: 'healthy',
        timestamp: '2025-01-01T00:00:00.000Z',
      };
      expect(hb.status).toBe('healthy');
      expect(hb.activeTaskCount).toBe(3);
    });

    it('supports all runner statuses', () => {
      const statuses: RunnerStatus[] = ['healthy', 'draining', 'unhealthy'];
      statuses.forEach((status) => {
        const hb: RunnerHeartbeat = {
          runnerId: 'runner-1',
          activeTaskCount: 0,
          status,
          timestamp: new Date().toISOString(),
        };
        expect(hb.status).toBe(status);
      });
    });
  });

  describe('TaskClaimMetadata', () => {
    it('accepts minimal claim metadata', () => {
      const claim: TaskClaimMetadata = {
        runnerId: 'runner-1',
        claimedAt: '2025-01-01T00:00:00.000Z',
      };
      expect(claim.runnerId).toBe('runner-1');
      expect(claim.claimExpiresAt).toBeUndefined();
    });

    it('accepts claim with expiry', () => {
      const claim: TaskClaimMetadata = {
        runnerId: 'runner-1',
        claimedAt: '2025-01-01T00:00:00.000Z',
        claimExpiresAt: '2025-01-01T00:05:00.000Z',
      };
      expect(claim.claimExpiresAt).toBe('2025-01-01T00:05:00.000Z');
    });
  });

  describe('RunnerEnvelopeMetadata', () => {
    it('accepts empty metadata (no routing constraints)', () => {
      const meta: RunnerEnvelopeMetadata = {};
      expect(meta.runnerId).toBeUndefined();
      expect(meta.affinityLabels).toBeUndefined();
      expect(meta.requiredExecutorTypes).toBeUndefined();
    });

    it('accepts directed dispatch metadata', () => {
      const meta: RunnerEnvelopeMetadata = {
        runnerId: 'runner-1',
      };
      expect(meta.runnerId).toBe('runner-1');
    });

    it('accepts affinity-based routing metadata', () => {
      const meta: RunnerEnvelopeMetadata = {
        affinityLabels: { gpu: 'a100' },
        requiredExecutorTypes: ['docker'],
      };
      expect(meta.affinityLabels).toEqual({ gpu: 'a100' });
      expect(meta.requiredExecutorTypes).toEqual(['docker']);
    });
  });

  describe('no coupling to active codepaths', () => {
    it('runner-contracts exports are independent of worker protocol types', async () => {
      const runnerExports = await import('../runner-contracts.js');
      const typesExports = await import('../types.js');

      const runnerKeys = Object.keys(runnerExports);
      const typesKeys = Object.keys(typesExports);
      const overlap = runnerKeys.filter((k) => typesKeys.includes(k));
      expect(overlap).toHaveLength(0);
    });
  });
});
