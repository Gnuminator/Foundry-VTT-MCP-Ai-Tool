---
title: Failure classes and known findings
description: How a failure is classified and the findings the kit has already turned up.
---

# Failure classes and known findings

Part of [TEST-KIT](../TEST-KIT.md).

## Failure classes

Every failed check says which kind it is, first in the message, with its evidence:

| Class     | Meaning                                                      | Example                                                  |
| --------- | ------------------------------------------------------------ | -------------------------------------------------------- |
| `KIT`     | Our builder or our check is wrong.                           | a choice was not made, the hit point sum is off          |
| `CONTENT` | The imported data is wrong or incomplete.                    | a grant whose uuid does not resolve                      |
| `SYSTEM`  | The dnd5e system did something other than its own data says. | a grant not applied, a slot table that differs           |
| `STUDIO`  | Actor Studio did something the plain system route does not.  | a Subclass advancement left unset (`heroes-studio` only) |

Fix `KIT` failures in the kit. Report `CONTENT` and `SYSTEM` failures: do not change the imported
content or the product to make the kit green. Report `STUDIO` failures to the module's author: do not
change Actor Studio to make the kit green.

### Known findings

A `CONTENT` or `SYSTEM` failure that is understood and reported goes on the profile's known list, so
the next run counts it instead of failing on it, and a new failure stands out. `heroes-advancement`,
`heroes-features-use`, `heroes-multiclass`, the origins scenarios, `monsters-matrix`, `monsters-every`,
`monsters-odd` and `spells-cast-all` read the list (`lib/known.mjs`; the origins ones after their own `data/origins-expected.json`);
`heroes-studio` keeps its own (`data/studio-expected.json`). In `monsters-odd` a monster whose
problems are all known is counted in the check's `known` number and does not fail the check; in
`spells-cast-all` a spell whose problems are all known does the same for its level.

| Profile    | Known list                                                    |
| ---------- | ------------------------------------------------------------- |
| `srd`      | `scripts/test-kit/data/profiles/srd.known.json` (in the repo) |
| a local id | `<kit home>\licensed\profiles\<id>.known.json` (this PC only) |

The licensed list names licensed features, so it stays on this PC like its profile. A missing file is
an empty list. A profile that includes the system's own packs also has the system's findings, so its
file names the profiles whose lists count too: `"knownAlso": ["srd"]` in the licensed profile. The
profile's own entries are checked first, then the inherited ones (one level); an id in two lists is
an error. A monster finding ends with the monster's pack (`...; in aitool-content.monsters`) and a
spell finding with the spell's pack, so an entry's `match` can name the pack and the same creature in
two packs is told apart. An entry:

```json
{
  "id": "some-pack-uses-not-set",
  "scenario": "heroes-features-use",
  "kind": "CONTENT",
  "what": ["the system refused the use", "uses consumed"],
  "max": 530,
  "match": "none are set; from some-module.classes",
  "why": "the pack's features spend their own uses, but the items have none set"
}
```

A problem is known when the scenario and kind are equal, the problem's `what` is the entry's `what`
(or one of them, when it is a list), and the problem's evidence contains `match`. `what` is required,
so an entry covers only the problem it names; where one problem packs several items ("2 grant(s)
missing: ..."), put the count in `what`, so a new item beside the old one fails. `max` (optional)
caps the problems an entry may cover in one run, and the ones over it fail: give a pack-wide entry a
`max` near the count a `full` run sees, so new findings of its kind are not absorbed. A `KIT` problem
is never known, and neither is a hero that was not built. A step whose problems are all known passes and names the entries in its detail; the report's "Known findings" section lists how
often each entry matched and the entries a run did not see (normal in `smoke`; in `full` the content
may have been fixed, so remove the entry).
