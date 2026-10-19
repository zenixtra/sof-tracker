# Privacy

SoF Tracker runs on your own PC. It has no account, no analytics and no server of its own.

## What it reads

- **The game's own files** on your PC: the log files Scions of Fate writes (`Client\log*.txt`) and its data files (item, monster and quest names).
- **Your game window**, a few times a second while the screen reader is on. It reads HP, MP, EXP, the chat and other on-screen text with the text recognition built into Windows. Pictures are only kept when you switch that on (death replays, drop pictures, debug captures). They stay in the `data` folder, and the tidy-up in Settings can remove old ones.
- It **never** reads the game's memory, injects anything into the game, or sends input to it.

## What it stores

Everything is kept in the `data` folder next to the program, normally `%LOCALAPPDATA%\SoF Tracker\data`. That includes your sessions, the chat log (if you switch it on), the players you met, your notes about players, your settings, and the tokens you enter for phone or Discord alerts.

Other players' names and chat lines are stored because they were on your screen. Treat this folder as private, especially before sharing it or a backup of it.

## What it sends, and to whom

| When | To | What |
|---|---|---|
| Always (every few hours) | `fate.netgame.com` | Reads the public rankings and news pages. Nothing about you is sent. |
| Always (at start and every 6 hours) | `raw.githubusercontent.com` (GitHub) | Downloads the update file. GitHub sees your IP address, as with any download. |
| When you install an update | `github.com` | Downloads the new setup. |
| Only if you set it up | ntfy, Telegram, Discord | The alerts you chose, to the topic, chat or channel you entered. |
| Only if you pair the Android app | `ntfy.sh` | Every alert (title and text) goes to a private, random topic, and the paired phones read it from there. Only someone with your pairing code can read the topic. ntfy.sh keeps messages for about 12 hours. **Unpair all phones** makes a new topic. |
| Only if you set it up | Your shared friends folder (OneDrive, Dropbox, …) | Your watchlist, danger flags, notes and markers, plus your live status and trade offers if you allowed them. |
| Only if you open the 3D map | `cdn.jsdelivr.net` | Downloads the three.js library. |
| Only if you switch on the phone view, or "Let my phone see the tracker on this Wi-Fi" | Devices on your home network | The dashboard. They need the access key shown on the PC (the paired app has it). |

## Removing your data

The uninstaller asks whether to keep or delete the `data` folder. You can also delete it yourself while the tracker is closed.
