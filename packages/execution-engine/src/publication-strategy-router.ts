/**
 * Publication strategy router.
 *
 * Maps a workflow's `reviewStrategy` key (e.g. `'github_pr'`,
 * `'mergify_stack'`) to the concrete {@link MergeGateProvider} that
 * handles review creation and approval polling.
 *
 * The router consults a built-in mapping of strategy keys to provider
 * names and then resolves the provider name via the
 * {@link ReviewProviderRegistry}.
 *
 * If the strategy is unrecognised or no matching provider is registered
 * the router throws, forcing callers to fail fast rather than silently
 * fall through to a wrong provider.
 */

import type { MergeGateProvider } from './merge-gate-provider.js';
import type { ReviewProviderRegistry } from './review-provider-registry.js';

// ── Strategy → provider-name mapping ─────────────────────

/** Known publication strategies and the provider name each maps to. */
const STRATEGY_TO_PROVIDER: Record<string, string> = {
  github_pr: 'github',
  mergify_stack: 'mergify_stack',
};

// ── Public API ───────────────────────────────────────────

export type PublicationStrategyKey = 'github_pr' | 'mergify_stack';

/**
 * Resolve the {@link MergeGateProvider} for the given publication strategy.
 *
 * @param strategy    The workflow-level strategy key (defaults to `'github_pr'`).
 * @param registry    Provider registry to look up the concrete implementation.
 * @returns           The resolved provider.
 * @throws            When no provider can be resolved for the strategy.
 */
export function resolvePublicationProvider(
  strategy: string | undefined,
  registry: ReviewProviderRegistry,
): MergeGateProvider {
  const effectiveStrategy = strategy ?? 'github_pr';
  const providerName = STRATEGY_TO_PROVIDER[effectiveStrategy];

  if (!providerName) {
    throw new Error(
      `Unknown publication strategy "${effectiveStrategy}". ` +
      `Supported strategies: ${Object.keys(STRATEGY_TO_PROVIDER).join(', ')}.`,
    );
  }

  const provider = registry.get(providerName);
  if (provider) return provider;

  throw new Error(
    `No provider registered for publication strategy "${effectiveStrategy}" ` +
    `(provider name "${providerName}"). ` +
    `Register a provider with name "${providerName}" in the ReviewProviderRegistry.`,
  );
}
