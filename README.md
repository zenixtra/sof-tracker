# SoF Tracker

A live stats tracker for **Scions of Fate**. It runs on your own PC and shows, in your browser:

- HP, EXP per hour and time to the next level;
- the players around you, with danger alerts;
- bosses, events and the 24-hour plan;
- farming spots, monsters and loot value;
- quests, gear, gold and the market;
- weekly and monthly reports.

There's also an always-on-top overlay, a phone view, OBS widgets, and alerts by phone or Discord.

It reads the game's own log and data files and looks at the game window the way you do (Windows' built-in text recognition). It never reads or changes the game's memory, never injects anything into the game and never sends input to it.

> SoF Tracker is a fan project. It is not made, endorsed or supported by the publisher of Scions of Fate. Use it at your own risk and check the game's terms of service yourself.

## Install

1. Download the newest **`SoF-Tracker-Setup-<version>.exe`** from the [Releases page](../../releases/latest).
2. Run it.
   - Windows may show **"Windows protected your PC"**, because the setup isn't code-signed. Click **More info → Run anyway**.
   - If you want to be sure the file is genuine, compare its SHA-256 with the one in the release notes: `Get-FileHash .\SoF-Tracker-Setup-<version>.exe`.
3. The setup:
   - installs **Node.js** if you don't have it (it asks first, using Windows' own package manager);
   - finds your game folder, or asks you for it;
   - creates shortcuts.
4. Look for the gold **S** icon in the system tray. Double-click it to open the dashboard (`http://localhost:7777`).

Everything is installed for your Windows user only (`%LOCALAPPDATA%\SoF Tracker`), without administrator rights. Your data stays in its `data` folder; see [PRIVACY.md](PRIVACY.md).

### System requirements

- **Windows 10 or 11**, 64-bit.
- **Scions of Fate**, run in a window or borderless window for the screen reader.
- **Node.js 22 or newer.** The setup installs it if needed.
- **About 100 MB of disk space**, plus your data.
- **Internet access**, for the rankings, news and update checks. The game needs it anyway.

## Updates

The tracker checks for a new version when it starts and every 6 hours.

- **Optional updates** show a banner with **Install update** and **Later**.
- **Required updates** cover the dashboard with an update screen until you install them. This happens when the publisher sets a new minimum version, or withdraws a broken version. Click **Install the update**: the tracker downloads the setup, checks its signed fingerprint, installs it and restarts. Your data and settings are kept.
- **Offline:** if the tracker can't reach the update server for 7 days, it asks you to connect and check again.

If an update fails, the update screen shows why and has **Try again**, plus a link to download the setup yourself. See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## Uninstall

Use **Start menu → SoF Tracker → Uninstall SoF Tracker**. It asks whether to keep your data.

## Troubleshooting

See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md). The dashboard's **Settings → Setup check** also says what's missing, and **Settings → Report a problem** makes a diagnostics zip (without your tokens).

---

## For developers

```powershell
git clone https://github.com/<you>/sof-tracker.git
cd sof-tracker
npm test              # all tests; the ones that need the game folder or your data skip themselves
npm start             # runs the tracker from the source folder: http://localhost:7777
npm run check         # parses every script, looks for secrets, runs the tests
npm run build-installer
```

There are no npm dependencies, just Node.js 22 or newer. The installer is built with the C# compiler that ships with Windows.

| Path | What |
|---|---|
| `server.js` | The tracker: HTTP server, log readers, alerts, all views |
| `lib/` | Modules: parsers, game data, updater (`updater.js`, `manifest.js`, `version.js`), request guard (`guard.js`) |
| `public/` | Dashboard, overlay, phone page and widgets (plain HTML and JavaScript), plus the update screen (`update-gate.js`) |
| `screenreader.ps1`, `tray.ps1`, `overlay.ps1` | Windows parts: screen text recognition, tray icon and hotkeys, overlay window |
| `installer/` | Setup builder (`build.ps1`, `pack.js`, `SetupLauncher.cs`), `install.ps1`, `uninstall.ps1` |
| `scripts/release.js` | Release tool: signing key, build, publish, withdraw, verify |
| `release.config.json` | Where trackers look for updates, and the public key they trust |
| `updates/` | `channel.json` (what is published) and `update.json` (the same, signed; read by every tracker) |
| `test/` | `node --test` tests |

Optional settings go in a `.env` file; see [.env.example](.env.example).

- **Publishing:** [docs/PUBLISHING.md](docs/PUBLISHING.md) covers the first public release, step by step. [docs/RELEASING.md](docs/RELEASING.md) covers every release after that: the workflow, the checklist and rolling back.
- **Security:** [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
