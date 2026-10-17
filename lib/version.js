// Version numbers: exactly MAJOR.MINOR.PATCH, digits only (1.2.10 > 1.2.9). Anything else is rejected rather than
// guessed at, so a malformed update file can never make an old version look new.
'use strict';

const RE = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;

function parse(v) {
  const m = RE.exec(String(v ?? '').trim());
  return m ? [+m[1], +m[2], +m[3]] : null;
}
const valid = (v) => parse(v) !== null;

// < 0: a is older, 0: the same, > 0: a is newer. Throws on a malformed version.
function compare(a, b) {
  const pa = parse(a), pb = parse(b);
  if (!pa || !pb) throw new Error(`Not a version number: ${pa ? b : a}`);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}
const lt = (a, b) => compare(a, b) < 0;
const gte = (a, b) => compare(a, b) >= 0;

module.exports = { parse, valid, compare, lt, gte };
