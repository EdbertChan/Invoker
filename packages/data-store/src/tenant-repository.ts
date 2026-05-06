/**
 * TenantRepository — Dormant tenant/workspace persistence contracts.
 *
 * These interfaces define extension points for future SaaS DB adapters.
 * They are NOT wired into any active codepath. The current SQLite
 * owner-boundary behavior is unchanged.
 *
 * Feature state: dormant
 * Activation: requires explicit adapter implementation (e.g. Postgres,
 * DynamoDB) and opt-in wiring by a future integration layer.
 */

// ── Tenant Types ────────────────────────────────────────────

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended' | 'provisioning';
  plan?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Workspace {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  status: 'active' | 'archived';
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// ── Query Types ─────────────────────────────────────────────

export interface TenantQuery {
  status?: Tenant['status'];
  limit?: number;
  offset?: number;
}

export interface WorkspaceQuery {
  tenantId: string;
  status?: Workspace['status'];
  limit?: number;
  offset?: number;
}

// ── Repository Interfaces ───────────────────────────────────

/**
 * TenantRepository — CRUD + query contract for tenant records.
 *
 * Implementors provide the storage backend (Postgres, DynamoDB, etc.).
 * The interface enforces tenant-level isolation: all workspace operations
 * require a tenantId scope.
 */
export interface TenantRepository {
  createTenant(tenant: Omit<Tenant, 'createdAt' | 'updatedAt'>): Tenant;
  getTenant(tenantId: string): Tenant | undefined;
  updateTenant(tenantId: string, changes: Partial<Pick<Tenant, 'name' | 'slug' | 'status' | 'plan' | 'metadata'>>): Tenant | undefined;
  deleteTenant(tenantId: string): boolean;
  listTenants(query?: TenantQuery): Tenant[];
}

/**
 * WorkspaceRepository — CRUD + query contract for workspace records.
 *
 * All operations are scoped to a tenant. Implementors enforce that
 * workspace access respects tenant boundaries (no cross-tenant reads).
 */
export interface WorkspaceRepository {
  createWorkspace(workspace: Omit<Workspace, 'createdAt' | 'updatedAt'>): Workspace;
  getWorkspace(tenantId: string, workspaceId: string): Workspace | undefined;
  updateWorkspace(tenantId: string, workspaceId: string, changes: Partial<Pick<Workspace, 'name' | 'slug' | 'status' | 'metadata'>>): Workspace | undefined;
  deleteWorkspace(tenantId: string, workspaceId: string): boolean;
  listWorkspaces(query: WorkspaceQuery): Workspace[];
}

/**
 * TenantPersistenceAdapter — Composite adapter combining tenant and
 * workspace repositories. Future SaaS adapters implement this interface.
 */
export interface TenantPersistenceAdapter extends TenantRepository, WorkspaceRepository {
  close(): void;
}
