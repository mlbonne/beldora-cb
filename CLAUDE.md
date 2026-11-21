# Beldora Character Builder (Beldora CB) — project notes for Claude

Formerly "Tomebinder". The folder and some identifiers still use that name: `tomebinder/`, `tb-*.html`, `/__tb/`, `TBRules`, `tbNative`.
It's a D&D 2024 companion app built on the open-source 5etools site.

## Current versions (2026-11-21)
- **Desktop installer:** `Beldora-CB-Setup-1.7.1.exe` (package.json 1.7.1).
- **Interface:** `ui/version.json` = `{"version": "1.8.4", "minApp": "1.5.0", "minAndroid": "1.7.0"}`, published to the in-app updater on 2026-11-21 (desktop and Android get it).
- **Web:** 1.8.4 (deployed 2026-11-21), live at https://beldora-cb.beldora-cb.workers.dev (Cloudflare Worker `beldora-cb`). Installable as an app (manifest with 192/512 icons, apple-* tags).
- **Tablets:** the user runs the web app installed on a tablet in portrait. Tablets get the full app (phone layout only when the screen's short side < 600 px, the window < 520 px, the Android app, or `?phone`; `?full` forces full). Under 1350 px the Play sheet gets `.pl-tablet`: the three columns laid out at 980 px and scaled with CSS `zoom` (`fitSheet` in view-play.js); `.pl-touch` (coarse pointer) enlarges targets.
- **Android APK:** 1.7.0, versionCode 6 (`mobile/android/app/build.gradle`). The user has it installed. The next APK needs versionCode 7 or higher.
- **Pending:** confirm with the user that the Android in-app update to 1.7.1 (phone header fix) worked. It's the first real Android update.

## What the app does
- **Characters:** a Forgesteel-style step builder. Only legal options are offered, and prerequisites are enforced. Tabs: Character, Builder, Book, Export.
  - XP bar: Level up becomes available when the bar is full. Force level up / Revert / Keep are on the Start step.
  - Export has a level-up plan: planned subclasses and multiclass, shown in the booklet and cheat sheet.
  - Spellcasting ability is shown everywhere: Character page, sheet, booklet, cheat sheet and Play. Spells granted with another ability (species, feats, subclass) are tagged and use their own DC and attack. The builder prompts wherever the rules give a choice; "inherit" means the ability the feat increased.
  - Subclass casters (Eldritch Knight, Arcane Trickster, Warrior of the Mystic Arts) get cantrip and spell prompts from their list. 2014 prepared casters use "level + modifier".
- **Exports (PDF):** booklet (Paged.js), cheat sheet, skill cards, character sheet. Desktop also makes a folded booklet (pdf-lib).
- **Encounters:** CR/XP budgets (2024 DMG; 2014 multiplier optional), random encounters, d8 loot table (one GP option), XP per PC, extra monster actions, encounter PDF.
- **Play (live sheet):**
  - **Layout (1.8, Roll20-style):** top bar (Advantage/Normal/Disadvantage, who rolls, End session); header card (portrait + level badge, XP, Proficiency, Initiative, spellcasting, Inspiration) and HP card | Abilities (red shields) + Saving Throws; then Skills | tabbed centre menu | Defenses, Conditions, Senses, Proficiencies & Languages, Session XP, Roll log.
  - **Centre menu tabs:** Actions (the old Actions card, turn bar, form, summons, slots, Active Effects) · Features & Traits (expand in place, Use buttons) · Equipment (session inventory) · Notes · About. `S.mainTab` holds the tab.
  - **Notes (1.8.3, `notes-hub.js` = TBNotes, `notes.css`):** one notes book per character per **day** (`notesOf: charId`, `sessionDate`, chapters with genKey `session-notes` / `session-clips` / `session-homebrew`); a session on a day that already has notes reuses that book (`TBNotes.dayBook`). The session book is the clip target (old target restored at End session); Quick add and wiki clip mode land in it. End session keeps it (dated) or drops it if empty.
    - **Lines:** each top-level `<p class="tbn-line">` of the book's "Session notes" item is one line (old paragraph notes read as lines). Formatting is classes only: `tbn-hl-<color>` (mark), `tbn-c-<color>`, `tbn-sz-s|l`, plus b/i; `TBNotes.cleanLine` whitelists. content.css prints them.
    - **The hub** (`TBNotes.hub(char, {sessionBook, extras, onCounters, openBook})`): Important notes (`char.importantNotes`), the composer (Play: this session; character page: today; Enter sends a line, Shift+Enter breaks it, ✎ edits a line, Edit edits the whole day), the GitHub-style Diary calendar (last year or a chosen year; a day without notes asks "Add a note?"), the opened day (edit, tick lines → "Add selected to important notes", Close), HB Counters, then the extras (Play: Homebrew + From the wiki; character page: Homebrew added straight to the character).
    - **Where:** Play's Notes tab, and the character page's **Notes** tab next to Features & traits (the old Notes card is gone).
    - **HB Counters:** `char.counters` [{id, name, value, min, max}], live on the character (not in `char.play`, so Play undo doesn't touch them). Shown under Saving Throws on the Play sheet, on the phone Stats tab (when any) and under the stat tiles on the character page.
  - **Homebrew:** `P.homebrew` during the session (`sessionChar` merges it), `char.homebrew` after End session. Types: item (goes into session gear with `homebrew: true, desc`), feat, feature, action (`eco`), skill (`skill`), tool, language. hero-rules applies skill/tool/language grants and `featureList` lists feats/features/actions as kind "Homebrew".
  - **About:** the builder's Details, edited into `P.about` (portrait too) and written by `TBPlay.applySessionExtras` at End session.
  - **Basics:** HP and temp HP, Hit Dice, rests, conditions, Exhaustion (applied to d20 tests and Speed), and the player's own bonuses on AC, Initiative, Speed and PB.
  - **Effects catalog** (play-effects.js): spells, features and actions apply their numbers, and an Active Effects block shows what's in force.
  - **Forms and summons:** forms show on the page; summons get scaled stat blocks.
  - **Session inventory:** the session works on a copy of equipment and coins. End session lists the changes and can write them to the character.
  - **Dice modes:** the app rolls; I roll everything; I roll and the app asks only for some rolls. In the third mode, damage to others and tests that change nothing on the sheet aren't asked for.
  - **Outcomes:** hit/miss and success/failure, with triggers (play-triggers.js): smites only on a hit, Sneak Attack, Guided Strike, Tactical Mind, Indomitable, Concentration saves and others. `docs/play-coverage.md` lists every feature and spell with how it's handled.
- **Invocations and other optional features (1.8.3):** hero-rules `optFeatureGrants` applies their `additionalSpells` (innate ones get `free: {will}` or `{uses, rest}`, cast without a slot in Play and tracked as a resource), `featProgression` (Lessons of the First Ones → Origin feat) and cantrip picks (Agonizing Blast / Eldritch Spear / Repelling Blast → `derived.cantripBoosts`; auto-picked when only one cantrip qualifies). Play adds CHA to Agonizing Blast damage, notes Repelling Blast pushes, gives Eldritch Mind Advantage on Concentration saves, lists Devil's Sight / Witch Sight / Gift of the Depths in Senses, and shows passive options as rows in Actions (Cast button when they grant one spell). `spellMatches` understands the `components & miscellaneous=ritual` filter (Pact of the Tome).
- **Dropdowns on touch screens (1.8.3, ui.js `touchSelects`):** on web touch devices (not the Android app) a tap on any `<select>` opens the app's own list (`TBUI.selectSheet`) and fires input/change; added because native pickers failed in the tablet web app. Opt out with an ancestor `.tb-native-select`.
- **Store:**
  - Opens only during a Play session.
  - Vendors are built from item types, since 5etools has no shop categories.
  - Prices follow the 2024 PHB/DMG: rarity values, consumables at half, scrolls at 2× scribe cost. The settlement limits which magic items are for sale.
  - Selling gives half for gear and full value for treasure.
  - Bartering uses Influence-style checks with the Play roll engine, plus spells and traits.
  - Lists show 25 items per page.
- **Wiki and clipping** (desktop and web only): browse 5etools and clip into character or DM books.
- **App Files** (desktop): Saves, Exports, images, the 5etools updater (GitHub releases), and the Beldora CB updates card.
- **Phone layout** (Android app; web under 760px wide or with `?phone` in the address):
  - Bottom tabs Build · Play · Store · More. More holds Encounters and App updates, plus Wiki and Books on the web.
  - Play: a fixed vitals strip with tabs Act, Spells, Stats, Gear, Log (swipe or tap).
  - Store: a vendor grid, then Buy / Sell / Barter / Cart inside a vendor.
  - Dialogs open as bottom sheets.

## Hard requirements from the user
- **Desktop: nothing in AppData.** Everything lives in the install folder: Saves (Characters, Books, Encounters), Exports, images, 5etools, and System (Electron profile and ui-updates).
- **Release in stages:**
  - New features are built and tested in the **desktop exe** first and shipped through the in-app updater.
  - Web and Android are updated only after the user is satisfied or asks.
- **PDFs must be tight:** no blank pages. The cheat sheet skips generic actions and conditions. Page numbers appear only in the TOC and Page columns.
- **UI wording and look:** say "Character", never "Hero". The logo is a red boar. There's no pinch zoom, and the scroll never jumps.
- **Rules accuracy:** follow 2024 rules accuracy and do the math for the player.

## Layout (inside `tomebinder/`)
- `main.js`: Electron main process.
  - ROOT is `BELDORA_HOME`, else the exe folder, else `dev-home/`.
  - Store files and encounter export.
  - In-app UI updates: `activeUiDir`, `UPDATE_URL`, `appupdate:*` IPC, `installBundle`.
  - Self-test dispatch.
- `server.js`: static server, 127.0.0.1:47615, serving the site plus `/__tb/` (ui). `preload.js`: `window.tbNative`. `updater.js`: the 5etools updater.
- `selftest.js`: headless tests (see below).
- `ui/tb-app.html`, plus the print pages `tb-print/cheat/sheet/cards/encounter.html` and `tb-boot.html` (the Android boot page).
- `ui/js` key files:
  - **Characters and data:**
    - `hero-rules.js`: `TBRules.analyze`, derived stats, `castFor`, spell abilities, subclass casters, Jack of All Trades.
    - `data.js`, `view-builder.js`, `view-hero.js`, `leveling.js`.
  - **Exports:** `bookgen.js`, `print.js`, `cheat.js`, `sheet.js`, `export-data.js`, `cards.js`.
  - **Encounters:** `encounter-data.js`, `view-encounters.js`.
  - **Play:**
    - `play-rules.js` (TBPlay): state via `stateOf`, `effective`, rolls and `test` with outcomes, dice modes, resources, slots, forms, summons, session gear.
    - `play-effects.js` (TBEffects), `play-triggers.js` (TBTriggers).
    - `view-play.js`: desktop three-column layout plus the phone layout.
    - `play-coverage.js`: writes the coverage report.
  - **Store:** `store-data.js` (TBShop: vendors, prices, barter rules), `view-store.js`.
  - **Updates:** `app-update.js` (updater card), `android-update.js` (Android updater).
  - **Web and Android:** `native-web.js` (web/Android `tbNative` shim), `app.js` (navigation, phone bottom bar).
- `ui/css`: `play.css`, `store.css`, `encounters.css`, `mobile.css` (under 860px), `phone.css` (the tb-phone layout).
- `ui/version.json`: the interface version for updates.
- `scripts/`:
  - `stage-site.js` → `site-bundle/`.
  - `build-web.js web|mobile` → `web-dist/` or `mobile/www/`. It also writes `__tb/version.json`, plus `__tb/shell.json` for mobile, and makes the mobile `index.html` the boot page.
  - `publish-update.js` (uploads to Cloudflare KV), `serve-web.js`, `android-icons.py`.
- `cloud/worker.js` + `wrangler.jsonc`: the Cloudflare Worker.
  - It serves web-dist/ and the update API (`/api/updates/manifest`, `/api/updates/bundle/<v>`).
  - KV `UPDATES` id 51bfce8dafe44821a3bc9be0034ec67a.
- `mobile/`: Capacitor app. appId `app.beldora.cb`; plugins: filesystem, share and BeldoraPrint (Java).
- In dev, the app expects the 5etools site as the **parent folder** (`../`).

## Build, publish and test (run in `tomebinder/`)
- Dev run: `npx electron .`
- **Ship an interface update** (most rounds):
  1. Bump `version` in `ui/version.json`.
  2. Run `node scripts/publish-update.js --notes "..."`.
  3. Poll `https://beldora-cb.beldora-cb.workers.dev/api/updates/manifest?t=<random>` until it shows the new version. KV lags up to ~60 s.
- **Web:** `node scripts/build-web.js web && npx --yes wrangler deploy`. A new machine needs `npx wrangler login` once.
- **Windows installer:** `npm run dist` → `dist/Beldora-CB-Setup-<ver>.exe`.
  - Bump `package.json` "version".
  - **This rebuilds `dist/win-unpacked`, which the user runs with real data inside.** Back up its Saves, Exports, System and images first and restore them afterwards.
  - Raise `minApp` when main.js or preload.js change.
- **Android:**
  1. Run `node scripts/build-web.js mobile`.
  2. Run `cd mobile && npx cap sync android`.
  3. **In PowerShell:** `cd mobile\android; .\gradlew.bat assembleRelease` (`npm run build:android` fails at the gradlew step from Git Bash).
  - Output: `mobile/android/app/build/outputs/apk/release/app-release.apk`.
  - Bump versionName/versionCode in build.gradle. Raise `minAndroid` when the shell changes (plugins, tb-boot.html).
  - Needs JDK 21 and the Android SDK; `mobile/android/local.properties` holds `sdk.dir`.
  - Signed with `mobile/android/beldora-release.jks` + `keystore.properties`. **Never lose these.**
- **Headless self-tests:** `TOMEBINDER_SELFTEST=<outdir> TOMEBINDER_<MODE>=1 BELDORA_HOME=<tmp>/home npx electron .`
  - Always set a throwaway `BELDORA_HOME`. From bash, stdin should come from /dev/null.
  - **The D: PC (2026-11-21) has Node 24 on PATH; the old C: PC had none.** Use the project's Electron as Node: `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe --check file.js`, and run self-tests with `node_modules/electron/dist/electron.exe .` instead of `npx electron .`.
  - **Modes:**
    - `FORMS`: Temporary Form and Companions & Summons cards in the 1.8 sheet (Wild Shape + Summon Beast, Find Familiar + Summon Fey) at desktop, tablet and phone sizes.
    - `SHEET`: the 1.8 tabbed Play sheet: Features, Equipment, Notes hub (chat lines with formatting, clip, every homebrew type, diary day prompt, line edit, Important notes, HB Counter), About, End session write-back, character-page Notes tab, a Warlock 2's invocations (Agonizing Blast damage, Armor of Shadows at will), phone tabs.
    - `PLAY`: Play tab, Polymorph, Summon Beast, cheat-sheet plan.
    - `STORE`: gating, prices, pages, barter, buy/sell, End session write-back.
    - `DICE`: dice modes, smites, Sneak Attack, Tactical Mind, Concentration.
    - `SPELLABILITY`: builder prompts, Play header, True Strike/Shillelagh, the three PDFs.
    - `SUBCLASSES`: every class × subclass at levels 1, 3, 5, 11 and 20 (1,455 builds).
    - `COVERAGE`: regenerates `docs/play-coverage.md`.
    - Also `ENC`, `DM`, `SMOKE`.
    - `BELDORA_UPDATE_URL=<url>` with `PLAY` tests the updater.
  - Output is JSON plus PNG screenshots and PDFs in `<outdir>`; failures go to `<outdir>/error.txt`.
  - The packaged exe accepts the same variables.

## Gotchas learned the hard way
- **Patching files from bash:** heredocs and sed mangle backslashes in JS regexes (`\b` turned into a backspace character, `\w`, `\$`). Write patch scripts with the Write tool (Python, forward-slash paths) or use the Edit tool for regex lines. Check with `node --check`.
- **Strings in self-test code:** test code passed to `executeJavaScript` inside a JS template literal needs `\\n` in regexes; `\n` becomes a real newline and a syntax error.
- **Play state:** `TBPlay.stateOf` must fill the state in place, because callers keep references to it.
- **Effective numbers:** `effective()` must run before `test()`, since it feeds the passive map.
- **5etools data quirks:**
  - Subclass level-3 features are often nested inside the subclass intro feature's entries. Look inside nested named entries (see `feats()` in play-triggers.js).
  - Subclass caster progressions live on the subclass, and spell lists are named in text ("Wizard spell list").
  - `additionalSpells.ability` can be `{choose}`, a fixed ability, `"inherit"`, or missing (read the text).
  - Scaling dice below the first step return nothing (that was the True Strike bug).
- **Selectors:** the Store shows Play's Inventory card too, so scope selectors with `#view-store` / `#view-play`.
- **KV updates:** they aren't instant; poll before announcing.
- **The in-app browser test pane:** it reloads top-level pages that rebuild themselves (boot page), so test the Android boot page inside an iframe. `tb-boot.html` builds the page with DOM calls plus a synthetic `load` event (no `document.write`).
- **Older notes:** Paged.js page numbers are stamped spans (`.tb-pnum`). `table.ve-stats` is flattened before pagination. `updater.js` must be listed in package.json build `files`. The builder restores the scroll on every re-render.

## Transcripts
The handoff folder has the full history of the two long sessions (`*-transcript.jsonl`). Search them for exact old code or errors when needed.
