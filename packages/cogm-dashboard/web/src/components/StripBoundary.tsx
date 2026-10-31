import { Component, type ReactNode } from 'react';

import { Button } from '../ui';

/**
 * The combat strip is a lazy chunk. If it fails to load (a stale tab after a redeploy, the Pi
 * restarting) or to render, say so with a way out and keep the rest of the page working.
 */
export class StripBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <p className="empty" role="status" id="combat-load-failed">
        The combat strip could not load.{' '}
        <Button data-track="dash.strip.reload" onClick={() => window.location.reload()}>
          Reload the page
        </Button>
      </p>
    );
  }
}
