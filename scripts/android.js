#!/usr/bin/env node
// Builds the Android app (android/) into dist\SoF-Tracker-Android-<version>.apk, signed with your release key.
//   node scripts/android.js keystore   once: makes the signing key in %USERPROFILE%\.sof-tracker-release\ (back it up!)
//   node scripts/android.js build      the signed app (the version is package.json's), with its SHA-256
//   node scripts/android.js debug      a test build signed with Android's debug key (no release key needed)
// Needs Android Studio (its Java and the Android SDK); Gradle downloads itself the first time.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'android');
const KEY_DIR = process.env.SOF_RELEASE_KEY_DIR || path.join(os.homedir(), '.sof-tracker-release');
const PROPS = path.join(KEY_DIR, 'android-keystore.properties');
const die = (m) => { console.error(`\n  ✖ ${m}\n`); process.exit(1); };
const ok = (m) => console.log(`  ✔ ${m}`);
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

// Android Studio's own Java, unless JAVA_HOME says otherwise
function javaHome() {
  const c = [process.env.JAVA_HOME, 'C:\\Program Files\\Android\\Android Studio\\jbr', path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Android Studio', 'jbr')].filter(Boolean);
  const j = c.find((d) => fs.existsSync(path.join(d, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')));
  if (!j) die('Java was not found: install Android Studio (it brings its own), or set JAVA_HOME.');
  return j;
}
// the Android SDK for Gradle (android/local.properties, not committed: it is this PC's path)
function sdk() {
  const lp = path.join(APP, 'local.properties');
  if (fs.existsSync(lp)) return;
  const d = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk')].filter(Boolean).find((x) => fs.existsSync(path.join(x, 'platforms')));
  if (!d) die('The Android SDK was not found: open Android Studio once (it installs the SDK), or set ANDROID_HOME.');
  fs.writeFileSync(lp, `sdk.dir=${d.replace(/\\/g, '/')}\n`);
}
function gradle(task) {
  const env = { ...process.env, JAVA_HOME: javaHome() };
  // (on Windows the .bat runs through cmd.exe itself, so no shell is needed to start it)
  if (process.platform === 'win32') execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', path.join(APP, 'gradlew.bat'), task, '--console=plain', '-q'], { cwd: APP, env, stdio: 'inherit' });
  else execFileSync(path.join(APP, 'gradlew'), [task, '--console=plain', '-q'], { cwd: APP, env, stdio: 'inherit' });
}
const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

function cmdKeystore() {
  if (fs.existsSync(PROPS)) return ok(`Signing key already there: ${PROPS}`);
  fs.mkdirSync(KEY_DIR, { recursive: true });
  const store = path.join(KEY_DIR, 'android-release.jks'), pass = crypto.randomBytes(18).toString('base64url');
  const keytool = path.join(javaHome(), 'bin', process.platform === 'win32' ? 'keytool.exe' : 'keytool');
  execFileSync(keytool, ['-genkeypair', '-keystore', store, '-storetype', 'PKCS12', '-storepass', pass, '-keypass', pass, '-alias', 'softracker',
    '-keyalg', 'RSA', '-keysize', '3072', '-validity', '10000', '-dname', 'CN=SoF Tracker'], { stdio: 'pipe' });
  fs.writeFileSync(PROPS, `storeFile=${store.replace(/\\/g, '/')}\nstorePassword=${pass}\nkeyAlias=softracker\nkeyPassword=${pass}\n`, { mode: 0o600 });
  ok(`Signing key made: ${store}`);
  console.log('    BACK UP android-release.jks AND android-keystore.properties now, together with your update key.');
  console.log('    Every app update must be signed with this key: without it, phones refuse to install the update.');
}

function cmdBuild(debug) {
  sdk();
  if (!debug && !fs.existsSync(PROPS)) die('No release signing key yet: run  node scripts/android.js keystore  first.');
  console.log(`  … building the ${debug ? 'test' : 'release'} app ${version} (the first time Gradle downloads itself and the Android tools)`);
  gradle(debug ? 'assembleDebug' : 'assembleRelease');
  const src = path.join(APP, 'app', 'build', 'outputs', 'apk', debug ? 'debug' : 'release', debug ? 'app-debug.apk' : 'app-release.apk');
  if (!fs.existsSync(src)) die(`The build did not make ${src}`);
  const name = `SoF-Tracker-Android-${version}${debug ? '-debug' : ''}.apk`, out = path.join(ROOT, 'dist', name);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.copyFileSync(src, out);
  ok(`dist\\${name}  ${fs.statSync(out).size} bytes  SHA-256 ${sha256(out)}`);
  if (!debug) console.log(`\n  Upload it to the GitHub release v${version} next to the PC setup:  gh release upload v${version} dist\\${name}\n`);
}

const cmd = process.argv[2];
if (cmd === 'keystore') cmdKeystore();
else if (cmd === 'build') cmdBuild(false);
else if (cmd === 'debug') cmdBuild(true);
else { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 6).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(cmd ? 1 : 0); }
