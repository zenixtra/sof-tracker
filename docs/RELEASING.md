# Releasing a new version

The same steps every time. The commands are for Windows PowerShell in the project folder. The first release is in [PUBLISHING.md](PUBLISHING.md).

## Version numbers

Versions are `MAJOR.MINOR.PATCH`, digits only, compared part by part (`1.2.10` is newer than `1.2.9`).

- **PATCH** (`1.45.0 → 1.45.1`): bug fixes only.
- **MINOR** (`1.45.1 → 1.46.0`): new features, with data and settings still compatible.
- **MAJOR** (`1.x → 2.0.0`): changes that older data can't follow back. Avoid these.

The version lives only in `package.json`. The setup name, the tag (`v1.46.0`) and the update file all follow from it. Change it with:

```powershell
npm version patch --no-git-tag-version   # or: minor, major, or an exact number such as 1.46.0
```

## The release workflow

**The order matters.** Users are told about a version only by the signed `updates/update.json`, and only once you push it. Everything before that is invisible to them. `publish` refuses to sign until the setup can really be downloaded from GitHub, so a required update can never point to a missing file.

| # | Step | Command / place | Expected result |
|---|---|---|---|
| 1 | Make and test your changes | `npm start`, try the dashboard | works |
| 2 | Run the checks | `npm run check` | `All checks passed.` |
| 3 | Raise the version | `npm version minor --no-git-tag-version` | `v1.46.0` |
| 4 | Add notes to `CHANGELOG.md` | the file | a section for 1.46.0 |
| 5 | Build and fingerprint the setup | `node scripts/release.js build` | `✔ SoF-Tracker-Setup-1.46.0.exe … SHA-256 …` |
| 6 | Test the setup locally | run `dist\SoF-Tracker-Setup-1.46.0.exe` over your installed copy | the dashboard opens, your data is still there |
| 7 | Commit and push the code | `git add -A; git commit -m "SoF Tracker 1.46.0"; git push` | CI turns green on GitHub (Actions tab) |
| 8 | Upload the setup | `gh release create v1.46.0 dist\SoF-Tracker-Setup-1.46.0.exe --title "SoF Tracker 1.46.0" --notes-file notes.txt` | the asset is on the release page |
| 9 | Sign the update file | `node scripts/release.js publish --notes-file notes.txt` (add `--minimum 1.46.0` for a required update) | `✔ the uploaded setup matches the build`, `✔ updates\update.json signed` |
| 10 | Make it live | `git add updates; git commit -m "Release channel: 1.46.0"; git push` | |
| 11 | Check it | `node scripts/release.js verify` (wait up to 5 minutes for GitHub's cache) | two ✔ lines |
| 12 | Test the update from the old version | on a test PC with the previous version: Settings → Updates → Check for updates now → Install | restarts as 1.46.0, data kept |
| 13 | Announce it | | |

`notes.txt` is a plain text file with the release notes. Users see the first line in the update banner and the whole text on the update screen. Put the SHA-256 from step 5 in the GitHub release notes too, so people who download by hand can check it.

### Optional or required?

- **Optional** (the default): users see a banner and can click **Later**.
- **Required**, either way:
  - `--minimum 1.46.0` blocks everyone below 1.46.0 until they update;
  - `--mandatory` makes this one release required without changing the minimum.
- **Later**, to require a version that's already out: `node scripts/release.js set --minimum 1.46.0`, then commit and push `updates`.

Require an update only when you must, for example when older versions show wrong data or a game patch broke them. Users who are offline when you publish keep running until they reconnect: the tracker checks every 6 hours and at every start.

### Release checklist

- [ ] `npm run check` passes.
- [ ] The tracker starts from a fresh install: no `data` folder, game folder picked in setup.
- [ ] The tracker starts after updating over the previous version, with sessions, settings and notes still there.
- [ ] A game update since the last release hasn't broken the readers: **Settings → Self-check** and **Reader check** in the dashboard.
- [ ] `CHANGELOG.md` and the release notes are written.
- [ ] The version in `package.json` is new.
- [ ] The setup is uploaded **before** `publish`, and `publish` reports `✔ the uploaded setup matches the build`.
- [ ] `updates/` is committed and pushed, and `verify` shows the new number.
- [ ] An older install updated itself successfully.
- [ ] Only then: the announcement.

## A broken release: withdrawing it and rolling back

Trackers can't install an older version over a newer one through the updater: the newer version's data may not suit the older code. You **fix forward** instead, and that is quick.

1. **Stop it from spreading** while you work on the fix:
   - If the broken version is the latest, you can't withdraw it until something newer exists. Rebuild the last good code as a new patch version, e.g. `1.46.1` containing `1.45.0`'s code:

     ```powershell
     git fetch --tags
     git checkout v1.45.0 -- .
     npm version 1.46.1 --no-git-tag-version
     ```

   - Then build, upload and publish it (steps 5–11).
2. **Withdraw the broken version.** Everyone still on it is blocked and sent to the replacement:

   ```powershell
   node scripts/release.js revoke --version 1.46.0 --reason "Crashes when the chat box is closed" --replacement 1.46.1
   git add updates; git commit -m "Withdraw 1.46.0"; git push
   ```

3. **Withdrew the wrong thing?** `node scripts/release.js set --unrevoke 1.46.0` undoes it.
4. **Tell users.** The update screen shows your `--reason`. Use `node scripts/release.js set --message "…"` for a note on every update screen.

**On a single PC**, an install keeps the previous version's program files in `%LOCALAPPDATA%\SoF Tracker\.previous`. If an update leaves someone's tracker unable to start, they can install the previous setup from the Releases page by hand (the data folder is untouched). A tracker that would then be blocked updates again once the fix is out.

## If something in the update chain fails

| Situation | What happens | What you do |
|---|---|---|
| **GitHub or the update file can't be reached** | Trackers keep the last verified file and keep working, for 7 days by default. Users who were already required to update stay blocked. | Usually nothing: it resolves itself. For a longer outage, give users more time first: `node scripts/release.js set --grace 336`, then push. |
| **You pushed a broken `update.json`** (shouldn't happen: the tool verifies before writing) | Trackers reject it and keep their last good file; the dashboard shows "last try failed". | Fix it with `release.js set …` (it re-signs with a higher number), then push. |
| **The setup on a release was deleted or replaced** | Updates fail with a "fingerprint" or "404" message; nothing unverified is run. | Upload the original `dist\SoF-Tracker-Setup-<v>.exe` again. If you rebuilt it, run `build` and `publish` again with a new version. |
| **An update fails on a user's PC** | After 5 minutes still on the old version, the update screen shows "The update did not finish", with **Try again** and a download link. The setup's log is `data\install.log`. | Ask for `install.log` and **Settings → Report a problem**. The manual route always works: download the setup from Releases and run it. |
| **You lost the signing key** | You can never publish a signed update file again. Existing trackers stop working when their offline grace runs out. | Prevent it: keep two backups. If it happens: make a new key (`release.js setup` after deleting the old one), publish a release with it, and tell users to install it by hand once. |
| **Someone else got the signing key** | They could sign an update file pointing to their own setup, if they can also change your repository. | Make a new key at once, publish a release signed with the **old** key that carries the **new** public key (so trackers switch), then remove the old key from `release.config.json` in the next release. Also change your GitHub password and tokens. |

### Changing the signing key (planned rotation)

`release.config.json` can hold several public keys, and trackers accept a file signed by any of them.

1. Add the new key while the old one is still in use: move the old `.pem` aside, run `release.js setup --repo …`, and keep both entries in `publicKeys`.
2. Ship a release.
3. Once nearly everyone has it, sign with the new key only.
4. In a later release, remove the old key.

## Code signing (optional)

The setup isn't Authenticode-signed, so Windows SmartScreen shows "Windows protected your PC" for a browser download until the file builds up reputation. In-app updates don't need it: they're checked against your signed fingerprint.

To remove the warning, buy an OV code-signing certificate (about €100–400 a year; they now come on a USB token or as a cloud service), or use Microsoft's **Azure Trusted Signing** (a small monthly fee; only for some countries and identities). Then sign after `build` and before uploading:

```powershell
signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /a dist\SoF-Tracker-Setup-1.46.0.exe
```

Signing changes the file, so run `build`, then `signtool`, then recompute the fingerprint. `publish` downloads and checks the uploaded file, so re-run `build --skip-tests` afterwards, or update `dist\release-<v>.json` with the signed file's SHA-256 (`Get-FileHash`) and size.

## Keeping it healthy

- **After every game patch:** run the tracker once and look at **Settings → Self-check**. Game patches are what break readers most often.
- **Every few months:**
  - Check that Node.js 22 is still supported (https://nodejs.org/en/about/previous-releases). When it reaches end of life, raise `engines.node` in `package.json` and the `22` check in `installer/install.ps1`.
  - Run `npm run check` and `node scripts/release.js verify`.
- **Watch** GitHub issues and **Security → Advisories**.
- **Keep** the signing key backups somewhere you'll still have in a year.
