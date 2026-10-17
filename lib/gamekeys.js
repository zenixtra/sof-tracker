// Keys of the client's data files, recovered from the files themselves (see lib/gamedb.js).
'use strict';

// Ybi.cfg (items, NPCs, monsters, zones…): every 32-bit word has its bits shuffled; bit i moves to bit ITEM_BITS[i].
const ITEM_BITS = [18, 29, 7, 25, 15, 31, 22, 27, 9, 26, 3, 13, 19, 14, 20, 11, 5, 2, 23, 16, 10, 24, 28, 17, 6, 30, 0, 21, 12, 8, 4, 1];
// Ybq.cfg (quests): every byte has its bits shuffled the same way.
const QUEST_BITS = [1, 2, 5, 7, 0, 3, 4, 6];
// ybnpcinfo.cfg, ybmapinfo.cfg, resource_mob.cfg, CoolTime.cfg …: XOR with this repeating 150-byte key.
const TABLE_KEY = Buffer.from('2d9784f228d12954f11202286b206142f5ec1f5222443b23573f626ff2a324d2a71656c1f2024862274221ac23ad43f2321804504571bf6e78617258229216027862d72852dfe8b34214b1a66e31af2621b3d754e92f722c3f51f41102f2b74025c32582433224f1eeff4212049e2ff96421f631720874822319decf23273836edf249627128e8223bb7354277422fa44227940262a7', 'hex');

module.exports = { ITEM_BITS, QUEST_BITS, TABLE_KEY };
