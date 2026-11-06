import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JSX } from 'react';
import { expect, within } from 'storybook/test';

import {
  BRIDGE_STATUS_KEY,
  RECORDING_HEALTH_KEY,
  STREAM_HEARD_KEY,
  STREAM_LINK_KEY,
  type RecordingHealth,
} from '../lib/stream';
import { BRIDGE_UP } from '../storybook/fixtures/combat';
import type { DashboardParameters } from '../storybook/withDashboard';

import { HealthLine } from './HealthLine';

// The GM health line with the Recorder and Play log dots (item health-line-dots). They show only
// when something is wrong, in plain words, and "unknown" (grey) when the bot or the bridge cannot
// be asked: never a green "OK". All well is the plain four-part line.
const meta = {
  title: 'Components/Health line',
  parameters: { layout: 'padded' },
  render: (): JSX.Element => <HealthLine />,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function seed(recording: RecordingHealth | null): { dashboard: DashboardParameters } {
  return {
    dashboard: {
      cache: [
        [BRIDGE_STATUS_KEY, BRIDGE_UP],
        [STREAM_LINK_KEY, { state: 'open', since: Date.now() - 600_000 }],
        [STREAM_HEARD_KEY, Date.now()],
        ...(recording ? [[RECORDING_HEALTH_KEY, recording] as const] : []),
      ],
    },
  };
}

export const AllWell: Story = {
  parameters: seed({ recorder: null, playLog: null }),
  play: async ({ canvasElement }) => {
    const line = within(canvasElement).getByLabelText('Connection health');
    await expect(line.querySelector('[data-part="recorder"]')).toBeNull();
    await expect(line.querySelector('[data-part="playlog"]')).toBeNull();
  },
};

export const RecorderSpeakerSilent: Story = {
  parameters: seed({
    recorder: {
      tone: 'warn',
      text: 'Mara has not been recorded for 7 min',
      detail: 'Mara has not been recorded for 7 min.',
    },
    playLog: null,
  }),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/Mara has not been recorded/)).toBeVisible();
  },
};

export const RecorderCannotRejoin: Story = {
  parameters: seed({
    recorder: {
      tone: 'bad',
      text: 'the bot cannot get back into the voice channel (attempt 4); nothing is recorded until it is back',
      detail:
        'the bot cannot get back into the voice channel (attempt 4); nothing is recorded until it is back.',
    },
    playLog: null,
  }),
};

export const RecorderUnknown: Story = {
  parameters: seed({
    recorder: {
      tone: 'unknown',
      text: 'unknown',
      detail:
        'The recording bot does not answer, so it cannot be seen whether a recording is healthy.',
    },
    playLog: null,
  }),
};

export const PlayLogNotRecording: Story = {
  parameters: seed({
    recorder: null,
    playLog: {
      tone: 'bad',
      text: 'not recording',
      detail: 'the play log has not been recording since 20:41.',
    },
  }),
};

export const PlayLogGaps: Story = {
  parameters: seed({
    recorder: null,
    playLog: {
      tone: 'warn',
      text: 'gaps',
      detail: 'the play log has a gap at 20:41, 3 lost. A gap marker is in the session log.',
    },
  }),
};

export const PlayLogUnknown: Story = {
  parameters: seed({
    recorder: null,
    playLog: {
      tone: 'unknown',
      text: 'unknown',
      detail: 'The play log cannot be checked right now (the bridge did not answer).',
    },
  }),
};

export const BothWrong: Story = {
  parameters: seed({
    recorder: {
      tone: 'warn',
      text: 'Mara has not been recorded for 7 min',
      detail: 'Mara has not been recorded for 7 min.',
    },
    playLog: {
      tone: 'bad',
      text: 'not recording',
      detail: 'the play log has not been recording since 20:41.',
    },
  }),
};
