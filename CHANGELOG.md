# Changelog

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
