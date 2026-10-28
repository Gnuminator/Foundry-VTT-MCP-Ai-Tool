import { Component, type ReactNode } from 'react';

// The ribbon is a lazy chunk and only decoration: if it fails to load (a stale tab after a
// redeploy, a flaky link) or to render, show nothing and keep the rows and the rest of the page.
export class RibbonBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
