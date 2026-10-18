# Changelog

## 1.46.0

- **Potions per character:** each character's HP and MP potions are read from its own auto-combat setup and skill bar in the game folder. Potion costs and farming profit use them automatically; the Settings choice is only used when nothing is found.
- **Skill setup** (Stats tab): each character's skill bar and auto-combat setup, with skill levels and cooldowns. It also shows stronger versions of the skills you use that you can already learn, and the strongest skills of your class at your level, for your own faction only.
- **Your own characters are recognised:** every account and character that logged in on this PC is read from the game folder. Your alts no longer count as players met, as danger, or in arrival groups and reports. Characters the tracker never saw play appear in Compare characters, marked "not tracked", when their level is known.
- **Game settings check:**
  - The Setup check shows whether the game runs windowed and whether the chat background is easy to read.
  - "How the game runs" lists your graphics settings, heaviest first, and says what to lower first when the game freezes often.
- **Settings history:** changes to the game's settings are logged and shown on the session timeline (⚙).
- **Fixes:**
  - The Setup check now asks for Node.js 22, which this version needs.
  - Your second game window's character is no longer treated as a stranger.

## 1.45.0: first public release

- **Updates:**
  - The tracker checks a signed update file at start and every 6 hours.
  - Optional updates show a banner. Required or withdrawn versions show an update screen, and the tracker stays blocked until it's updated.
  - Updates are downloaded from GitHub, checked against their signed SHA-256 fingerprint and size, installed, and confirmed after the restart.
- **Security:**
  - Other websites can no longer use the tracker (Host, Origin and Sec-Fetch-Site checks).
  - The phone view needs an access key.
  - The old "install from the shared folder" button is gone: it ran setups without any check.
- **The setup:**
  - It replaces program files as a whole and keeps the previous version in `.previous`.
  - It puts the old files back if replacing fails, and writes `data\install.log`.
  - It has an `-Update` mode for in-app updates, and stops only the tracker of its own folder.
- **Fixes:** the tracker no longer crashes at start when the game folder doesn't exist.
- **New:**
  - break reminders;
  - your own dashboard layout;
  - character comparison;
  - game CPU, memory and freeze tracking;
  - monthly reports and "save as a page";
  - "Ask the tracker";
  - goal countdowns;
  - sound packs;
  - automatic tidy-up.

Earlier versions (up to 1.44.0) were shared privately.
