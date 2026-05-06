export interface AuthBannerOptions {
  enabled: boolean;
}

/**
 * Initializes the auth banner element.
 * When enabled is false (default), the banner stays hidden.
 * When enabled is true, the banner becomes visible with a placeholder auth message.
 */
export function initAuthBanner(doc: Document, options: AuthBannerOptions): void {
  const banner = doc.getElementById('auth-banner');
  if (!banner) return;

  if (options.enabled) {
    banner.style.display = 'block';
    banner.textContent = 'Sign in to access your workspace';
  } else {
    banner.style.display = 'none';
  }
}
