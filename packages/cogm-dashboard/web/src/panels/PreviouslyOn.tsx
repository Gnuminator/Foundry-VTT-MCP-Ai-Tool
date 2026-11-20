// "Previously on" card (item previously-on): posts last night's approved recap to chat in Danish
// or English and plays the spoken version in this browser. Off by default: the route answers
// `enabled: false` and the card does not show. GM only.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

import { useToast } from '../components/Toasts';
import { api, errorText } from '../lib/api';
import { authHeaders } from '../lib/auth';
import { GAME_STATE_KEY } from '../lib/guarded';
import { Button } from '../ui';

const KEY = [...GAME_STATE_KEY, 'previously-on'] as const;

type Lang = 'da' | 'en';
const LANG_WORDS: Record<Lang, string> = { da: 'Dansk', en: 'English' };

interface PreviouslyOnState {
  enabled: boolean;
  session: string | null;
  languages: Lang[];
  audio: Partial<Record<Lang, boolean>>;
  rendering: string[];
  failed: string[];
}

export default function PreviouslyOnCard({ active }: { active: boolean }): JSX.Element | null {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const query = useQuery({
    queryKey: KEY,
    queryFn: async () => {
      try {
        return await api<PreviouslyOnState>('/api/previously-on');
      } catch {
        return null;
      }
    },
    enabled: active,
    // While a voice is being made, look again until it is there.
    refetchInterval: q => ((q.state.data?.rendering.length ?? 0) > 0 ? 5000 : false),
  });
  const state = query.data;
  if (!state?.enabled || !state.session) return null;

  const post = async (lang: Lang): Promise<void> => {
    setBusy(true);
    try {
      await api('/api/previously-on', { method: 'POST', body: JSON.stringify({ lang }) });
      toast(`✓ The recap is in chat (${LANG_WORDS[lang]}).`);
    } catch (err) {
      toast(`✗ ${errorText(err)}`, 'err');
    } finally {
      setBusy(false);
    }
  };
  const voice = async (lang: Lang): Promise<void> => {
    setBusy(true);
    try {
      await api('/api/previously-on/audio', { method: 'POST', body: JSON.stringify({ lang }) });
      toast('Making the voice. It takes about a minute; Play shows up when it is ready.');
      void queryClient.invalidateQueries({ queryKey: KEY });
    } catch (err) {
      toast(`✗ ${errorText(err)}`, 'err');
    } finally {
      setBusy(false);
    }
  };
  const play = async (lang: Lang): Promise<void> => {
    try {
      const res = await fetch(`/api/previously-on/audio/${lang}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const audio = new Audio(url);
      audio.addEventListener('ended', () => URL.revokeObjectURL(url));
      await audio.play();
    } catch (err) {
      toast(`✗ Could not play it: ${errorText(err)}`, 'err');
    }
  };

  return (
    <section className="notes-card" id="previously-on-card" aria-label="Previously on">
      <div className="notes-card-head">
        <h3>Previously on</h3>
      </div>
      <p className="notes-line">
        {`Last night's approved recap (${state.session}). Post the text to chat, or play it spoken here on this PC.`}
      </p>
      <p className="notes-line" aria-live="polite">
        {state.rendering.length > 0 ? 'Making the voice...' : ''}
        {state.failed.length > 0 && state.rendering.length === 0
          ? `The ${
              [
                ...new Set(
                  state.failed
                    .map(key => LANG_WORDS[key.slice(key.lastIndexOf(':') + 1) as Lang] ?? '')
                    .filter(Boolean)
                ),
              ].join(' and ') || 'spoken'
            } voice could not be made. Check that the narration tool is set up on this PC, then try again.`
          : ''}
      </p>
      {state.languages.map(lang => (
        <div className="ready-actions" key={lang}>
          <Button
            data-track={`dash.previously-on.chat.${lang}`}
            disabled={busy}
            onClick={() => void post(lang)}
          >
            {`${LANG_WORDS[lang]}: to chat`}
          </Button>
          {state.audio[lang] ? (
            <Button
              variant="quiet"
              data-track={`dash.previously-on.play.${lang}`}
              onClick={() => void play(lang)}
            >
              {`${LANG_WORDS[lang]}: play`}
            </Button>
          ) : (
            <Button
              variant="quiet"
              data-track={`dash.previously-on.voice.${lang}`}
              disabled={busy || state.rendering.some(k => k.endsWith(`:${lang}`))}
              onClick={() => void voice(lang)}
            >
              {state.rendering.some(k => k.endsWith(`:${lang}`))
                ? `${LANG_WORDS[lang]}: making the voice...`
                : `${LANG_WORDS[lang]}: make the voice`}
            </Button>
          )}
        </div>
      ))}
    </section>
  );
}
