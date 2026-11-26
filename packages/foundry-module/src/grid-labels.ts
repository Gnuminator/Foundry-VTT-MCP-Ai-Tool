/**
 * Grid labels for rooms: "C4 to H9, without E6 to F7" becomes a set of grid squares.
 *
 * Columns are letters (A is the first column, then B ... Z, AA, AB ...), rows are numbers counted
 * from 1 at the top, the way a battle map is labelled. Square 0,0 of `plan-room-setup` is A1.
 * The text is a list of parts separated by commas or "and"; a part is one square ("E6") or a
 * rectangle ("C4 to H9", any two corners, "C4-H9" and "C4:H9" also work). Everything after the
 * word "without" (or "except", "minus") is cut out of what came before it: "A1 to F6, without
 * B2, C3 to C4". Pure and Foundry-free so it is easy to test.
 */

/** One grid square: column `j` and row `i`, both counted from 0 at the top left (A1 is 0,0). */
interface GridCell {
  i: number;
  j: number;
}

/** The most squares one label list may cover (a 100 x 40 hall is already far past a room). */
const MAX_LABEL_CELLS = 4000;

const WITHOUT = /\b(?:without|except(?:\s+for)?|minus)\b/i;
const CELL = /^([A-Za-z]{1,2})\s*0*([1-9]\d{0,3})$/;

/** Column letters to a 0-based column ("A" 0, "Z" 25, "AA" 26). */
function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** A 0-based column to its letters (0 "A", 26 "AA"). */
export function columnLabel(j: number): string {
  let n = j + 1;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** The label of one square, "C4" for column 2, row 3. */
export function cellLabel(cell: GridCell): string {
  return `${columnLabel(cell.j)}${cell.i + 1}`;
}

function parseCell(text: string): GridCell {
  const m = CELL.exec(text.trim());
  if (!m)
    throw new Error(`"${text.trim()}" is not a grid square (use a letter and a number, like C4)`);
  return { j: columnIndex(m[1]), i: Number(m[2]) - 1 };
}

/** The squares of one part: a single square, or the rectangle between two corners. */
function parsePart(part: string): GridCell[] {
  const bits = part.split(/\s+to\s+|\s*[-:]\s*/i).filter(b => b.trim() !== '');
  if (bits.length === 0) throw new Error('An empty part in the grid squares');
  if (bits.length > 2)
    throw new Error(`"${part.trim()}": a rectangle has two corners, like C4 to H9`);
  const a = parseCell(bits[0]);
  const b = bits.length === 2 ? parseCell(bits[1]) : a;
  const cells: GridCell[] = [];
  const i1 = Math.min(a.i, b.i);
  const i2 = Math.max(a.i, b.i);
  const j1 = Math.min(a.j, b.j);
  const j2 = Math.max(a.j, b.j);
  if ((i2 - i1 + 1) * (j2 - j1 + 1) > MAX_LABEL_CELLS) {
    throw new Error(`"${part.trim()}" covers more than ${MAX_LABEL_CELLS} squares`);
  }
  for (let i = i1; i <= i2; i++) for (let j = j1; j <= j2; j++) cells.push({ i, j });
  return cells;
}

function parseList(text: string): GridCell[] {
  const cells: GridCell[] = [];
  for (const part of text.split(/\s*(?:,|;|\band\b)\s*/i)) {
    if (part.trim() === '') continue;
    cells.push(...parsePart(part));
  }
  return cells;
}

/**
 * The squares the label text covers, row by row, without duplicates. Throws a plain sentence on
 * text it cannot read, on a "without" that removes nothing it could, and on an empty result.
 */
export function parseGridLabels(text: string): GridCell[] {
  const source = String(text ?? '').trim();
  if (!source) throw new Error('The grid squares are empty');
  const pieces = source.split(WITHOUT);
  if (pieces.length > 2) throw new Error('Use "without" once: everything after it is cut out');
  const keep = new Map<string, GridCell>();
  for (const c of parseList(pieces[0])) keep.set(`${c.i}.${c.j}`, c);
  if (keep.size === 0) throw new Error('Name the squares before "without"');
  if (pieces.length === 2) {
    const cut = parseList(pieces[1]);
    if (cut.length === 0) throw new Error('Name the squares after "without"');
    for (const c of cut) keep.delete(`${c.i}.${c.j}`);
  }
  if (keep.size === 0) throw new Error('Nothing is left after "without"');
  if (keep.size > MAX_LABEL_CELLS) {
    throw new Error(`More than ${MAX_LABEL_CELLS} squares: a room is smaller than that`);
  }
  return [...keep.values()].sort((a, b) => a.i - b.i || a.j - b.j);
}

/** The bounding box of the squares, as `[column, row, width, height]` (0-based). */
export function cellBounds(cells: GridCell[]): [number, number, number, number] {
  let i1 = Infinity;
  let j1 = Infinity;
  let i2 = -Infinity;
  let j2 = -Infinity;
  for (const c of cells) {
    i1 = Math.min(i1, c.i);
    j1 = Math.min(j1, c.j);
    i2 = Math.max(i2, c.i);
    j2 = Math.max(j2, c.j);
  }
  return [j1, i1, j2 - j1 + 1, i2 - i1 + 1];
}
