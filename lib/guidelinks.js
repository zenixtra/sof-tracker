// The official (Korean) Yulgang guide's pages the game itself links to (GuideLinkList.cfg), named in English and
// grouped. Keyed by the page's "view" number: a page the game adds later still shows, under its Korean name.
// Only links: the pages open in your browser (nothing is downloaded from the site).
'use strict';

const GROUPS = [
  ['Gear & crafting', { 609: 'Refining', 610: 'Treasures', 909: 'Awakening', 611: 'Spirit jade stones', 614: 'Quality transfer', 618: 'Manufacturing', 619: 'Crafting',
    622: 'Gathering', 623: 'Soul gathering', 1441: 'Original gear: dismantle, enhance, transfer' }],
  ['Trading', { 626: 'Personal shop', 627: 'Auction house' }],
  ['Houses & people', { 635: 'Houses', 638: 'Master & disciple', 889: 'Couples', 641: 'Marriage', 647: 'Parcels & mail', 648: 'Carrier pigeon letters', 649: 'Inspecting players' }],
  ['Play', { 645: 'Mukhon box & auto-hunting', 646: 'Outfits' }],
  ['PvP & wars', { 653: 'Kills (PK)', 654: 'Honor', 657: 'Martial Blood War', 658: 'Faction war', 659: 'Storm war', 661: 'House war', 2356: 'Soul War', 2487: 'Jindol War' }],
  ['Dungeons, bosses & Ascension', { 906: 'Inner barrier', 907: 'Demon cave', 733: 'Underground maze', 678: 'Field bosses', 680: 'Ascension', 748: 'Divine beasts' }],
  ['Class skills', { 692: 'Sword: skills', 691: 'Sword: ki abilities', 698: 'Blade: skills', 697: 'Blade: ki abilities', 704: 'Spear: skills', 703: 'Spear: ki abilities',
    710: 'Bow: skills', 709: 'Bow: ki abilities', 716: 'Healer: skills', 715: 'Healer: ki abilities', 722: 'Ninja: skills', 721: 'Ninja: ki abilities' }],
  ['Account safety', { 666: 'Second password', 667: 'Account guard' }],
  ['NPCs', { 823: 'NPCs (1)', 825: 'NPCs (2)', 827: 'NPCs (3)' }],
];
const NAME = new Map(GROUPS.flatMap(([g, m]) => Object.entries(m).map(([v, n]) => [+v, { group: g, name: n }])));

// links (gamedb.guideLinks: { view, names, link }) → [{ group, pages: [{ name, korean, link, cls? }] }] in the order above
function guideLinkGroups(links) {
  const out = new Map(GROUPS.map(([g]) => [g, []]));
  out.set('More', []);
  for (const l of links || []) {
    const k = NAME.get(l.view), page = { name: k?.name || l.names[0], korean: l.names.join(' · '), link: l.link };
    const m = /^(Sword|Blade|Spear|Bow|Healer|Ninja):/.exec(page.name); if (m) page.cls = m[1];
    out.get(k?.group || 'More').push(page);
  }
  return [...out.entries()].filter(([, p]) => p.length).map(([group, pages]) => ({ group, pages }));
}

module.exports = { guideLinkGroups };
