// Scene fixes for the sharper adventure maps (backlog map-upscale-pi, I-092): the scale fixes and the switch of the scene
// backgrounds to the 2x maps. A GM script: the body of an async function that gets `args` ({ dryRun, log }), run by
// gm-script.sh through stage 34 (scripts/pi/remote/34-map-upscale.sh) in the running world as the Assistant GM.
// It holds no scene names, paths or numbers of the book: stage 34 puts two things in front of it, both made on the PC by
// scripts/pi/map-upscale/prepare.mjs from files that stay on the PC:
//   const MAP_MODE = 'check' | 'scale' | 'scale-revert' | 'switch' | 'revert';
//   const DATA = { switch: { "<old src>": "<new src>" }, size: [{ name, from: [w, h], to: [w, h] }],
//                  grid: [{ name, from: {...}, to: {...} }] };
// Modes (a second run changes nothing; every mode logs counts, names and paths, never book text):
//   check    read-only: how many scenes are fixed, still as imported, or differ from both
//   scale    scene size and grid fixes. A scene is changed only when it still has the imported values ("from"); a scene
//            that already has the fixed values ("to") is left alone; any other value is reported and left alone
//   scale-revert  the same walk the other way: a scene with exactly the fixed values gets the imported values back
//   switch   points each scene level's background at the 2x file (only when it is still the original path and the 2x file
//            answers); the scene size, grid, walls, notes and tokens do not change
//   revert   points the backgrounds that use a 2x file back at the original path (the originals are never deleted)
// A dry run (args.dryRun) reports what a real run would change and writes nothing.
if (typeof MAP_MODE === 'undefined' || typeof DATA === 'undefined')
  throw new Error(
    'MAP_MODE and DATA are not set: run this through stage 34 (the data file comes from prepare.mjs)'
  );
if (!['check', 'scale', 'scale-revert', 'switch', 'revert'].includes(MAP_MODE))
  throw new Error(`unknown MAP_MODE ${MAP_MODE}`);
if (MAP_MODE === 'check' && !args.dryRun)
  throw new Error('check is read-only: it never runs for real');

const write = !args.dryRun && MAP_MODE !== 'check';
const lines = [];
const note = s => {
  lines.push(s);
  args.log(s);
};
const counts = {
  changed: 0,
  wouldChange: 0,
  already: 0,
  unexpected: 0,
  missing: 0,
  unreachable: 0,
  original: 0,
};
const sameNum = (a, b) => Math.abs(Number(a) - Number(b)) < 1e-9;
const matches = (cur, want) =>
  Object.entries(want).every(([k, v]) =>
    typeof v === 'number' ? sameNum(cur[k], v) : cur[k] === v
  );
const dump = o => JSON.stringify(o);

if (MAP_MODE === 'scale' || MAP_MODE === 'scale-revert' || MAP_MODE === 'check') {
  // scale-revert is the same walk the other way: "to" is what a scene must have now, "from" what it gets.
  const undo = MAP_MODE === 'scale-revert';
  const sides = p => (undo ? { from: p.to, to: p.from } : { from: p.from, to: p.to });
  for (const p0 of DATA.size ?? []) {
    const p = { name: p0.name, ...sides(p0) };
    const s = game.scenes.getName(p.name);
    if (!s) {
      counts.missing++;
      note(`MISSING scene ${p.name}`);
      continue;
    }
    const cur = { w: s.width, h: s.height };
    if (cur.w === p.to[0] && cur.h === p.to[1]) {
      counts.already++;
      note(`already ${undo ? 'as imported' : 'fixed'} ${p.name}: size ${cur.w}x${cur.h}`);
    } else if (cur.w === p.from[0] && cur.h === p.from[1]) {
      if (write) {
        await s.update({ width: p.to[0], height: p.to[1] });
        counts.changed++;
        note(`changed ${p.name}: size ${cur.w}x${cur.h} -> ${p.to[0]}x${p.to[1]}`);
      } else {
        counts.wouldChange++;
        note(`would change ${p.name}: size ${cur.w}x${cur.h} -> ${p.to[0]}x${p.to[1]}`);
      }
    } else {
      counts.unexpected++;
      note(
        `UNEXPECTED ${p.name}: size ${cur.w}x${cur.h} is neither ${p.from.join('x')} nor ${p.to.join('x')}, left alone`
      );
    }
  }
  for (const p0 of DATA.grid ?? []) {
    const p = { name: p0.name, ...sides(p0) };
    const s = game.scenes.getName(p.name);
    if (!s) {
      counts.missing++;
      note(`MISSING scene ${p.name}`);
      continue;
    }
    const cur = {
      type: s.grid.type,
      size: s.grid.size,
      distance: s.grid.distance,
      units: s.grid.units,
    };
    if (matches(cur, p.to)) {
      counts.already++;
      note(`already ${undo ? 'as imported' : 'fixed'} ${p.name}: grid ${dump(cur)}`);
    } else if (matches(cur, p.from)) {
      if (write) {
        await s.update({ grid: p.to });
        counts.changed++;
        note(`changed ${p.name}: grid ${dump(cur)} -> ${dump(p.to)}`);
      } else {
        counts.wouldChange++;
        note(`would change ${p.name}: grid ${dump(cur)} -> ${dump(p.to)}`);
      }
    } else {
      counts.unexpected++;
      note(
        `UNEXPECTED ${p.name}: grid ${dump(cur)} is neither ${dump(p.from)} nor ${dump(p.to)}, left alone`
      );
    }
  }
}

