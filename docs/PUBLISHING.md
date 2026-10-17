# Publishing SoF Tracker for the first time

This guide takes the project from your PC to a public release that anyone can download, with mandatory updates working. Follow the steps in order. Every command is for **Windows PowerShell**, run in the project folder (`C:\Users\<you>\Documents\SOF_Project`) unless a step says otherwise.

**How it fits together:**
- **The repository** holds the code. It's a public GitHub repository and costs nothing.
- **GitHub Releases** hosts the setup files people download. Also free.
- **`updates/update.json`** in the repository is the signed file every tracker reads, through `raw.githubusercontent.com`. Free and https.
- **Your signing key** stays on your PC only (`%USERPROFILE%\.sof-tracker-release\`). With it, you're the only one who can publish updates.

There is no server, database or paid hosting to set up: the tracker runs entirely on each user's PC.

**Costs:** everything here is free.

| Service | Cost | Needed? |
|---|---|---|
| GitHub account, public repository, Releases | Free | Yes |
| Code-signing certificate (removes Windows' "unknown publisher" warning) | Paid, about €100–400 a year | No, see [RELEASING.md](RELEASING.md#code-signing-optional) |

**What must stay private:**
- the signing key `update-signing-key.pem`;
- your `data` folder;
- your `.env` file, if you make one.

None of them belong in the repository; `.gitignore` already excludes them.

---

## Step 1: Check the project on your PC

**Files:** the whole project folder.

```powershell
npm run check
```

**Expected:**

```
  ✔ 111 scripts parse
  ✔ no keys, tokens or webhooks in the project files
  ✔ version 1.45.0
  ! release.config.json has no update key yet: builds are development builds (node scripts/release.js setup)
  ✔ tests pass

  All checks passed.
```

The `!` line is normal until step 5.

**Common errors:**

| Error | What it means and what to do |
|---|---|
| `'npm' is not recognized` | Node.js isn't installed or not on the PATH. Install it with `winget install OpenJS.NodeJS.LTS`, then open a **new** PowerShell window. |
| `✖ tests fail` | The failing test names are printed. Run `npm test` to see details, and don't release until it passes. |
| `✖ … looks like it contains a secret` | That file has a token or key in it. Remove it from the file (tokens belong in the dashboard, which keeps them in `data\`). |

Then try the tracker the way a user will: `npm run build-installer`, run `dist\SoF-Tracker-Setup-1.45.0.exe` and check the dashboard opens. A development build doesn't check for updates; that's expected at this point.

## Step 2: Install Git and the GitHub command-line tool

```powershell
winget install --id Git.Git -e
winget install --id GitHub.cli -e
```

Close PowerShell and open a new window (so it finds the new programs), then check:

```powershell
git --version
gh --version
```

**Expected:** `git version 2.x` and `gh version 2.x`.

**Common error:** `winget` is not recognized. Install **App Installer** from the Microsoft Store, or download Git from https://git-scm.com/download/win and the GitHub CLI from https://cli.github.com.

## Step 3: Create your GitHub account and sign in

1. Go to **https://github.com/signup** and create an account. The user name becomes part of the download addresses, e.g. `github.com/<name>/sof-tracker`.
2. Turn on two-factor authentication: **https://github.com/settings/security → Two-factor authentication → Enable**.
   - This is important. With your account, someone could replace the setup that **new** users download. Existing trackers would still refuse anything not signed with your key.
3. Pick an email address to show in your commits: **https://github.com/settings/emails**.
   - Tick **Keep my email addresses private**.
   - Copy the `…@users.noreply.github.com` address it shows.
4. Sign in the command-line tool:

   ```powershell
   gh auth login
   ```

   Choose **GitHub.com → HTTPS → Yes (authenticate Git) → Login with a web browser**, then enter the code it shows on the web page.

**Expected:** `✓ Logged in as <name>`.

## Step 4: Create the repository and push the code

**Folder:** the project folder.

```powershell
git init -b main
git config user.name "<your GitHub name>"
git config user.email "<the noreply address from step 3>"
git add .
git status
```

**Check the list `git status` prints before going on.** It must not contain:
- `data/`, `dist/`, `backups/` or `.env`;
- any `.pem` file.

`.gitignore` excludes them. Also check `test/fixtures`: its pictures are screenshots of your own Status window, which show your character's name and stats. Remove them now if you'd rather not publish them; the tests that use them skip themselves when the files are missing.

```powershell
git commit -m "SoF Tracker 1.45.0"
gh repo create sof-tracker --public --source . --remote origin --push --description "Live stats tracker for Scions of Fate"
```

**Expected:** `✓ Created repository <name>/sof-tracker on GitHub` and `✓ Pushed commits`. Open `https://github.com/<name>/sof-tracker`: the README is shown.

**Common errors:**

| Error | What to do |
|---|---|
| `Author identity unknown` | Run the two `git config` lines again. |
| `name already exists on this account` | Use another name, e.g. `gh repo create sof-tracker-app …`, and use that name everywhere below. |
| You pushed something private by mistake | Make the repository private at once (**Settings → General → Danger zone → Change visibility**). Remove the file, and change any token or password it contained: deleting it from the repository doesn't remove it from the history. |

Then, on the GitHub website, open the repository's **Settings**:
- **Code security → Private vulnerability reporting → Enable**, so people can report security problems privately (see `SECURITY.md`).
- **Actions → General**: leave Actions enabled. `.github/workflows/ci.yml` runs the tests on every push.

## Step 5: Create your signing key and connect the update system

```powershell
node scripts/release.js setup --repo <name>/sof-tracker
```

**Expected:**

```
  ✔ Signing key made: C:\Users\<you>\.sof-tracker-release\update-signing-key.pem
    BACK IT UP NOW …
  ✔ release.config.json: https://raw.githubusercontent.com/<name>/sof-tracker/main/updates/update.json (key …)
```

1. **Back up the key file now**, to a USB stick or a password manager's file attachment. Without it you can never publish another update to existing users, and they would eventually all be blocked when their offline grace runs out. Never email it, sync it to a shared folder, or commit it.
2. Commit the public half (it's safe to publish):

   ```powershell
   git add release.config.json
   git commit -m "Update key"
   git push
   ```

From now on, setups you build check for updates. Your own copy in the project folder is a development copy: it shows update information but is never blocked and never updates itself. Update it with git.

## Step 6: Build the first release

**File:** `package.json`, field `"version"`. It is `1.45.0`; keep it for the first release.

```powershell
node scripts/release.js build
```

**Expected:** the tests run, then:

```
Built …\dist\SoF-Tracker-Setup-1.45.0.exe (… KB)
  ✔ SoF-Tracker-Setup-1.45.0.exe  … bytes  SHA-256 <64 characters>
```

`dist\release-1.45.0.json` records the fingerprint.

**Common errors:**

| Error | What to do |
|---|---|
| `Not set up yet` | Do step 5 first. |
| `compiling the setup failed` | The C# compiler is part of Windows (.NET Framework 4); run `installer\build.ps1` directly to see its error. |
| `is not newer than the published` | Raise the version (see [RELEASING.md](RELEASING.md)). |

## Step 7: Upload the setup to a GitHub release

```powershell
gh release create v1.45.0 dist\SoF-Tracker-Setup-1.45.0.exe --title "SoF Tracker 1.45.0" --notes "First public release.`n`nSHA-256: <paste the fingerprint from step 6>"
```

On the website instead: go to **https://github.com/<name>/sof-tracker/releases/new**, then:
1. Tag `v1.45.0` (create it).
2. Title `SoF Tracker 1.45.0`.
3. Drag the `.exe` into the files box.
4. Paste the SHA-256 into the notes.
5. Click **Publish release**.

The tag must be exactly `v` plus the version, and the file name must stay `SoF-Tracker-Setup-1.45.0.exe`. The update file points to `…/releases/download/v1.45.0/SoF-Tracker-Setup-1.45.0.exe`.

**Expected:** the release page shows the `.exe` under **Assets**.

## Step 8: Publish the update file

```powershell
node scripts/release.js publish --notes "First public release"
```

This downloads the setup from GitHub, exactly as a tracker will, and checks it matches your build. **Only then** does it sign the update file, so nobody can be told about an update whose setup isn't there yet.

**Expected:**

```
  … downloading https://github.com/<name>/sof-tracker/releases/download/v1.45.0/SoF-Tracker-Setup-1.45.0.exe to check it
  ✔ the uploaded setup matches the build
  ✔ updates\update.json signed (number 1): latest 1.45.0, minimum 1.45.0
```

Make it live:

```powershell
git add updates
git commit -m "Release channel: 1.45.0"
git push
```

**Common error:** `The uploaded setup is not right yet: the server answered 404`. The release isn't published (it's a draft), the tag isn't `v1.45.0`, or the file name differs. Fix it on the release page and run `publish` again.

## Step 9: Check it like a user's tracker would

Wait a minute or two (GitHub caches `raw.githubusercontent.com` for up to 5 minutes), then:

```powershell
node scripts/release.js verify
```

**Expected:**

```
  ✔ live update file: signed correctly, number 1, latest 1.45.0, minimum 1.45.0, offline grace 168 h
  ✔ download of 1.45.0 matches its fingerprint
```

Then install the setup from the release page on your PC (or better, a second PC or a Windows virtual machine). Open the dashboard and go to **Settings → Updates → Check for updates now**. It should say **up to date**.

## Step 10: How users get it

Send people the link **`https://github.com/<name>/sof-tracker/releases/latest`**. They:
1. download `SoF-Tracker-Setup-<version>.exe`;
2. run it, clicking **More info → Run anyway** if Windows SmartScreen warns;
3. let it install Node.js if asked;
4. pick their game folder if it isn't found;
5. find the gold **S** in the tray.

The README's **Install** section says the same for them.

## Step 11: Test that an outdated version is blocked (do this once, before announcing)

Use a second PC or a virtual machine with version 1.45.0 installed from step 10. Windows 11 Pro has **Windows Sandbox** (Settings → Optional features); there, install Node.js first, since a sandbox starts empty.

1. On your PC, raise the version to 1.45.1 (`npm version patch --no-git-tag-version`) and build it:

   ```powershell
   node scripts/release.js build
   ```

2. Upload it as release `v1.45.1` (step 7, with the new names).
3. Publish it as **required**:

   ```powershell
   node scripts/release.js publish --minimum 1.45.1 --notes "Test of a required update"
   git add updates; git commit -m "Release channel: 1.45.1 (required)"; git push
   node scripts/release.js verify
   ```

4. On the test PC, open the dashboard and click **Settings → Updates → Check for updates now** (or restart the tracker).

**Expected on the test PC:**
- The dashboard, overlay and phone page show **"Update required"** and nothing else. There's no close button, reloading or restarting the tracker shows it again, and the tray shows a notification.
- Clicking **Install the update** shows the download progress. The setup runs and the tracker restarts as 1.45.1, and the dashboard reloads normally.
- **Settings → Updates** says **up to date**, and the alert log has **"Updated to SoF Tracker 1.45.1"**.
- Your data (sessions, settings) is still there.

Also try:
- **Unplugged:** with the network unplugged, restarting a blocked tracker keeps it blocked.
- **Failed download:** while the download runs, pulling the network cable gives a "did not work" message with **Try again**.

## Step 12: Announce it

Only now share the link. From here on, every new version follows [RELEASING.md](RELEASING.md).
