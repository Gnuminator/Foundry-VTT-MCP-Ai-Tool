// Tabs, Popover and Tooltip: what they render before anything opens. Rendered to a string; the
// opening itself (hover, focus, Escape) is in e2e/ui.spec.ts.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { IconButton } from './Button';
import { Popover } from './Popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './Tabs';
import { Tooltip, TooltipProvider } from './Tooltip';

describe('Tabs', () => {
  const html = renderToStaticMarkup(
    <Tabs defaultValue="b">
      <TabsList aria-label="Sections">
        <TabsTrigger value="a">Alpha</TabsTrigger>
        <TabsTrigger value="b">Beta</TabsTrigger>
      </TabsList>
      <TabsContent value="a">first panel</TabsContent>
      <TabsContent value="b">second panel</TabsContent>
    </Tabs>
  );

  it('renders a tablist with the chosen tab selected', () => {
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Sections"');
    expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>Beta</);
    expect(html).toMatch(/role="tab"[^>]*aria-selected="false"[^>]*>Alpha</);
  });

  it('puts only the selected panel in the page', () => {
    expect(html).toContain('second panel');
    expect(html).not.toContain('first panel');
  });
});

describe('Popover', () => {
  it('renders the trigger closed, naming a dialog it opens', () => {
    const html = renderToStaticMarkup(
      <Popover label="More about this" trigger={<button type="button">More</button>}>
        the body
      </Popover>
    );
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('>More</button>');
    expect(html).not.toContain('the body');
  });
});

describe('Tooltip', () => {
  it('leaves the button as it is without a provider', () => {
    const html = renderToStaticMarkup(
      <Tooltip content="Close">
        <button type="button">x</button>
      </Tooltip>
    );
    expect(html).toBe('<button type="button">x</button>');
  });

  it('marks the trigger closed under the provider, and renders no tip', () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <Tooltip content="Closes the drawer">
          <button type="button">x</button>
        </Tooltip>
      </TooltipProvider>
    );
    expect(html).toContain('data-state="closed"');
    expect(html).not.toContain('Closes the drawer');
  });

  it('keeps an icon button named by its label, with no native title', () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <IconButton label="Close help">✕</IconButton>
      </TooltipProvider>
    );
    expect(html).toContain('aria-label="Close help"');
    expect(html).not.toContain('title=');
  });
});
