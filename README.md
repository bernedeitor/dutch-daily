# Dutch, daily

An installable, mobile-first Dutch flashcard PWA converted from your supplied Python/Tkinter application. No runtime dependencies, account inside the app, API keys, Python audio packages, or build step are needed. The public app contains the two original decks; personal progress stays on the device and is never committed to this repository.

## On your iPhone

1. Open the GitHub Pages link in **Safari**. No ChatGPT sign-in is required.
2. Tap **Share → Add to Home Screen → Add**. Keep **Open as Web App** enabled if shown.
3. Open the new Home Screen app while online. Wait for **Ready offline** in the header.
4. Both original decks are included. To continue existing progress, use **Settings → Import progress** with your private full backup or Python v2/v3 JSON. Use a recent export if you have studied since that backup.

Safari and an installed Home Screen app can have separate storage. If you have studied in Safari before installing, export a full backup there and import it **inside the installed app**. Progress also stays separate across browsers, phones, and hosting addresses; transfer it with a backup.

The app, decks, and progress work offline after successful caching. Audio uses the browser/iPhone's **native Dutch `nl-NL` speech synthesis**. For offline audio, download a Dutch voice under iPhone **Settings → Accessibility → Spoken Content / Read & Speak → Voices**; labels depend on your iOS version. The voice must be exposed by Safari. Settings shows whether a listed voice is local. Try it in airplane mode before relying on offline speech. Initial audio requires a tap; Listening then plays on each new card. No audio files or online TTS service are used.

## GitHub Pages

In repository **Settings → Pages**, choose **Deploy from a branch**, select **main** and **/docs**, then **Save**. The contents of `docs/` are the complete app. No build command, database, Vercel account, or API key is needed. Later commits to `main` publish automatically. `.nojekyll` prevents Jekyll from modifying the static files.

## Deploy on another static HTTPS host

Upload the **contents of `docs/`** to your host's web root, or to a subdirectory. Keep all paths and filenames intact. There is no compilation step. Set the publish/output directory to `docs` when deploying this repository.

- **Netlify:** drag the `docs` folder onto Netlify Drop, or connect the project with publish directory `docs` and no build command. `_headers` is supplied.
- **Cloudflare Pages / GitHub Pages / another static host:** publish `docs`. Serve `.js` as JavaScript and `.webmanifest` as `application/manifest+json` (JSON is also accepted by browsers). Ensure `sw.js` is revalidated rather than given immutable long-lived caching.
- The app supports hosting at `/` and under a path such as `/dutch/`. Manifest, module, CSV, icon, and service worker paths are relative.
- HTTPS is required on an iPhone. `file://` and an ordinary LAN `http://` address do not enable the installable offline experience.

To edit the app: change `docs/`, then run **`node scripts/prepare.mjs`** to update the service worker asset list and cache version before uploading. Keep the hosting address stable to retain device-local progress. An updated app offers an **Update app** button after saving progress.

For desktop development only: `python -m http.server 8000 --bind 127.0.0.1 --directory docs` and open `http://localhost:8000`. This is not an iPhone deployment. `START_LOCAL.bat` provides the same command on Windows.

## Included content and compatibility

- `500_common_dutch_flashcards.csv`: all 500 original Dutch entries and their Italian / English / Spanish meanings.
- `100_common_dutch_phrases.csv`: all 100 original phrases and meanings, recovered from your earlier app package.
- Both public progress templates are empty. A fresh installation starts with **20 learning, 0 learned, 480 remaining** for the 500-word deck. Listening initializes its own separate pool when opened. The phrase deck has 100 cards.
- Personal progress is imported privately through Settings and saved in IndexedDB. Do not upload personal backups or progress histories to this public repository. Changing the hosting address requires exporting and importing a backup; browser storage does not transfer automatically.

The port retains the source scheduler: up to 20 initial learning cards; uniform random choice with no immediate repeat when the selected pool has alternatives; Normal **4 learning + 1 learned**; due learned cards preferred on learned turns; review cards still appear before their due date; Mix Everything includes learning + learned and excludes unseen cards. When there are no learning cards, learned cards continue to be offered.

