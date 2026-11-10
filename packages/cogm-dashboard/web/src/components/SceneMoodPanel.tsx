// The Scene mood action of the During view (item dashboard-mood-presets): one button per mood
// preset saved on the viewed scene (list-scene-moods). One click plans the preset with
// plan-scene-mood, asks once in the confirm window with the plan's own summary, then applies it
// with apply-planned-change; the toast has Undo and Recent Changes lists it. The same inline flow
// as the live strip's End combat. While GM Actions, Allow Write Operations or the module's
// "Scene mood and music" switch is off, the buttons stay, disabled, and say which one.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type JSX } from 'react';

import { api, callTool, errorText } from '../lib/api';
import { GAME_STATE_KEY, failCode, useGuardedTools } from '../lib/guarded';
import { useLivePlay } from '../lib/livePlay';
import { ROLL_NEEDS, offReason } from '../lib/liveSwitches';
import {
  currentText,
  moodOff,
  moodPlanArgs,
  moodQuestion,
  presetDetails,
  readMoods,
} from '../lib/sceneMood';
import { isSwitchOffRefusal, type FeatureList } from '../lib/switchOff';
import { usage } from '../lib/usage';
import { Button, QueryState } from '../ui';

import { focusedElement, useConfirm } from './ConfirmDialog';
import styles from './SceneMoodPanel.module.css';
import { useToast } from './Toasts';
import { TurnOnNote } from './TurnOnNote';

type SceneMoods = NonNullable<ReturnType<typeof readMoods>>;

/** Under the game state key: an applied mood or its Undo reads the scene's look again. */
export const SCENE_MOODS_KEY = [...GAME_STATE_KEY, 'scene-moods'] as const;
/** The module's feature switches (GET /api/features), read again after a switch-off refusal. */
export const MOOD_FEATURES_KEY = ['scene-mood-features'] as const;

/** Scene mood does not use live play: its "cannot read the switches" says no more than that. */
const MOOD_UNREADABLE = "Can't read the switches";

/** What plan-scene-mood answers; the fields used here. */
interface Planned {
  planId?: unknown;
  summary?: unknown;
  risk?: unknown;
}

