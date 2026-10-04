// My character (I-096): the two paper views, black on white, in the same order and boxes as the
// official character sheets (2024, the default, and 2014), so a player copies them top to
// bottom onto paper. Our own markup; the official PDFs are not copied.

export function esc(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

export function signed(n) {
  return n === null || n === undefined ? '-' : n >= 0 ? `+${n}` : String(n);
}

function box(k, v) {
  return `<div class="box"><div class="k">${esc(k)}</div><div class="v">${esc(v ?? '-')}</div></div>`;
}

function table(head, body) {
  if (!body.length) return '<p>-</p>';
  return `<table><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body
    .map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
}

function para(title, text) {
  return text ? `<h2>${esc(title)}</h2><p>${esc(text)}</p>` : '';
}

function list(items) {
  return items.length ? items.join(', ') : '-';
}

const classText = s => s.classes.map(c => `${c.name} ${c.levels}`).join(', ') || `Level ${s.level}`;
const subclassText = s =>
  s.classes
    .map(c => c.subclass)
    .filter(Boolean)
    .join(', ') || '-';
const speedText = s =>
  Object.entries(s.speed)
    .map(([k, v]) => (k === 'walk' ? `${v} ${s.speedUnits || 'ft'}` : `${k} ${v}`))
    .join(', ') || '-';
const hpText = s => `${s.hp.value} / ${s.hp.max}${s.hp.temp ? ` (temp ${s.hp.temp})` : ''}`;
const deathText = s => `${s.deathSaves.success} successes, ${s.deathSaves.failure} failures`;
const coinsText = s =>
  ['cp', 'sp', 'ep', 'gp', 'pp'].map(k => `${k.toUpperCase()} ${s.currency[k] ?? 0}`).join(' · ');
const mark = on => (on ? '●' : '○');

function weaponsTable(s) {
  const rows = s.inventory
    .filter(i => i.attack || i.damage)
    .map(i => [i.name, i.attack || '-', i.damage || '-']);
  const cantrips = s.spells
    .filter(sp => sp.level === 0)
    .map(sp => [sp.name, 'spell', sp.range || '-']);
  return table(['Name', 'Attack / DC', 'Damage and type'], [...rows, ...cantrips]);
}

function featuresBy(s, kinds) {
  return s.features
    .filter(f => kinds.includes(f.kind))
    .map(f => `${f.name}${f.uses ? ` (${f.uses.value}/${f.uses.max})` : ''}`);
}

function spellTable(s, spells) {
  return table(
    ['Level', 'Name', 'Casting time', 'Range', 'C', 'R', 'Components'],
    spells.map(sp => [
      sp.level === 0 ? 'Cantrip' : String(sp.level),
      sp.name,
      sp.castingTime || '-',
      sp.range || '-',
      sp.concentration ? 'C' : '',
      sp.ritual ? 'R' : '',
      `${sp.components}${sp.material ? ` (${sp.material})` : ''}`,
    ])
  );
}

function spellcastingBoxes(s) {
  const sc = s.spellcasting;
  const abilityMod = s.abilities.find(a => a.label === sc.ability)?.mod ?? null;
  return `<div class="boxes">${box('Spellcasting ability', sc.ability)}${box('Spellcasting modifier', signed(abilityMod))}${box('Spell save DC', sc.dc)}${box('Spell attack bonus', signed(sc.attack))}</div>`;
}

function slotsText(s) {
  return s.slots.length
    ? s.slots
        .map(
          sl =>
            `${sl.pact ? 'Pact ' : ''}Level ${sl.level}: ${sl.max} total, ${sl.max - sl.value} expended`
        )
        .join('\n')
    : '-';
}

/** The 2024 sheet: page 1 the character, page 2 spells and the rest. */
export function renderPaper2024(s) {
  const prof = s.proficiencyBonus;
  const groups = s.abilities
    .map(a => {
      const skills = s.skills.filter(k => k.ability === a.key);
      return `<div class="ability-group"><div class="head"><span>${esc(a.label)} ${a.score}</span><span>${signed(a.mod)}</span></div>
        <div>${mark(a.saveProficient)} Saving throw ${signed(a.save)}</div>
        ${skills.map(k => `<div>${mark(k.proficiency >= 1)} ${esc(k.label)} ${signed(k.total)}${k.proficiency >= 2 ? ' (expertise)' : ''}</div>`).join('')}</div>`;
    })
    .join('');
  const prepared = s.spells.filter(sp => sp.prepared);
  const attuned = s.inventory.filter(i => i.attuned).map(i => i.name);
  return `<div class="paper-sheet">
  <section class="page">
    <div class="boxes">${box('Character name', s.name)}${box('Background', s.background)}${box('Class', classText(s))}${box('Subclass', subclassText(s))}${box('Species', s.species)}${box('Level', s.level)}${box('XP', s.xp)}</div>
    <div class="boxes" style="margin-top:.4rem">${box('Armor class', s.ac)}${box('Hit points', hpText(s))}${box('Hit dice', `${s.hitDice.value} / ${s.hitDice.max}`)}${box('Death saves', deathText(s))}</div>
    <div class="two">
      <div>
        <h2>Abilities, saving throws and skills</h2>
        ${box('Proficiency bonus', signed(prof))}
        <div style="margin-top:.4rem">${groups}</div>
        ${box('Heroic inspiration', s.inspiration ? 'Yes' : 'No')}
      </div>
      <div>
        <div class="boxes">${box('Initiative', signed(s.initiative))}${box('Speed', speedText(s))}${box('Size', s.size)}${box('Passive Perception', s.passivePerception)}</div>
        <h2>Weapons and damage cantrips</h2>${weaponsTable(s)}
        <h2>Class features</h2><p>${esc(list(featuresBy(s, ['class', 'subclass'])))}</p>
        <h2>Species traits</h2><p>${esc(list(featuresBy(s, ['race'])))}</p>
        <h2>Feats</h2><p>${esc(list(featuresBy(s, ['feat', 'background', 'other'])))}</p>
        <h2>Equipment training and proficiencies</h2>
        <p>Armor: ${esc(list(s.armorProficiencies))}\nWeapons: ${esc(list(s.weaponProficiencies))}\nTools: ${esc(list(s.toolProficiencies))}</p>
      </div>
    </div>
  </section>
  <section class="page">
    <h2>Spellcasting</h2>${spellcastingBoxes(s)}
    <h2>Spell slots</h2><p>${esc(slotsText(s))}</p>
    <h2>Cantrips and prepared spells</h2>${spellTable(s, prepared)}
    ${para('Appearance', s.personality.appearance)}
    ${para('Backstory and personality', [s.personality.traits, s.personality.ideals, s.personality.bonds, s.personality.flaws].filter(Boolean).join('\n'))}
    <div class="boxes" style="margin-top:.4rem">${box('Alignment', s.alignment)}${box('Languages', list(s.languages))}</div>
    <h2>Equipment</h2>${table(
      ['Item', 'Qty', ''],
      s.inventory.map(i => [i.name, String(i.quantity), i.equipped ? 'equipped' : ''])
    )}
    <h2>Magic item attunement</h2><p>${esc(list(attuned))}</p>
    <h2>Coins</h2><p>${esc(coinsText(s))}</p>
  </section>
</div>`;
}

/** The 2014 sheet: page 1 the character, page 2 spellcasting. Race shows the species. */
export function renderPaper2014(s) {
  const features = s.features.map(
    f => `${f.name}${f.uses ? ` (${f.uses.value}/${f.uses.max})` : ''}`
  );
  const byLevel = level => s.spells.filter(sp => sp.level === level);
  return `<div class="paper-sheet">
  <section class="page">
    <div class="boxes">${box('Character name', s.name)}${box('Class and level', classText(s))}${box('Background', s.background)}${box('Race', s.species)}${box('Alignment', s.alignment)}${box('Experience points', s.xp)}</div>
    <div class="two">
      <div>
        <h2>Ability scores</h2>
        <div class="boxes">${s.abilities.map(a => box(a.label, `${a.score} (${signed(a.mod)})`)).join('')}</div>
        <div class="boxes" style="margin-top:.4rem">${box('Inspiration', s.inspiration ? 'Yes' : 'No')}${box('Proficiency bonus', signed(s.proficiencyBonus))}</div>
        <h2>Saving throws</h2>
        ${table(
          ['', 'Ability', 'Bonus'],
          s.abilities.map(a => [mark(a.saveProficient), a.label, signed(a.save)])
        )}
        <h2>Skills</h2>
        ${table(
          ['', 'Skill', 'Bonus'],
          s.skills.map(k => [mark(k.proficiency >= 1), k.label, signed(k.total)])
        )}
        ${box('Passive wisdom (Perception)', s.passivePerception)}
      </div>
      <div>
        <div class="boxes">${box('Armor class', s.ac)}${box('Initiative', signed(s.initiative))}${box('Speed', speedText(s))}</div>
        <div class="boxes" style="margin-top:.4rem">${box('Hit points', hpText(s))}${box('Hit dice', `${s.hitDice.value} / ${s.hitDice.max}`)}${box('Death saves', deathText(s))}</div>
        <h2>Attacks and spellcasting</h2>${weaponsTable(s)}
        <h2>Equipment</h2>${table(
          ['Item', 'Qty'],
          s.inventory.map(i => [i.name, String(i.quantity)])
        )}
        <p>${esc(coinsText(s))}</p>
        <h2>Features and traits</h2><p>${esc(list(features))}</p>
        <h2>Other proficiencies and languages</h2>
        <p>Languages: ${esc(list(s.languages))}\nArmor: ${esc(list(s.armorProficiencies))}\nWeapons: ${esc(list(s.weaponProficiencies))}\nTools: ${esc(list(s.toolProficiencies))}</p>
        ${para('Personality traits', s.personality.traits)}${para('Ideals', s.personality.ideals)}${para('Bonds', s.personality.bonds)}${para('Flaws', s.personality.flaws)}
      </div>
    </div>
  </section>
  <section class="page">
    <h2>Spellcasting</h2>
    <div class="boxes">${box('Spellcasting class', classText(s))}${box('Spellcasting ability', s.spellcasting.ability)}${box('Spell save DC', s.spellcasting.dc)}${box('Spell attack bonus', signed(s.spellcasting.attack))}</div>
    <h2>Cantrips</h2>${spellTable(s, byLevel(0))}
    ${s.slots
      .map(
        sl =>
          `<h2>${sl.pact ? 'Pact magic, level' : 'Level'} ${sl.level}: ${sl.max} slots, ${sl.max - sl.value} expended</h2>${spellTable(s, byLevel(sl.level))}`
      )
      .join('')}
  </section>
</div>`;
}