if (MAP_MODE === 'switch' || MAP_MODE === 'revert' || MAP_MODE === 'check') {
  const forward = DATA.switch ?? {};
  const back = Object.fromEntries(Object.entries(forward).map(([a, b]) => [b, a]));
  const seen = new Set();
  const reachable = new Map();
  const answers = async src => {
    if (!reachable.has(src)) {
      let ok = false;
      try {
        ok = (await fetch(src.split('/').map(encodeURIComponent).join('/'), { method: 'HEAD' })).ok;
      } catch {
        ok = false;
      }
      reachable.set(src, ok);
    }
    return reachable.get(src);
  };
  for (const scene of game.scenes) {
    for (const level of scene.levels ?? []) {
      const src = level.background?.src;
      if (!src) continue;
      const label = `${scene.name}${scene.levels.size > 1 ? ` / ${level.name}` : ''}`;
      if (src in forward) {
        seen.add(src);
        if (MAP_MODE === 'switch') {
          // A HEAD request is a read, so the dry run asks too and refuses what the real run would refuse.
          if (!(await answers(forward[src]))) {
            counts.unreachable++;
            note(`UNREACHABLE ${label}: ${forward[src]} does not answer, left on the original`);
          } else if (write) {
            await scene.updateEmbeddedDocuments('Level', [
              { _id: level.id, 'background.src': forward[src] },
            ]);
            counts.changed++;
            note(`switched ${label}: ${src} -> ${forward[src]}`);
          } else {
            counts.wouldChange++;
            note(`would switch ${label}: ${src} -> ${forward[src]}`);
          }
        } else if (MAP_MODE === 'check') {
          counts.original++;
          note(`original ${label}: ${src}`);
        }
      } else if (src in back) {
        seen.add(back[src]);
        if (MAP_MODE === 'revert') {
          if (write) {
            await scene.updateEmbeddedDocuments('Level', [
              { _id: level.id, 'background.src': back[src] },
            ]);
            counts.changed++;
            note(`reverted ${label}: ${src} -> ${back[src]}`);
          } else {
            counts.wouldChange++;
            note(`would revert ${label}: ${src} -> ${back[src]}`);
          }
        } else {
          counts.already++;
          note(`on the 2x map ${label}: ${src}`);
        }
      }
    }
  }
  const absent = Object.keys(forward).filter(s => !seen.has(s));
  for (const s of absent) {
    counts.missing++;
    note(`MISSING: no scene level uses ${s} or its 2x file`);
  }
}

const summary = `${MAP_MODE}${args.dryRun ? ' (dry run)' : ''}: ${dump(counts)}`;
note(summary);
// Anything unexpected, missing or unreachable fails the run, so a stage never reports success over a half-done job.
if (counts.unexpected || counts.missing || counts.unreachable)
  throw new Error(`not clean: ${summary}`);
return { mode: MAP_MODE, dryRun: !!args.dryRun, counts, lines };
