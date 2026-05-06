import { describe, it, expect } from 'vitest';
import type {
  TenantIdentity,
  TenantContext,
  TenantScopedRequest,
} from '../tenant-context.js';
import { hasTenantContext } from '../tenant-context.js';

/**
 * Tests for dormant tenant context contracts.
 *
 * These tests verify:
 * 1. Interfaces are assignable (type-level contract validation)
 * 2. hasTenantContext guard correctly discriminates scoped requests
 * 3. TenantScopedRequest is backward-compatible (tenant is optional)
 * 4. No coupling to existing orchestrator or command-service codepaths
 *
 * Feature state: dormant — no active codepath uses these types yet.
 */

describe('tenant-context contracts (dormant)', () => {
  describe('TenantIdentity', () => {
    it('accepts minimal tenant identity', () => {
      const identity: TenantIdentity = { tenantId: 'tenant-1' };
      expect(identity.tenantId).toBe('tenant-1');
      expect(identity.workspaceId).toBeUndefined();
    });

    it('accepts identity with workspace', () => {
      const identity: TenantIdentity = {
        tenantId: 'tenant-1',
        workspaceId: 'ws-1',
      };
      expect(identity.tenantId).toBe('tenant-1');
      expect(identity.workspaceId).toBe('ws-1');
    });
  });

  describe('TenantContext', () => {
    it('extends TenantIdentity with optional slugs', () => {
      const ctx: TenantContext = {
        tenantId: 'tenant-1',
        workspaceId: 'ws-1',
        tenantSlug: 'acme-corp',
        workspaceSlug: 'production',
      };
      expect(ctx.tenantSlug).toBe('acme-corp');
      expect(ctx.workspaceSlug).toBe('production');
    });

    it('is assignable to TenantIdentity', () => {
      const ctx: TenantContext = { tenantId: 'tenant-1' };
      const identity: TenantIdentity = ctx;
      expect(identity.tenantId).toBe('tenant-1');
    });
  });

  describe('TenantScopedRequest', () => {
    it('wraps payload without tenant (single-tenant / desktop mode)', () => {
      const request: TenantScopedRequest<{ action: string }> = {
        payload: { action: 'createWorkflow' },
      };
      expect(request.tenant).toBeUndefined();
      expect(request.payload.action).toBe('createWorkflow');
    });

    it('wraps payload with tenant context (multi-tenant mode)', () => {
      const request: TenantScopedRequest<{ action: string }> = {
        tenant: { tenantId: 'tenant-1', workspaceId: 'ws-1' },
        payload: { action: 'createWorkflow' },
      };
      expect(request.tenant).toBeDefined();
      expect(request.tenant!.tenantId).toBe('tenant-1');
    });
  });

  describe('hasTenantContext guard', () => {
    it('returns false when tenant is undefined', () => {
      const request: TenantScopedRequest<string> = { payload: 'test' };
      expect(hasTenantContext(request)).toBe(false);
    });

    it('returns true when tenant is provided', () => {
      const request: TenantScopedRequest<string> = {
        tenant: { tenantId: 'tenant-1' },
        payload: 'test',
      };
      expect(hasTenantContext(request)).toBe(true);
    });

    it('narrows type so tenant is non-optional after guard', () => {
      const request: TenantScopedRequest<string> = {
        tenant: { tenantId: 'tenant-1', tenantSlug: 'acme' },
        payload: 'test',
      };

      if (hasTenantContext(request)) {
        // After guard, request.tenant is TenantContext (not undefined)
        expect(request.tenant.tenantId).toBe('tenant-1');
        expect(request.tenant.tenantSlug).toBe('acme');
      } else {
        throw new Error('Expected hasTenantContext to return true');
      }
    });
  });

  describe('backward compatibility', () => {
    it('existing non-tenant request shapes are unaffected', () => {
      // A request without tenant field compiles and works
      const request: TenantScopedRequest<{ workflowId: string }> = {
        payload: { workflowId: 'wf-1' },
      };
      expect(hasTenantContext(request)).toBe(false);
      expect(request.payload.workflowId).toBe('wf-1');
    });
  });

  describe('no coupling to active codepaths', () => {
    it('tenant-context exports are independent of orchestrator', async () => {
      const tenantExports = await import('../tenant-context.js');
      const orchestratorExports = await import('../orchestrator.js');

      const tenantKeys = Object.keys(tenantExports);
      const orchestratorKeys = Object.keys(orchestratorExports);
      const overlap = tenantKeys.filter(k => orchestratorKeys.includes(k));
      expect(overlap).toHaveLength(0);
    });
  });
});