Ratings are **Failed / Hard / Good / Easy = 0 / 1 / 2 / 3**. The first rating sets the score; subsequent scores use the original 0.30 EMA. Graduation requires at least 4 reviews and a score of at least 2.4. Failure returns a learned card to learning; as in the Python version, this can temporarily exceed 20 learning cards. Initial intervals (1 / 2 / 4 days), due interval multipliers (1.25 / 2 / 2.8), early-review behavior, and the source's stored interval cap/date arithmetic are retained. Calendar times use UTC, including old timezone-less timestamps. Exact random card sequences can differ between languages.

The four stats are Learning, Learned, Due (a subset of Learned), and Remaining (unseen). Session counts restart when changing deck/mode or reopening, as in the original. Selection counters and Mix settings remain separate per deck and mode. The PWA additionally saves a selection counter immediately when showing a new card, so an abrupt phone closure is less likely to lose that setting.

Spelling ignores case, repeated spaces, and trailing `. ! ? …`; accents and other spelling remain significant. A result never rates itself: you select a rating after checking or revealing the answer.

## Decks, imports, and backups

**Add CSV:** use the `+` button. The first two columns must contain Dutch and meaning, with a header row. Comma, semicolon, tab, BOM, CRLF, quoted commas, multiline fields, and escaped quotes are supported. Empty or duplicate Dutch rows are skipped, matching the original. Adding a CSV with the same filename updates that deck while retaining matching progress in both modes. Unmatched states are kept for a corrected CSV.

**Export full backup:** saves every deck (including imported decks), both progress tracks, selected deck/mode, and audio preferences in one JSON. Import it on another device to continue. On iPhone, check Files → Downloads, or use Share → Save to Files if the browser shows a file preview.

**Import progress:** accepts full PWA backups and existing Python v2/v3 JSON. A preview shows the affected deck and matching states before you apply it. v2 imports affect Flashcards only and leave Listening progress intact. v3 imports replace the tracks present in the file. Word keys are matched exactly first, then by case/Unicode normalization when practical. Ratings, scores, reviews, intervals, and due dates are retained. Malformed files are rejected before changing data.

**Export current deck JSON:** produces Python-compatible v3 progress. Copy it back to the Python app's `progress/<deck-stem>.json`, beside the matching CSV. Both tracks are included. **Export current deck CSV** exports the actual deck content.

Imports and current-mode resets keep one local restore point. **Settings → Undo last import or reset** restores it. The restore point is intentionally not included in exported backups. Full backup restoration replaces all current decks and progress; the import preview says so explicitly.

Progress is stored in **IndexedDB** with atomic transactions. Saves are serialized; another tab cannot silently overwrite newer progress. Storage failures pause further edits and offer an emergency export. Device-local storage is not cloud synchronization. Export occasional backups, especially before clearing browser data, switching phones, or moving hosts.

## Tests and verification

Run with Node 22.18+ (or Node 24) and Python 3:

```sh
npm run prepare:pwa
npm run check
npm test
```

The runtime app itself needs neither Node nor Python. There are no npm dependencies to install.

The tests exercise:

- 800 rating transitions against the exact extracted Python scheduler: scores, reviews, status, rating history, intervals, and dates.
- Uniform choice across all 20 active cards, Normal 4+1, due preference, Mix Everything, graduation/refill, failure reentry, small decks, and UTC parsing.
- Empty public templates, v2/v3 migration, CSV edge cases, backup roundtrips, validation, and unusual word keys.
- Serialized persistence, reopen, cross-tab conflicts, failed writes, and local Dutch speech selection with test doubles.
- Controller flows for reveal/rate, correct/incorrect spelling, independent modes/decks, custom CSVs, import previews, exports, resets, undo, and persisted relaunch.
- Service-worker precaching, offline navigation and assets, subdirectory scope, updates, status verification, atomic cache-install failure, and unrelated request passthrough in a worker harness.

**Verification limit:** automated logic/controller/static checks cover the scheduler, data, imports, and offline worker. Desktop browser checks can verify the published app, but physical iPhone installation, iOS file dialogs, and actual iPhone voice playback still require an on-device check. `TEST_RESULTS.md` records the final run. `IPHONE_CHECKLIST.md` is the short on-device acceptance check.

Technical references: [WebKit Home Screen web apps](https://webkit.org/blog/13878/), [WebKit service workers](https://webkit.org/blog/8090/workers-at-your-service/), [available native voices](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/getVoices), [local versus remote voices](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisVoice/localService).
