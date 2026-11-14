/**
 * Round, ringed prototype tokens for every NPC actor of a world (I-093).
 *
 * Run it as a GM in the browser console (or a script macro) of the world to change:
 *
 *   const run = <paste this file>;   // it evaluates to an async function
 *   await run({ dryRun: true });     // lists what it would do
 *   await run({});                   // cuts round token art and turns the rings on
 *   await run({ revert: true });     // puts every changed actor back exactly as it was
 *
 * What it does per NPC actor (character actors, the party, are left alone: their art is a later step):
 *  - cuts the prototype token art into a round PNG and uploads it to `worlds/<world>/token-rings/`
 *    (the art stays in the world's own data folder, never in the repository);
 *  - turns on the dynamic token ring with one steel look and subject scale 0.8, so the round art sits
 *    inside the ring;
 *  - keeps the old texture and ring in the actor flag `foundry-mcp-bridge.tokenRingBackup`, so
 *    `revert` restores them;
 *  - sets the world setting "Dynamic Token Ring Fit Mode" to grid, which the ring look needs.
 *
 * Square portraits do not work with a ring on their own: Foundry does not clip the art, so the
 * corners poke out over the ring. Round art is what makes the ring look right.
 */
(async function () {
  const FLAG_SCOPE = 'foundry-mcp-bridge';
  const FLAG_KEY = 'tokenRingBackup';
  const RING = {
    enabled: true,
    colors: { ring: '#8a8d99', background: '#15151b' },
    effects: 1,
    subject: { scale: 0.8, texture: null },
  };
  const SKIP_SRC = /(^|\/)(mystery-man|npc)\.svg$/i;

  return async function run({ dryRun = false, revert = false, only = null } = {}) {
    if (!game.user.isGM) throw new Error('Run this as a GM.');
    const FP = foundry.applications.apps.FilePicker.implementation;
    const dir = `worlds/${game.world.id}/token-rings`;
    const actors = game.actors.filter(a => a.type === 'npc' && (!only || only.includes(a.name)));
    const report = { changed: [], skipped: [], reverted: [], failed: [] };

    if (revert) {
      for (const actor of actors) {
        const backup = actor.getFlag(FLAG_SCOPE, FLAG_KEY);
        if (!backup) continue;
        if (!dryRun) {
          await actor.update({
            'prototypeToken.texture.src': backup.src,
            'prototypeToken.ring': backup.ring,
          });
          await actor.unsetFlag(FLAG_SCOPE, FLAG_KEY);
        }
        report.reverted.push(actor.name);
      }
      return report;
    }

    if (!dryRun) {
      await game.settings.set('core', 'dynamicTokenRingFitMode', 'grid');
      try {
        await FP.createDirectory('data', dir);
      } catch (e) {
        /* already there */
      }
    }

    const slugs = new Set();
    for (const actor of actors) {
      const src = actor.prototypeToken.texture.src;
      if (!src || SKIP_SRC.test(src) || actor.getFlag(FLAG_SCOPE, FLAG_KEY)) {
        report.skipped.push(actor.name);
        continue;
      }
      try {
        if (dryRun) {
          report.changed.push(actor.name);
          continue;
        }
        let slug =
          actor.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '') || actor.id;
        if (slugs.has(slug)) slug = `${slug}-${actor.id}`;
        slugs.add(slug);
        const img = new Image();
        img.src = src.startsWith('http') || src.startsWith('/') ? src : `/${src}`;
        await img.decode();
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const canvasEl = document.createElement('canvas');
        canvasEl.width = canvasEl.height = 512;
        const ctx = canvasEl.getContext('2d');
        ctx.beginPath();
        ctx.arc(256, 256, 256, 0, Math.PI * 2);
        ctx.clip();
        // Portraits keep the face in the upper part: crop a square starting a little below the top.
        const sy = (img.naturalHeight - side) * 0.2;
        const sx = (img.naturalWidth - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, 512, 512);
        const blob = await new Promise(res => canvasEl.toBlob(res, 'image/png'));
        const up = await FP.upload(
          'data',
          dir,
          new File([blob], `${slug}.png`),
          {},
          { notify: false }
        );
        await actor.setFlag(FLAG_SCOPE, FLAG_KEY, {
          src,
          ring: foundry.utils.deepClone(actor._source.prototypeToken.ring),
        });
        await actor.update({ 'prototypeToken.texture.src': up.path, 'prototypeToken.ring': RING });
        report.changed.push(actor.name);
      } catch (error) {
        report.failed.push(`${actor.name}: ${error?.message ?? error}`);
      }
    }
    return report;
  };
})();
