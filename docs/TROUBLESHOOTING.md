# Troubleshooting

Start with the dashboard's **Settings → Setup check**: it lists what is missing on your PC and how to fix it. **Settings → Report a problem** downloads a diagnostics zip (logs and settings, without your tokens) that you can attach to a GitHub issue.

| Problem | Fix |
|---|---|
| **"Windows protected your PC"** when starting the setup | The setup isn't code-signed. Click **More info → Run anyway**. To check the file, compare `Get-FileHash .\SoF-Tracker-Setup-<v>.exe` with the SHA-256 in the release notes. |
| **The setup says Node.js is missing and can't install it** | Install the **LTS** version from https://nodejs.org, then run the setup again. |
| **"Scions of Fate was not found"** | Pick the folder that holds `YGOnline.exe` or the `Client` folder. To change it later, set `SOF_CLIENT_DIR` in a `.env` file (see `.env.example`) or run the setup again. |
| **The tray icon doesn't appear** | Start **SoF Tracker** from the Start menu. If nothing happens, look at `%LOCALAPPDATA%\SoF Tracker\data\tracker-errors.log`. |
| **`http://localhost:7777` doesn't open** | The tracker isn't running: start it from the Start menu. If another program uses port 7777, close it. |
| **"Unknown host name" or "Requests from other websites are not allowed"** | Open the dashboard at exactly `http://localhost:7777`. The tracker only answers its own pages; this protects you from websites that try to use it. |
| **The phone view asks for an access key** | Open the address shown on the PC (**dashboard → the phone-view box**). It includes the key; after that the phone remembers it. |
| **The screen reader reads nothing** | Run the game in a window or borderless window, not minimised. Check **Settings → Screen reader** is on. **Reader check** shows which parts worked lately. |
| **"Update required" screen** | Click **Install the update**. The tracker downloads, checks and installs the new version and restarts; your data is kept. |
| **The update fails or "did not finish"** | Click **Try again**. If it fails again, use **Download the setup yourself** on the same screen and run that file. The setup log is `data\install.log`. |
| **"SoF Tracker needs to check for updates"** | The tracker couldn't reach GitHub for 7 days. Connect to the internet (and allow `raw.githubusercontent.com` and `github.com` in any firewall), then click **Check again**. |
| **"The signature does not match"** in Settings → Updates | Something between you and GitHub changed the update file (a proxy, or an attack). The tracker ignored it and keeps working with the last good one. Try another network. |
| **After an update the tracker doesn't start** | Run the setup of the previous version from the Releases page by hand. Your `data` folder stays as it is. Then report it with `data\install.log` and `data\tracker-errors.log`. |
| **Everything is slow** | **Settings → Tracker health** shows the tracker's CPU use. Read the screen less often (Settings → Screen reader), or switch off the second-window reader. |

Your data is in `%LOCALAPPDATA%\SoF Tracker\data`. Make a backup with **Settings → Back up data now** before trying anything drastic.