/** The panel; mounted only while open (the During bar owns the button). */
export function SceneMoodPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const toast = useToast();
  const queryClient = useQueryClient();
  const askConfirm = useConfirm();
  const { gated, applyApproved } = useGuardedTools();
  const live = useLivePlay();
  // plan-scene-mood is a guarded write with no live-play part: GM Actions and writes, plus its
  // own module switch.
  const liveOff = live.off(ROLL_NEEDS);

  const moods = useQuery({
    queryKey: SCENE_MOODS_KEY,
    queryFn: async () => {
      const list = readMoods(await callTool('list-scene-moods', {}));
      if (!list) throw new Error('The bridge sent no moods.');
      return list;
    },
    staleTime: 0,
    // The viewed scene can change while the panel is open: read the list again when the GM comes
    // back to the window, and (below) before every plan.
    refetchOnWindowFocus: 'always',
    retry: false,
  });
  const features = useQuery({
    queryKey: MOOD_FEATURES_KEY,
    queryFn: () => api<FeatureList>('/api/features'),
    staleTime: 0,
    retry: false,
  });

  const off = moodOff(liveOff, features.data ?? null);
  const offTitle = off.names.length > 0 ? offReason(off.names, MOOD_UNREADABLE) : undefined;
  // The preset whose plan or apply runs: every button waits, the one clicked says so once applying.
  const [running, setRunning] = useState<{ preset: string; applying: boolean } | null>(null);
  const lock = useRef(false);
  // Set when the scene changed under the buttons: the list that must be on screen before the focus
  // moves to its first mood.
  const [refocusFor, setRefocusFor] = useState<SceneMoods | null>(null);

  const applyMood = async (preset: string): Promise<void> => {
    if (lock.current || off.names.length > 0) return;
    lock.current = true;
    const from = focusedElement();
    setRunning({ preset, applying: false });
    try {
      if (gated('plan-scene-mood')) return;
      // The list may belong to the scene the GM just left: read it again, and stop when the scene
      // changed or the preset is gone, so the confirm never names a scene the buttons did not.
      const shown = moods.data;
      const fresh = (await moods.refetch()).data;
      if (fresh && shown) {
        const sceneMoved = fresh.sceneId !== shown.sceneId || fresh.sceneName !== shown.sceneName;
        if (sceneMoved || !fresh.presets.some(p => p.name === preset)) {
          setRefocusFor(fresh);
          toast(
            sceneMoved
              ? `The scene changed to ${fresh.sceneName}. The moods are updated; pick again.`
              : `The mood "${preset}" is gone. The moods are updated; pick again.`,
            'warn'
          );
          return;
        }
      }
      let planned: Planned | null;
      try {
        planned = await callTool<Planned | null>('plan-scene-mood', moodPlanArgs(preset));
        usage().trackTool('plan-scene-mood', 'ok');
      } catch (err) {
        usage().trackTool('plan-scene-mood', 'error', failCode(err));
        const text = errorText(err);
        if (isSwitchOffRefusal(text)) {
          // Nothing was planned and nothing is wrong: a switch to turn on, said as a hint. The
          // switches are read again, so the buttons say it too.
          toast(text.replace(/^Error:\s*/, ''), 'warn');
          void queryClient.invalidateQueries({ queryKey: MOOD_FEATURES_KEY });
        } else {
          toast(`✗ Mood "${preset}": ${text}`, 'err', undefined, failCode(err));
        }
        return;
      }
      const planId = typeof planned?.planId === 'string' ? planned.planId : '';
      if (!planId) {
        toast(`✗ Mood "${preset}": the bridge made no plan`, 'err');
        return;
      }
      const destructive = planned?.risk === 'destructive';
      const ok = await askConfirm({
        title: 'Scene mood',
        summary: moodQuestion(
          typeof planned?.summary === 'string' ? planned.summary : null,
          preset
        ),
        diff: [],
        compact: true,
        confirmLabel: 'Apply mood',
        destructive,
        returnTo: from,
      });
      if (!ok) {
        // The plan stays on the bridge until it expires, as everywhere else.
        usage().trackTool('apply-planned-change', 'cancelled');
        return;
      }
      // Busy on the button only once the write runs, not while the GM answers the question.
      setRunning({ preset, applying: true });
      await applyApproved(planId, destructive, { label: `Mood "${preset}"` });
    } finally {
      lock.current = false;
      setRunning(null);
    }
  };

  const rootRef = useRef<HTMLDivElement>(null);
  const focusFirstPreset = (): void =>
    rootRef.current
      ?.querySelector<HTMLElement>('[data-preset]:not([aria-disabled="true"])')
      ?.focus();
  useEffect(focusFirstPreset, [moods.isSuccess]);
  // The pressed button may be gone after the scene-changed reload. Wait for a commit that shows the
  // new list with the buttons free (an effect runs after the DOM is updated, a frame callback can
  // run before), then focus its first mood.
  const seenMoods = useRef(moods.data);
  useEffect(() => {
    // The list changed again before it matched: the scene moved on, so this refocus is stale.
    if (seenMoods.current !== moods.data) {
      seenMoods.current = moods.data;
      if (refocusFor !== null && moods.data !== refocusFor) {
        setRefocusFor(null);
        return;
      }
    }
    if (refocusFor === null || running !== null || moods.data !== refocusFor) return;
    setRefocusFor(null);
    // Only when the focus fell to the page: a GM who moved on during the refetch keeps it.
    const active = document.activeElement;
    if (active === null || active === document.body || rootRef.current?.contains(active)) {
      focusFirstPreset();
    }
  }, [refocusFor, running, moods.data]);

  return (
    <div
      className={styles['panel']}
      id="scene-mood-panel"
      role="group"
      aria-label="Scene mood"
      ref={rootRef}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <p className="cs-hint">
        {moods.data
          ? `The moods saved on ${moods.data.sceneName}. A click asks once, then sets the look and the music; Undo is in Recent Changes.`
          : 'The moods saved on the viewed scene.'}
      </p>
      {liveOff.length > 0 && (
        <TurnOnNote
          live={live}
          off={liveOff}
          id="scene-mood-turn-on"
          unreadable={MOOD_UNREADABLE}
        />
      )}
      {off.note && (
        <p className={styles['off']} id="scene-mood-off" role="status">
          {off.note}
        </p>
      )}
      <QueryState
        query={moods}
        errorLabel="Couldn't load the moods"
        onRetry={() => void moods.refetch()}
        isEmpty={d => d.presets.length === 0}
        empty="No mood presets on this scene yet. Ask Claude to save the scene's look as a preset."
      >
        {d => (
          <ul className={styles['presets']} aria-label="Mood presets">
            {d.presets.map(p => {
              const disabled = offTitle !== undefined || running !== null;
              return (
                <li key={p.name}>
                  <Button
                    size="sm"
                    data-track="dash.mood.apply"
                    data-preset={p.name}
                    aria-disabled={disabled ? 'true' : undefined}
                    title={offTitle ?? presetDetails(p)}
                    busy={running?.applying === true && running.preset === p.name}
                    busyLabel="Applying..."
                    onClick={() => {
                      if (!disabled) void applyMood(p.name);
                    }}
                  >
                    {p.name}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </QueryState>
      <div className="ca-row">
        {moods.data?.current && (
          <span className={styles['now']}>{currentText(moods.data.current)}</span>
        )}
        <Button size="sm" data-track="dash.mood.close" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
