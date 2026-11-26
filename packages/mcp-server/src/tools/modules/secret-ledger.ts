import { SecretLedgerTools } from '../secret-ledger.js';
import { defineToolModule } from '../tool-module.js';

export const secretLedgerModule = defineToolModule({
  id: 'secret-ledger',
  create: ({ services }) => new SecretLedgerTools({ ledger: services.ledger }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'get-secret-ledger': (tools, args) => tools.handleGetSecretLedger(args),
  },
  tools: {
    'get-secret-ledger': { set: 'play', title: 'Get who knows what', kind: 'read' },
  },
});
