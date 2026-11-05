import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * The last net under the whole page (item gm-health-line): a render error anywhere that has no
 * boundary of its own (GmPage, LiveStrip, the header) would blank the page and the GM would read a
 * white screen as a quiet table. This says what happened and offers a reload; the error goes to
 * the console for whoever looks.
 */
export class RootBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Dashboard page crashed', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main role="alert" id="page-crashed" style={{ padding: '2rem', maxWidth: '40rem' }}>
        <h1>This page stopped working</h1>
        <p>
          What was on screen may be out of date, and nothing here is live now. The game itself is
          not affected. Reload the page to get it back.
        </p>
        <button
          type="button"
          data-track="dash.crash.reload"
          onClick={() => window.location.reload()}
        >
          Reload the page
        </button>
      </main>
    );
  }
}
