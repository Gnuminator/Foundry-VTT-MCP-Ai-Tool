import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

import { api, errorText } from '../lib/api';
import { THEME_KEY, type WorldTheme } from '../lib/stream';

import { useToast } from './Toasts';

const THEMES = [
  { id: 'neutral', name: 'Neutral' },
  { id: 'veil', name: 'The Veil' },
] as const;

/**
 * The theme picker in the header (the old page's #select-theme): the look for this world, which
 * the players' page follows. The choice is saved on the server (`set-theme`); the page changes
 * look when the new theme arrives (the answer here, the stream's `theme` event on every other
 * page; App's useWorldTheme applies it). A failed save toasts and the picker goes back to the
 * theme that is showing. The Mist choice (this screen only) is not here yet.
 */
export function ThemePicker(): JSX.Element {
  const toast = useToast();
  const queryClient = useQueryClient();
  const world = useQuery({
    queryKey: THEME_KEY,
    queryFn: () => api<WorldTheme>('/api/theme'),
    retry: false,
  }).data?.theme;
  // What the GM just picked, until the server answers: the picker shows it at once.
  const [choice, setChoice] = useState<string | null>(null);
  const shown = choice ?? (world === 'veil' ? 'veil' : 'neutral');

  const pick = (theme: string): void => {
    setChoice(theme);
    api<WorldTheme>('/api/control', {
      method: 'POST',
      body: JSON.stringify({ action: 'set-theme', value: theme }),
    })
      .then(
        data => queryClient.setQueryData<WorldTheme>(THEME_KEY, { theme: data.theme }),
        (err: unknown) => toast(`✗ Theme: ${errorText(err)}`, 'err')
      )
      .finally(() => setChoice(null));
  };

  return (
    <label className="control-label" title="The look for this world; the players' page follows it">
      Theme
      <select
        id="select-theme"
        className="select"
        data-track="dash.header.theme"
        value={shown}
        disabled={choice !== null}
        onChange={e => pick(e.target.value)}
      >
        {THEMES.map(t => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </label>
  );
}
