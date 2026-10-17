# Security

## Reporting a problem

Please report security problems privately through **GitHub → Security → Report a vulnerability** on this repository. Don't open a public issue. You should get an answer within a week.

## How the tracker protects you

- **It only listens on this PC.** The dashboard is at `127.0.0.1:7777`. Phone view (`start-phone.bat`) opens it to your home network, and every other device then needs a random access key. The key is in `data\lan-key.txt`; delete that file and restart to change it.
- **Other websites can't use it.** Every request is checked (`lib/guard.js`):
  - The `Host` header must be `localhost`, a loopback address or, in phone mode, a private-network address. This stops DNS rebinding.
  - Requests started by another website are refused, based on their `Origin` and `Sec-Fetch-Site` headers. This stops cross-site request forgery.
- **Updates are signed.** The update file (`updates/update.json`) is signed with the publisher's Ed25519 key. Trackers carry the matching public key in `release.config.json`. A setup is installed only if its SHA-256 fingerprint and size match the signed file. It is downloaded over https from GitHub's hosts only, checked again right before it runs, and then confirmed after the restart. An older update file is never accepted over a newer one, so an old, more lenient file can't be replayed.
- **No secrets in the program files.** Tokens you enter stay in `data\` and are shown masked. The release signing key is kept outside the project (`%USERPROFILE%\.sof-tracker-release\`), and `npm run check` and the packer refuse files that look like keys.

## Mandatory updates: what they can and can't do

When the publisher raises the minimum version, or withdraws a version, the tracker blocks itself:

- its data routes answer `426`;
- the live feed carries only the update screen;
- the screen reader, alerts and the Discord bot stop;
- every page shows an update screen that can't be dismissed.

The verdict is stored, so restarting without internet doesn't lift it. A copy that can't reach the update server for longer than the offline grace (7 days by default, set in the signed file) is blocked until a check succeeds.

**Limits:**

- **It runs on the user's PC.** The tracker has no server of its own that its features depend on. Everything runs from readable files on the user's PC. Someone who edits those files, for example deleting the update key from `release.config.json` or changing `lib/updater.js`, can remove the check. The signature guarantees that updates come from the publisher and haven't been changed; it can't stop a user from modifying their own copy.
- **The clock can be turned back.** Turning the PC clock back by more than 6 hours from the latest time the tracker has seen doesn't extend the offline grace. Smaller changes can.
- **The setup isn't code-signed.** Windows SmartScreen therefore warns about it the first time it's downloaded with a browser. In-app updates are verified by their signed fingerprint instead. An Authenticode certificate removes that warning; see `docs/RELEASING.md`.
