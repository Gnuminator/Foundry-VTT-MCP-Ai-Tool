// GET /api/tools: a small catalog (reads, writes, a destructive one) and the picker answers.
export const TOOLS = [
  {
    name: 'apply-planned-change',
    description: 'Apply a plan.',
    inputSchema: {
      type: 'object',
      properties: {
        planId: { type: 'string', 'x-foundry-ref': { kind: 'plan', value: 'id' } },
        confirm: { type: 'boolean' },
        confirmDestructive: { type: 'boolean' },
      },
      required: ['planId', 'confirm'],
    },
    mutates: 'write',
  },
  {
    name: 'create-quest-journal',
    description: 'Make a quest journal.',
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string', description: 'The quest title.' } },
      required: ['title'],
    },
    mutates: 'write',
  },
  {
    name: 'get-world-info',
    description: 'The world, its system and its modules.',
    inputSchema: { type: 'object', properties: {} },
    mutates: 'read',
  },
  {
    name: 'plan-actor-change',
    description: 'Plan damage, healing or a condition for tokens.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['damage', 'heal'] },
        targets: {
          type: 'array',
          items: { type: 'string' },
          'x-foundry-ref': { kind: 'token', value: 'name' },
        },
        amount: { type: 'number', description: 'Hit points.' },
      },
      required: ['action', 'targets'],
    },
    mutates: 'read',
  },
  {
    name: 'undo-change',
    description: 'Undo a recorded change.',
    inputSchema: {
      type: 'object',
      properties: { changeId: { type: 'string' }, confirm: { type: 'boolean' } },
      required: ['changeId', 'confirm'],
    },
    mutates: 'destructive',
  },
];

export const TOOLS_REPLY = { tools: TOOLS, gmActionsEnabled: true };

/** list-ref-choices for a picker: a few tokens on the harbor scene. */
export const TOKEN_CHOICES = {
  kind: 'token',
  choices: [
    { id: 't1', name: 'Aldric', detail: 'Harbor Market', group: 'Harbor Market' },
    { id: 't2', name: 'Brenna', detail: 'Harbor Market', group: 'Harbor Market' },
    { id: 't9', name: 'Old Gull', detail: 'hidden', group: 'Harbor Market' },
  ],
  truncated: false,
};
