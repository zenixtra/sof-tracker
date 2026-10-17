// Shared test helpers. Tests that need the real game folder are skipped when it isn't there.
'use strict';

const fs = require('fs');
const path = require('path');

const GAME_DIR = process.env.SOF_GAME_DIR || 'C:\\NetGame\\ScionsOfFate';
const CLIENT_DIR = path.join(GAME_DIR, 'Client');
const hasGame = fs.existsSync(path.join(CLIENT_DIR, 'Ybi.cfg'));
const gameOnly = { skip: hasGame ? false : 'game folder not found' };

// URLSearchParams from a plain object (the views take query objects)
const q = (o = {}) => new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v)]));

module.exports = { GAME_DIR, CLIENT_DIR, hasGame, gameOnly, q };
