import { describe, it, expect } from 'vitest';
import { initAuthBanner } from '../auth-banner.js';

describe('initAuthBanner', () => {
  it('hides the banner when enabled is false (default/dormant)', () => {
    document.body.innerHTML = '<div id="auth-banner"></div>';
    initAuthBanner(document, { enabled: false });

    const banner = document.getElementById('auth-banner')!;
    expect(banner.style.display).toBe('none');
    expect(banner.textContent).toBe('');
  });

  it('shows the banner with auth message when enabled is true', () => {
    document.body.innerHTML = '<div id="auth-banner"></div>';
    initAuthBanner(document, { enabled: true });

    const banner = document.getElementById('auth-banner')!;
    expect(banner.style.display).toBe('block');
    expect(banner.textContent).toBe('Sign in to access your workspace');
  });

  it('is a no-op when the banner element is missing', () => {
    document.body.innerHTML = '<div id="other"></div>';
    // Should not throw
    initAuthBanner(document, { enabled: true });
    initAuthBanner(document, { enabled: false });
  });
});
