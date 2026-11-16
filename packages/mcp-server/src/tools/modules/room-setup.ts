import { RoomSetupTools } from '../room-setup.js';
import { defineToolModule } from '../tool-module.js';

export const roomSetupModule = defineToolModule({
  id: 'room-setup',
  create: ({ services }) =>
    new RoomSetupTools({
      foundryClient: services.foundryClient,
      guardedWrites: services.guardedWrites,
      logger: services.logger,
    }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'plan-room-setup': (tools, args) => tools.handleToolCall('plan-room-setup', args),
  },
  tools: {
    'plan-room-setup': {
      set: 'build',
      title: 'Plan room setup (teleports, rooms, levels, stairs, hazards)',
      kind: 'read',
    },
  },
});
