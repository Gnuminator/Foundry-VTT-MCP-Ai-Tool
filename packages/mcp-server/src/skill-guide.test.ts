import { SKILL_STUB_REVISION } from '@gnuminator/shared';
import { describe, expect, it } from 'vitest';
import { PLAYER_SKILL, serveSkillGuide } from './skill-guide.js';
import { SKILL_GUIDES } from './skill-guides.generated.js';
import { SkillGuideTools } from './tools/skill-guide.js';

const guides = {
  'gm-coach': {
    'SKILL.md': '---\nname: x\n---\n\n# Coach\nGM only text',
    'references/gm/dashboard.md': 'dashboard page',
  },
  'dnd-helper-player': {
    'SKILL.md': '# Player guide',
    'references/level-up.md': 'player level up',
  },
};

describe('serveSkillGuide', () => {
  it('serves the guide without front matter and lists the pages', () => {
    const a = serveSkillGuide({ skill: 'gm-coach' }, guides, '1.2.3');
    expect(a.isError).toBe(false);
    expect(a.text).toContain('GM only text');
    expect(a.text).not.toContain('name: x');
    expect(a.text).toContain('- references/gm/dashboard.md');
  });

  it('serves one page and refuses an unknown one without opening files', () => {
    expect(
      serveSkillGuide({ skill: 'gm-coach', page: 'references/gm/dashboard.md' }, guides).text
    ).toBe('dashboard page');
    const bad = serveSkillGuide({ skill: 'gm-coach', page: '../../.env' }, guides);
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain('No such page');
    expect(serveSkillGuide({ skill: 'gm-coach', page: 'constructor' }, guides).isError).toBe(true);
  });

  it('adds the outdated line only when the stub is behind', () => {
    expect(serveSkillGuide({ skill: 'gm-coach', stubRevision: 0 }, guides, '9.9.9').text).toContain(
      'Update available'
    );
    expect(
      serveSkillGuide({ skill: 'gm-coach', stubRevision: SKILL_STUB_REVISION }, guides).text
    ).not.toContain('Update available');
    expect(serveSkillGuide({ skill: 'gm-coach' }, guides).text).not.toContain('Update available');
  });

  it('errors for a skill the build did not embed', () => {
    expect(serveSkillGuide({ skill: 'dnd-helper' }, guides).isError).toBe(true);
  });
});

describe('the embedded guides', () => {
  it('hold all three skills', () => {
    for (const skill of ['gm-coach', 'dnd-helper', 'dnd-helper-player']) {
      expect(Object.keys(SKILL_GUIDES[skill] ?? {}).length).toBeGreaterThan(5);
    }
  });

  it('the player guide holds no GM page and no campaign term', () => {
    const files = SKILL_GUIDES[PLAYER_SKILL] ?? {};
    for (const [name, text] of Object.entries(files)) {
      expect(name).not.toMatch(/references\/(gm|foundry)\//);
      expect(text, name).not.toMatch(/Strahd|Barovia|Ravenloft|Tarokka|Ireena|Vallaki/i);
    }
  });

  it('the GM tool never serves the player edition and rejects unknown skills', async () => {
    const tools = new SkillGuideTools();
    await expect(tools.handleGetSkillGuide({ skill: 'dnd-helper-player' })).rejects.toThrow();
    await expect(tools.handleGetSkillGuide({ skill: 'nope' })).rejects.toThrow();
    await expect(tools.handleGetSkillGuide({ skill: 'gm-coach' })).resolves.toContain(
      'Pages you can open'
    );
  });
});
