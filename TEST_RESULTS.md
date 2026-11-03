# Verification results

Date: 2026-11-03 (UTC)

**36 automated tests passed; 0 failed, cancelled, skipped, or pending.**

| Check | Result |
| --- | --- |
| Exact Python scheduler oracle | 800 rating transitions matched every compared per-card state field |
| Uniform random choice | All 20 active cards sampled, no immediate repeats with alternatives; 40,000-turn distribution check passed |
| Scheduling | Normal 4+1, due preference, Mix, graduation/refill, failure reentry, early reviews, UTC dates, single-card/all-learned decks passed |
| Public templates and migration | Published templates contain no personal history; separate private backup imported successfully in Chrome and restored 133 learned / 20 learning / 347 remaining |
| Profiles | Existing database migration and undo point preserved; independent decks, ratings, mode settings, imports, resets, and saved active profile verified across two learners |
| Import/export | v2/v3, complete backups, actual CSV exports, validation, unknown keys, and corrected deck matching passed |
| Local persistence | Serialized atomic snapshots, reopen, quota/write failure, and cross-tab conflict behavior passed using an asynchronous transactional IDB double |
| Native speech integration | Local nl-NL preference, direct invocation, voice changes, offline missing-voice feedback, cancellation races, and API absence passed using speech test doubles |
| App controller | Resume, reveal/rate gating, spelling results, typing shortcuts, independent modes/decks/settings, CSV previews, imports, exports, resets, undo, and relaunch passed in the DOM harness |
| Offline worker | All 17 assets cached; subdirectory launch, query URLs, navigation/assets offline, cache status, activation/update, stale HTTP-cache bypass, failed precache, unrelated request passthrough passed in a worker harness |
| Static package | 109 unique HTML IDs; controller references resolved; responsive CSS/safe-area/reduced-motion checks; manifest, PNG sizes, cache hash, and JavaScript syntax passed |

Commands completed successfully:

```sh
node scripts/prepare.mjs
node scripts/check.mjs
node --test tests/*.test.mjs
```

The test suite includes 36 test records, counting the app controller's seven nested scenarios and its parent record. Test runtime was under 2 seconds on the supplied Node 24 environment.

## Verification boundary

Chrome preview verified profile creation, switching, persistence after reopening, and import of the two supplied progress files as a single private backup. The imported profile was named Benjamin and restored 133 learned words; the other profile retained fresh progress. The cloud browser has no Dutch voice installed, so real voice playback could not be verified. The HTTP preview cannot verify production HTTPS service-worker registration; the worker harness passed all offline checks, including subdirectory hosting. Physical iPhone installation, Safari file dialogs, and native iPhone speech still require the on-device acceptance steps in `IPHONE_CHECKLIST.md`. GitHub Pages hosting is enabled. The profile update is published through the existing repository; the deployment workflow and live app are checked separately after push.
