// Reads the client's own message table (Ybmsg.cfg) to recognise timed server notices.
// Layout: int32 version, int32 count, then `count` records of 512 bytes EUC-KR text + int32 id.
'use strict';

const fs = require('fs');
const path = require('path');

const RECORD = 516;
const SKIP = /Chatting is prohibited|supremacy charm|Supremacy Charm expires|reward event|scheduled time/i;

function loadMessages(clientDir) {
  const b = fs.readFileSync(path.join(clientDir, 'Ybmsg.cfg'));
  const count = b.readInt32LE(4);
  if (8 + count * RECORD !== b.length) throw new Error('unexpected Ybmsg.cfg layout');
  const dec = new TextDecoder('euc-kr');
  const msgs = [];
  for (let k = 0; k < count; k++) {
    const off = 8 + k * RECORD;
    const raw = b.subarray(off, off + 512);
    const end = raw.indexOf(0);
    msgs.push({ id: b.readInt32LE(off + 512), text: dec.decode(raw.subarray(0, end < 0 ? 512 : end)) });
  }
  return msgs;
}

// Turn every "...%s min..." template into a regex that captures the minutes.
function timerTemplates(clientDir) {
  let msgs;
  try { msgs = loadMessages(clientDir); } catch (e) {
    console.log(`[tracker] could not read Ybmsg.cfg (${e.message}); using generic timer matching`);
    return [{ re: /(?:after|in) (\d+) ?min/i, minuteGroup: 1 }];
  }
  const out = [];
  for (const { text } of msgs) {
    if (!/%s ?mins?\b/i.test(text) || SKIP.test(text)) continue;
    const parts = text.split('%s');
    let minuteGroup = 0, src = '^';
    parts.forEach((part, i) => {
      src += part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
      if (i < parts.length - 1) {
        const isMinutes = /^\s*mins?\b/i.test(parts[i + 1]);
        src += isMinutes ? '(\\d+)' : '(.+?)';
        if (isMinutes && !minuteGroup) minuteGroup = i + 1;
      }
    });
    if (minuteGroup) out.push({ re: new RegExp(src, 'i'), minuteGroup });
  }
  console.log(`[tracker] loaded ${out.length} timed-notice templates from Ybmsg.cfg`);
  return out;
}

// Place names from the message table (region names, dungeons, training areas, "Move to X" targets).
// The ids do not match the zone numbers in the logs, so these are offered as a pick list.
const PLACE = /\b(Forests?|Village\d*|Deserts?|Seas?|Mountains?|MT|Cave|Temple|Arena|Valley|Palace|Dungeon|Tower|Marketplace|Island|Ruins|Hall|Castle|Town|Fortress|Plain|Swamp|Garden|Shrine|Tomb|Lair|Outland|Labyrinth|Sanctuary|Stronghold|Hill|Jungle|Mansion|Pavilion\d*|Catacomb|Chamber|Abyss|Land|Area|Camp|Entrance|shore)\b/i;
const NOT_PLACE = /Rankings|Server State|Info\b|Map$|^\/|cannot|Set up|appropriate|Select Realm|Make |Join |Reinforce|setting|Requested|quest area|saved area|other location|another area|^training area$|%[sd]|Former Server|<|heavenly realm|Eight Treasures|Abyss Case|failed/i;

function zoneNames(clientDir) {
  let msgs;
  try { msgs = loadMessages(clientDir); } catch { return []; }
  const seen = new Map();
  for (const { text } of msgs) {
    let t = text.trim();
    const move = /^Move to (.{3,45}?)\.?$/i.exec(t);
    if (move) t = move[1];
    else if (t.length > 45 || /[.!?:]$/.test(t) || !PLACE.test(t)) continue;
    t = t.replace(/^(Go to( the)?|Teleport to|Enter( to)?( the)?|Moved to|Entering the|Let's go to|other)\s+/i, '').trim();
    if (t.length < 4 || NOT_PLACE.test(t)) continue;
    const key = t.toLowerCase().replace(/\s+/g, ' ');
    if (!seen.has(key)) seen.set(key, t);
  }
  return [...seen.values()].sort((a, b) => a.replace(/^\[[^\]]*\]\s*/, '').localeCompare(b.replace(/^\[[^\]]*\]\s*/, '')));
}

// Zone numbers -> names. Worked out by matching the client's minimaps
// (datas/interface/DATA/window_minimap/<zone>.bmp) with the named maps in Scions_of_Fate_guide.chm,
// and checking that every map's exit signs point at its neighbours' names.
const KNOWN_ZONES = {
  101: 'Central Valley',
  201: 'Hill Valley',
  301: 'Riverside Plains',
  1001: 'House of Order',
  1101: 'House of Chaos',
  2101: 'Desolate Lands',
  2201: 'Darkhand Lair',
  5001: 'Northern Sea',     // Ice Palace, Ruins of Northern Sea
  6001: 'Southern Forest',  // Ruins of Southern Forest
  25100: 'Tiger Valley',    // Tiger Valley Guild
  26000: 'Garden Plain',    // Garden Gate, Center Plain (inferred from landmarks)
};

module.exports = { timerTemplates, zoneNames, loadMessages, KNOWN_ZONES };
