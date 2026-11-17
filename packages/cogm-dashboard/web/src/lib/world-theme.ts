import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { api } from './api';
import { THEME_KEY, type WorldTheme } from './stream';
import { applyTheme } from './theme';

/** The world's theme (/api/theme); until it answers, the cached one from main.tsx shows. */
export function useWorldTheme(): void {
  const theme = useQuery({
    queryKey: THEME_KEY,
    queryFn: () => api<WorldTheme>('/api/theme'),
    retry: false,
  });
  useEffect(() => {
    if (theme.data) applyTheme(theme.data.theme);
  }, [theme.data]);
}
