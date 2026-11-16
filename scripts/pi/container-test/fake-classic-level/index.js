'use strict';
// A stand-in for Foundry's classic-level (a LevelDB binding) in the stage 14 container test: the "database" is a
// folder with a fake-docs.json, an array of [key, rawString] pairs, and the iterator yields them in order.
const fs = require('node:fs');
const path = require('node:path');

class ClassicLevel {
  constructor(location, options = {}) {
    this.location = location;
    this.options = options;
    this.entries = [];
  }

  async open() {
    const file = path.join(this.location, 'fake-docs.json');
    if (!fs.existsSync(file)) {
      if (this.options.createIfMissing === false)
        throw new Error(`fake classic-level: no database at ${this.location}`);
      return;
    }
    this.entries = JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  async close() {}

  async *iterator() {
    for (const entry of this.entries) yield entry;
  }
}

module.exports = { ClassicLevel };
