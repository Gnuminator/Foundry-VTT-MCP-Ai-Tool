import { SkillGuideTools } from '../skill-guide.js';
import { defineToolModule } from '../tool-module.js';

export const skillGuideModule = defineToolModule({
  id: 'skill-guide',
  create: () => new SkillGuideTools(),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'get-skill-guide': (tools, args) => tools.handleGetSkillGuide(args),
  },
  tools: {
    'get-skill-guide': { set: 'core', title: 'Get a skill guide', kind: 'read' },
  },
});
