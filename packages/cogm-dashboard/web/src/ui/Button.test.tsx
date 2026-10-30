// The busy button: a label for what it is doing, locked but still focusable, and a slow-answer line.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Button } from './Button';

describe('Button busy', () => {
  it('shows the busy label, aria-busy and aria-disabled, and drops the click', () => {
    const html = renderToStaticMarkup(
      <Button busy busyLabel="Starting..." onClick={() => undefined}>
        Start session
      </Button>
    );
    expect(html).toContain('Starting...');
    expect(html).not.toContain('Start session');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain(' disabled');
  });

  it('shows its own label when not busy', () => {
    const html = renderToStaticMarkup(<Button busyLabel="Starting...">Start session</Button>);
    expect(html).toContain('Start session');
    expect(html).not.toContain('aria-busy');
  });
});
