import type { Meta, StoryObj } from '@storybook/react-vite';
import { useRef, useState, type JSX } from 'react';

import { bridgeDown, pending, toolOk } from '../storybook/fakeApi';
import { TOKEN_CHOICES } from '../storybook/fixtures/tools';
import { PHONE_VIEW, VEIL } from '../storybook/modes';

import { RefPicker } from './RefPicker';

// The "Pick…" button beside a Tool runner field that names something: a list of what exists now
// (list-ref-choices, answered by the fake bridge) with a filter box.
function Picker({
  multiple = false,
  initial = '',
  startOpen = true,
}: {
  multiple?: boolean;
  initial?: string;
  startOpen?: boolean;
}): JSX.Element {
  const [value, setValue] = useState(initial);
  const [open, setOpen] = useState(startOpen);
  const names = useRef(new Map<string, string>());
  return (
    <div className="field" style={{ maxWidth: 460 }}>
      <label htmlFor="story-field">Targets</label>
      <RefPicker
        fieldId="story-field"
        refSpec={{ kind: 'token', value: 'name' }}
        multiple={multiple}
        value={value}
        onChange={setValue}
        parentValue=""
        open={open}
        onOpenChange={setOpen}
        names={names.current}
      >
        <input
          id="story-field"
          className="field-control"
          value={value}
          onChange={e => setValue(e.target.value)}
        />
      </RefPicker>
    </div>
  );
}

const choices = { tools: { 'list-ref-choices': toolOk(TOKEN_CHOICES) } };

const meta = {
  title: 'Components/RefPicker',
  parameters: { dashboard: { api: choices } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = { render: () => <Picker startOpen={false} initial="Aldric" /> };
export const OpenSingle: Story = { render: () => <Picker /> };
export const OpenMultiple: Story = { render: () => <Picker multiple initial={'Aldric\nBrenna'} /> };
export const Loading: Story = {
  parameters: { dashboard: { api: { tools: { 'list-ref-choices': pending } } } },
  render: () => <Picker />,
};
export const NothingToPick: Story = {
  parameters: {
    dashboard: {
      api: {
        tools: { 'list-ref-choices': toolOk({ kind: 'token', choices: [], truncated: false }) },
      },
    },
  },
  render: () => <Picker />,
};
export const BridgeDown: Story = {
  parameters: { dashboard: { api: { tools: { 'list-ref-choices': bridgeDown } } } },
  render: () => <Picker />,
};
export const VeilTheme: Story = {
  tags: ['veil'],
  globals: VEIL,
  render: () => <Picker multiple />,
};
export const Phone: Story = {
  tags: ['phone'],
  globals: PHONE_VIEW,
  render: () => <Picker multiple />,
};
