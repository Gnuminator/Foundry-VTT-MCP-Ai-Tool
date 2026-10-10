// How a story asks for its own theme or phone width.
//
// The story shots (web/visual/stories.spec.ts) read storybook-static/index.json, which lists each
// story's tags but not its parameters or globals, and Storybook builds that index by reading the
// story file, not by running it: a tag has to be written out in the story, a spread or a helper
// call is not seen. So a story that needs the Veil theme or a 390 px phone screen says so twice,
// side by side: the tag (what the shot test reads) and the global (what the toolbar and the
// preview use):
//
//   export const Veil: Story = { tags: ['veil'], globals: VEIL, args: { ... } };
//   export const OnAPhone: Story = { tags: ['phone'], globals: PHONE_VIEW, args: { ... } };
//   export const Both: Story = { tags: ['veil', 'phone'], globals: { ...VEIL, ...PHONE_VIEW } };
//
// The shot test checks the two agree (it opens the story, and fails when the tag says veil and the
// page is not in the Veil theme).

/** The Veil theme (the toolbar's Theme): pair it with `tags: ['veil']`. */
export const VEIL = { theme: 'veil' } as const;

/** A 390 px wide phone: pair it with `tags: ['phone']`. The size is listed in .storybook/preview.tsx. */
export const PHONE_VIEW = { viewport: { value: 'phone', isRotated: false } } as const;
