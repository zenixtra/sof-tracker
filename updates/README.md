# updates/

What every installed tracker reads to decide whether its version may still be used.

- `update.json` is the signed file. Trackers download it from `https://raw.githubusercontent.com/<owner>/<repo>/main/updates/update.json` (set in `release.config.json`) and check its signature with the public key there. **Never edit it by hand**: it would fail the signature check, and trackers would ignore it.
- `channel.json` is the same content, readable. It's written by `node scripts/release.js publish | revoke | set`, which re-sign `update.json` from it.

The format is described at the top of `lib/manifest.js`. The workflow is in `docs/RELEASING.md`.
