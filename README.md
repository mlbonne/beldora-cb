# Beldora Character Builder (Beldora CB)

A desktop hero builder, wiki explorer and bookbinder for D&D 2024, on top of your local 5etools site.

## Installing and sharing

- **`Beldora-CB-Setup-1.5.0.exe`** is the one file to send. It contains everything needed to run: the app plus a built-in copy of the 5etools site (all rules, books, adventures, wiki pages and search). No internet is needed to use it.
- It installs per user (no admin rights) into `C:\Users\<you>\Beldora CB` by default; you can pick another folder you own. Start Menu and desktop shortcuts are added.
- The installer isn't code-signed, so Windows SmartScreen may say "Windows protected your PC": choose **More info → Run anyway**.

### Everything lives in the installation folder
Nothing is written to AppData. Inside the install folder:

| Folder | What's in it |
|---|---|
| `Saves\Characters\` | one `.beldora.json` per character (send it to a friend; a file dropped in here appears in the app on next start) |
| `Saves\Encounters\` | one `.beldora.json` per encounter |
| `Saves\Books\` | one `.beldora.json` per DM book; `Saves\library.json` keeps the order and settings |
| `Exports\` | PDFs (character sheets, cards, booklets, cheat sheets) are saved here by default |
| `images\` | 5etools artwork for the wiki (see below) |
| `5etools\` | a newer copy of the text & rules, once the updater has installed one |
| `System\` | the app's own cache and settings |

Updating to a newer installer, or uninstalling, removes only the program. A normal uninstall asks whether to delete these folders too (default: keep them).

Characters from older versions (Tomebinder, or Beldora CB 1.0 which used AppData) are imported automatically on first launch; the old files are only read, never changed.

### App Files tab
**📁 App Files** (top right, next to **⚙ Site folder**) shows where everything is, with **Open folder** buttons for the character saves, the PDF exports and the images folder, plus instructions for adding images by hand.

### 5etools updater
In App Files, **Check for updates** looks at the latest releases of
[5etools-src](https://github.com/5etools-mirror-3/5etools-src) (text & rules) and
[5etools-img](https://github.com/5etools-mirror-3/5etools-img) (images), then lets you choose what to download:
- **Text & rules** (~50 MB): downloaded and unpacked into `5etools\`; it takes over after a restart.
- **Images**: pick categories (species, classes, items, monsters, adventure art… each with its size). Only the chosen categories are fetched from the multi-part image archive, straight into `images\`; images you already have are skipped. *Recommended for players* is a few hundred MB; *Everything* is about 6.5 GB.

Images can also be added by hand: extract the image release into `images\` so it contains `adventure`, `bestiary`, `book`, `items`… (an extra `img` level also works). They appear in the wiki without a restart.

### Building
`npm install`, then `npm run dist`. It stages the site from the folder above (`node scripts/stage-site.js [siteRoot]`) into `site-bundle/` and writes the installer to `dist/`. In development, app data goes to `dev-home/` (or the folder in `BELDORA_HOME`).

## Other versions: browser and Android

All three versions share the same character files (`.beldora.json`), so a character can move between them with **Save file** / **Import**.

### Browser (`Beldora-CB-Web-1.4.0.zip`)
The complete app (wiki, characters, DM books, all exports) as a static website.
- It must be served over http(s). Double-clicking `tb-app.html` opens it as a `file://` page, and browsers forbid such pages from loading the 5etools data and from reaching into the wiki frame, so the wiki stays blank. Locally: `npm run serve:web` (or `python -m http.server` inside the folder).
- **Hosted for free on Cloudflare** (static files on Cloudflare Workers, the successor of Cloudflare Pages: static file requests are free and unlimited; limits are 20,000 files and 25 MB per file, the site is ~2,100 files / 180 MB). Live at **https://beldora-cb.beldora-cb.workers.dev**.
  - Settings are in `wrangler.jsonc` (serves `web-dist/` with paths as-is, so the app's `tb-*.html` frames keep their names; `_redirects` sends `/` to the app).
  - Every release: `npm run deploy:web` (builds `web-dist/` and uploads only the changed files). On a new PC run `npx wrangler login` once first.
  - The address is public; characters, books and encounters stay in each browser. To restrict who can open it, put Cloudflare Access (Zero Trust, free for up to 50 users) in front of it, or add your own domain in the Cloudflare dashboard.
  - Other free hosts work too (Netlify, GitHub Pages: for GitHub Pages add an empty `.nojekyll` file, or the `__tb` folder is ignored).
- Characters and books are saved in the browser (IndexedDB), per browser and device.
- PDFs open the browser's print dialog, one per document: choose **Save as PDF**. The folded-booklet print layout is desktop-only.
- Wiki artwork loads from the 5etools image repository on GitHub.
- Build: `npm run build:web` (output `web-dist/`), test with `npm run serve:web`.

### Android (`Beldora-CB-1.7.0.apk`)
Character builder, the Play sheet, the Store, the encounter builder and the exports (no wiki, no DM books), with the full 5etools database inside, so it works offline.
- **Phone layout** (also used by the web version on narrow screens, or with `?phone` in the address): a bottom tab bar (**Build · Play · Store · More**). Play keeps HP, AC, Speed, Initiative, spellcasting, the action economy and what's active in a strip at the top, with five tabs underneath (**Act, Spells, Stats, Gear, Log**; swipe or tap). The Store opens on a grid of vendors; inside one: **Buy, Sell, Barter, Cart**, with a cart bar above the tabs. Dialogs (rolls, hit/miss, menus) slide up from the bottom.
- **In-app updates** (More → App updates, and a check at start-up): the same bundles as the desktop app. Each bundle's `minAndroid` (in `ui/version.json`) is the oldest APK it runs on; raise it when an update needs something new in the APK (a plugin, the boot page). The update is kept on the phone and started by the boot page (`ui/tb-boot.html`, the APK's `index.html`); if it fails to start twice in a row, the app goes back to the version inside the APK. A new APK is only needed when the Android shell changes.
- Install: copy the APK to the phone and open it; allow "install unknown apps" for the app you open it with when Android asks.
- Exports open Android's print screen for each document; pick **Save as PDF**. **Save file** opens the share sheet (save to Files/Drive or send to a friend); **Import** opens the file picker.
- Built with Capacitor (`mobile/`); the native plugin `BeldoraPrintPlugin.java` prints the laid-out pages.
- Build: `npm run build:android` (needs the Android SDK; from Git Bash run the last step as `.\gradlew.bat assembleRelease` in PowerShell inside `mobile/android`; `mobile/android/local.properties` points to it). The release is signed with `mobile/android/beldora-release.jks` (passwords in `keystore.properties`). **Back both up**: Android only installs an update over an existing install if it's signed with the same key.
- Icons and splash come from `ui/img/boar.svg` via `scripts/android-icons.py`.

### Artwork everywhere
Images that aren't in the desktop `images\` folder are loaded from GitHub when online, so the wiki shows artwork even before you download any with the updater.

## Part 1: heroes

Characters work like [Forgesteel](https://github.com/andyaiken/forgesteel)'s hero builder, using D&D 2024 content from your 5etools copy. Each character has four tabs: **Character**, **Builder**, **Book** and **Export**.

### 1. Builder
A strip of steps along the top, each showing its state (*Not started*, *In progress*, *Completed*, *Optional*). Work through them in any order:
- **Start**: name, player, and whether legacy (2014) content is allowed.
- **Only legal options are offered.** Feats and class options (invocations, maneuvers…) are filtered by their prerequisites (level, class level, ability scores, armor training, spellcasting, required feats, pacts, known cantrips) and non-repeatable feats you already have are hidden; skills, expertise and languages you already get elsewhere are not offered again; multiclassing requires 13+ in the primary ability of your current and new class; ability increases stop at 20. The picker says how many entries were hidden. Prerequisites the app can not check (campaign- or item-specific) are allowed and marked “check prerequisite”.
- **Species**, **Background**, **Class**: pick from a grid of option cards. The chosen option is shown on the left; on the right, the **Choices** column lists every decision it asks for, grouped (General, then *Level 1*, *Level 3*…), each marked done or pending. Examples: lineage, size, species skill, background ability increases (+2/+1 or +1/+1/+1), the origin feat and its own choices (e.g. Magic Initiate spells), tool picks, class skills, subclass, Fighting Style, Ability Score Improvement or another feat (and the feat's ability choice), Weapon Mastery, Eldritch Invocations / maneuvers / metamagic, Divine and Primal Order, Expertise.
- **Class** also holds the level (− / +) and **+ Multiclass**.
- **Abilities**: standard array, point buy (27 points) or rolled/manual (with a 4d6 roller); bonuses from background and feats are added automatically.
- **Spells**: cantrips and prepared spells for each class (counts and maximum level come from the class table), spells from feats and species, always-prepared subclass spells, plus extra spells by hand.
- **Equipment**: choose starting packages A/B (items and gold are added to the inventory), add any item, mark armor and weapons as equipped (this sets AC and attacks).
- **Details**: languages, alignment, appearance, personality, ideals, bonds, flaws, backstory, portrait.

### 2. Character
Spells and cantrips expand in place to their full text, like features and traits.
The character at a glance: ability scores and saves, AC, HP, initiative, speed, proficiency, passive Perception, spell save DC, skills (proficiency and expertise), attacks, spell slots and spells, every feature and trait (filter by Action / Bonus Action / Reaction / Passive, click to read the full text). Unfinished builder steps are listed with links.
**▲ Level up** raises a class (or lets you multiclass) and opens the builder on that class, where the new level's choices wait in their own group.

### 3. Export
- **⇩ Export everything** saves four PDFs side by side: **Character Sheet**, **Cards**, **Booklet**, **Cheat Sheet**.
- **Character sheet**: page 1 is the table sheet (abilities, saves, skills, AC/HP/initiative/speed, hit dice, death saves, attacks, spellcasting and slot boxes, actions and limited-use features with use boxes, room for notes); then a features page, a spells page with prepare boxes, and an equipment and story page. Features and spells show their booklet page.
- **Cards**: poker-size cards, nine per page with cut guides, colour-coded: spells (blue), actions (red), bonus actions (orange), reactions (purple), passives (green), attacks. Long texts shrink to fit or continue on a second card; each card shows its booklet page.
- Booklet and cheat sheet options are as before; **Booklet contents** (levels covered, Actions/Conditions reference) now lives here.

### 4. Clipping from the wiki (the annex)
In the **Wiki** tab, choose the character (or a book) and the chapter in the right-hand tray, then:
- **✂ Clip mode** (`Alt+C`): hover anything (paragraph, list, table, sidebar, section, stat block, whole page). Press `↑`/`↓` or Shift+wheel to widen or narrow the highlighted piece, then click to add it. `Esc` leaves clip mode.
- **Clip page** adds the whole entry you are viewing. **Clip selection** adds highlighted text.
- Clips land in the chapter picked in the tray (the **Annex** by default for characters); "+ New chapter…" creates one on the spot.

### 5. Book tab
Arrange the codex. Drag chapters and items (or use ↑/↓), rename (✎), toggle an item's heading (H), remove (✕), add your own chapters and **notes**, and move items between chapters. "auto" items come from the Build tab and update when you change the character (**⟳ Sync**). Removed auto pages stay hidden until you **Restore** them; your clips and notes are never touched by a sync.

### 6. Booklet and cheat sheet
- **Booklet PDF**: cover, compact contents with page numbers for every item, running chapter headers, page numbers. Chapters flow continuously by default; you can start each on a new page instead. A5 / Half Letter / A4 / Letter, parchment or ink-saving white, three text sizes, accent colour. For A5 / Half Letter it can also save a folded-booklet or 2-per-sheet print version.
- **Cheat sheet PDF**: one face per class with levels 1–20, every class-table column, each feature with its booklet page and a one-line digest, plus an overview of species, background, feats, class options and spells.

## Part 2: books for the DM (not tied to a character)

The **Books** tab holds standalone books: **+ New book**, rename, duplicate, delete, save/import as a file.
1. In the **Wiki** tab pick the book in the tray ("Clipping to" → *Books*) and the chapter (or "+ New chapter…").
2. Clip anything: a monster stat block, an item, a rules table, a paragraph, a section of a sourcebook or adventure, a whole page.
3. Arrange it in the book's **Book** tab (same organiser as characters), then **Export** to an elegant PDF with the same layout options.

## Part 3: encounters

The **Encounters** tab builds balanced fights from the whole 5etools bestiary (every book, not just the SRD).
- **Party**: number of characters and their level; **+ Mixed levels** adds rows for characters of other levels. The XP budget is the sum of each character's budget.
- **Rules**: *DMG 2024* (Low / Moderate / High budgets, monster XP simply added up) or *DMG 2014* (Easy / Medium / Hard / Deadly, with the group multiplier adjusted for party size).
- **Encounter**: the budget bar shows where the fight sits; each monster has − / + count, a **lock** (random rolls keep it), **Ally / Foe** (an ally's XP is added to the budget) and ✕. Click a name for its stat block.
- **Random encounter**: pick a difficulty and a shape (solo, duo, trio, squad, mixed group, leader + minions, leader with lieutenants and minions, horde, or any). Monsters are fitted just under the chosen budget and kept on a theme (same habitat, or same creature type). **Filters**: CR range, habitat, creature type, size, legendary monsters, unique named creatures, and books (newest version of each monster by default, 2024 books only, Monster Manual 2024 only, or everything).
- **Add monsters**: search the filtered bestiary and add by hand.
- **Treasure (d8)**: eight options of about the same value, so the party rolls 1d8: 1 is always coins; then gemstones, art objects, consumables, two magic items (themed by the monsters' treasure types: Arcana, Armaments, Implements, Relics), spoils of the monsters' own gear, and a mixed bundle. Values follow the 2024 DMG (individual treasure by CR, magic item prices by rarity, rarities allowed by party level); **Loot** sets Stingy / Standard / Generous / Treasure hoard. Each option can be rerolled on its own (⟳).
- **Extra actions (d6)**: six extra options for the monsters (rally cries, reinforcements, terrain tricks for the habitat, type-specific moves for undead, dragons, fiends…), with save DCs and damage scaled to the encounter's CR.
- **XP**: each character's share and how much of a level it is.
- **Export → Encounter PDF**: page 1 is the cheat sheet (budget and difficulty, combatants with AC, HP, initiative, speed, passive Perception and HP boxes to cross off, an initiative ladder, the d6 extra actions, the d8 treasure table with item summaries, and the XP award). Then every stat block (with legendary and lair actions and regional effects) and the full text of each magic item on the treasure table. A4 or Letter, six accent colours. Saved in `Exports\`.
- Encounters are saved one file each in `Saves\Encounters\` (**Save file** / **Import** to share them).

## Part 4: the live sheet (Play tab, desktop)

**Play** turns a character into a clickable sheet for the session. Picking a character starts a session: the character list hides (the sheet gets the whole width) until **⏹ End session**, which offers to add the session's XP to the character. Everything the sheet tracks is saved with the character file.
- **🎲 I roll my own dice** (under the class line): every roll then asks for what your dice show (each d20, or the total of the damage/healing dice); the app adds the modifiers.
- **AC, Initiative, Speed and Proficiency** take your own bonus or penalty (✎): the big number is the total, with "natural X + bonus Y" underneath. A Proficiency change reaches proficient saves, skills, attacks and spell DC/attack.
- **Session XP**: add XP by hand or pick a saved encounter (its XP per character).
- **Summons and companions**: Summon Beast/Fey/Undead/…, Find Familiar, Find Steed, Animate Dead, Giant Insect, Animate Objects, Wild Companion and the Beast Master's Primal Companion open a picker of the creatures they bring, with their forms (Air/Land/Water, Demon/Devil/Yugoloth, sizes…). The stat block is worked out for the spell's slot level or your class level, with your spell attack, save DC and modifiers. Each summon gets HP, AC, damage/heal and its stat block in **Companions & Summons**, and leaves when concentration ends or it drops to 0 HP.
- **Hit points**: damage (temporary HP absorbs it first), healing, temporary HP (keeps the higher value), Bloodied, death saving throws, massive damage, and Hit Point Dice to spend (die + CON).
- **Heroic Inspiration** toggle; after a d20 roll, **★ Reroll** spends it.
- **Rolls**: click an ability, save, skill or Initiative to roll; Advantage / Disadvantage switch; a box beside each skill (and for all saves) adds a situational bonus such as `+2` or `1d4`. Conditions apply on their own (Poisoned, Frightened, Prone, Restrained, Blinded, Invisible…), and Exhaustion takes 2 per level off every d20 test.
- **Turn tracker**: Action, Bonus Action and Reaction for the round; using something marks it; **Next turn** resets them.
- **Actions** by economy (Actions, Bonus Actions, Reactions, Other & Standard): wielded weapons (attack and damage, criticals double the dice), every spell, every active or limited-use feature, consumables and charged items, and the 2024 standard actions.
- **Spells**: Cast asks which slot (upcasting scales the dice), offers ritual casting and pact slots, rolls the spell attack or states the save DC, rolls damage or healing, and tracks Concentration (damage prompts the Concentration save DC).
- **Temporary Form**: Wild Shape (Beast limits by Druid level, Circle of the Moon forms), Polymorph, True Polymorph, Shapechange and Animal Shapes open a picker of every legal creature in the bestiary; the form's Temporary Hit Points are added, its stat block is one click away, and spell forms end when those run out (or concentration ends).
- **Slots & resources**: spell slots, Pact Magic, class pools from the class table (Rages, Wild Shape, Channel Divinity, Sorcery Points, Focus Points, Lay on Hands…) and features with uses per rest.
- **Inventory**: add, remove, change quantities, equip, wear or attune mid-fight; AC, ability scores, saves, attacks, spell DCs and speed update at once.
- **Short rest / Long rest** restore what the 2024 rules restore.
- **Ask first, then spend**: every spell, feature and action asks its questions first (slot, target, form, creature, option); closing any of those menus spends nothing.
- **Effects are applied for you** (catalog in `ui/js/play-effects.js`): Bless and Guidance add their d4 to the right rolls; Shield, Shield of Faith, Haste, Mage Armor and Barkskin change AC; Haste, Dash, Longstrider and Fly change Speed; Rage adds its damage and resistances (with the Zealot, Wild Heart and Berserker riders); Hunter's Mark, Hex and Divine Favor add their dice to hits; Aid, False Life, Armor of Agathys and Heroism handle HP; Cunning Action, Monk's Focus (Flurry, Patient Defense, Step of the Wind), Lay on Hands, Font of Magic, Arcane Recovery, Channel Divinity, Second Wind, Action Surge, Battle Master maneuvers and more open the right menu. Healing spells and potions ask who is healed. Passive features such as Danger Sense, Feral Instinct and Aura of Protection are always applied.
- **Active Effects** (under Actions) lists everything in force (spells, features, actions, concentration, form, summons, conditions, Exhaustion) with what it changes and how long it lasts; **Next turn** counts durations down and ends "until your next turn" effects.
- **Speed and AC** show how they are made (natural value, items, effects, Exhaustion −5 ft. per level, conditions that stop movement).
- **Forms on the page**: while shape-shifted the form's AC, Speed, scores and traits sit under its name, saves and skills use the form's scores, and the Actions list holds the form's attacks (rollable) instead of weapons and spells.
- **Damage panel**: pick the damage type and resistances halve it; Uncanny Dodge and Deflect Attacks are options there.
- **Who rolls** (under the class line): *the app rolls*; *I roll my own dice (the app asks for every result)*; or *I roll my own dice (the app only asks for some rolls)*, which asks only for rolls that change the sheet (healing, temporary HP, Hit Dice, Concentration saves, death saves, bonus dice) or decide something (an outcome a feature, spell or effect depends on); damage you deal and checks that change nothing here are logged with the dice and bonus to roll.
- **Hit or miss, success or failure**: with physical dice the outcome buttons sit next to the result; with app dice you're asked only when something depends on it. Damage is rolled only on a hit (a natural 20 is a critical hit, dice doubled). After a hit: smite spells cast "immediately after hitting" (the slot is spent only now), Sneak Attack (once per turn), Savage Attacker, and every feature or feat that triggers on a hit; Radiant Strikes and Great Weapon Master are added to the damage; weapon mastery (Vex, Sap, Slow, Push, Topple, Cleave) is applied or logged. After a miss: Guided Strike, Peerless Aim, Homing Strikes and Peerless Skill (spent only if it then hits), Precision Attack, Stroke of Luck, Heroic Inspiration; Graze and Studied Attacks apply by themselves. A failed check or save offers Tactical Mind (Second Wind spent only on a success), Indomitable, Peerless Skill, Stroke of Luck and Heroic Inspiration, also from the log (✗ It failed…). Hide, Escape a Grapple and Concentration (after damage) resolve themselves; Spell Breaker and Boon of Spell Recall give slots back. `docs/play-coverage.md` lists all 108 such rules and how each is handled.
- **Spellcasting ability**: shown between Proficiency and Heroic Inspiration (ability, save DC, spell attack). Spells granted with another ability (species lineages, Magic Initiate and other feats, subclass features) carry a "uses WIS"-style tag and roll with their own DC and attack. The builder asks for the ability wherever the rules give a choice; "the ability increased by this feat" follows the feat's ability increase. The same information is on the Character page, the character sheet PDF, the booklet (The Character and Spell List) and the cheat sheet.
- **Weapon cantrips**: True Strike, Booming Blade and Green-Flame Blade ask which weapon, then roll the attack and damage (True Strike with your spellcasting ability and its extra Radiant dice). Shillelagh turns your Club or Quarterstaff attack into the spellcasting ability with the bigger die.
- `docs/play-coverage.md` lists, for every 2024 class/subclass feature and spell, what the sheet does with it (regenerate with `TOMEBINDER_SELFTEST=<dir> TOMEBINDER_COVERAGE=1 electron .`).

Equipment (builder and Play): every item that is worn, wielded or attuned can be equipped (armor, shields, weapons, rings, wondrous items, rods, wands, staffs, focuses), the item list includes every specific magic variant (+1 Longsword, Mithral Plate…), and equipped items apply their bonuses (AC, saves, ability scores, magic weapon bonuses, spell attack and DC, speed, resistances). At most 3 attuned items are allowed.

Level-up plan (Export tab): pick each class's subclass ahead of time and plan multiclass classes with their subclass. The booklet and cheat sheet then guide all 20 levels, marked "planned", without changing the character.

## Part 5: the Store (desktop, during a Play session)

The **Store** tab opens only while a Play session is running, and shops for that session's character (coins and inventory come from, and go back to, the character).

- **Session inventory**: a session works on a copy of the character's equipment and coins, shared by Play and the Store (both show the same Inventory card: equip, quantities, add items). **End session** lists what changed (items gained or lost, equipped or unequipped, coins) and, ticked, writes it to the character page; unticked, the character page keeps what it had. A session closed without ending asks, next time, whether to keep its inventory.
- **Vendors**: Everything, General Store, Weaponsmith, Armorer, Alchemist & Apothecary, Scribe & Scroll Shop (a Spell Scroll of every spell), Arcane Emporium, Tools & Instruments, Stables & Docks, Jeweler, Inn & Tavern, Temple (spellcasting services; healing spells are applied to the sheet) and Hirelings & Living. 5etools has no shop categories of its own, so vendors are built from the item types.
- **Prices (2024 rules)**: the item's listed cost; magic items by rarity (Common 100 GP … Legendary 200,000 GP), half for consumables, plus the cost of the mundane item they're built on; Spell Scrolls at double their scribing cost; services from the Player's Handbook. The **settlement** (Village, Town, City, Wondrous place) limits magic items by rarity and spellcasting services by level.
- **Selling and valuables**: every carried item shows its worth; gems, art objects and trade goods sell at full value, other gear at half. Each vendor buys its own kind of goods (the Jeweler buys valuables).
- **Barter** (Influence): Persuade, Bluff, Intimidate, Charm with a performance, Read the vendor (Advantage on the next check) and Appraise the goods, each once per visit against the vendor's DC (Easygoing 12 … Ruthless 20), with Advantage or Disadvantage from the vendor's attitude. Rolls use the Play engine (active effects such as Guidance, conditions, Exhaustion, physical dice, Heroic Inspiration rerolls); Reliable Talent and Silver Tongue are applied; matching tool proficiency (Smith's Tools at the smith…) gives Advantage or adds the Proficiency Bonus. Friends, Charm Person, Suggestion, Enhance Ability, Detect Thoughts and others can be cast from the Store (slot spent, vendor's save rolled). Discounts cap at 30%; failing a Bluff or Intimidation by 5 or more raises prices and ends the haggling. The DM can set a discount by hand.

## Experience and levelling

The Character tab shows an **XP bar** (2024 XP table) with an **Add** box; **▲ Level up** is available once the bar is full. Characters made before XP existed start at the minimum XP for their level. In the builder's **Start** step, **⚡ Force level up** skips the XP check (to try a build); the character as it was (level, choices and XP) is remembered, and **↶ Revert** brings it back or **Keep the new level** forgets it.

## App updates (no new installer)

The desktop app checks for a newer interface at start and in **App Files → Beldora CB updates**. Updates download from Cloudflare (Worker `beldora-cb`, KV namespace `beldora-updates`), are checked against their SHA-256, install into `System\ui-updates\` and apply on restart; **Use built-in version** goes back.
- Publish a patch: raise `version` in `ui/version.json`, then `npm run publish:update -- --notes "What changed"`. Raise `minApp` (and build an installer) only when `main.js` or `preload.js` changed.
- Updates reach the edge within about a minute. The same Worker serves the web version (`npm run deploy:web`).

## Notes
- The wiki pages and data come straight from your 5etools copy; nothing is sent online.
- Images from the site appear in clips when the `img` folder is present; missing images are dropped from the booklet automatically.
- Self-test (developers): `TOMEBINDER_SELFTEST=<out dir> electron .` exports sample PDFs to `<out dir>`; add `TOMEBINDER_SMOKE=1` (app, wiki, saves) `TOMEBINDER_UPDATER=1` (App Files and updater) and `TOMEBINDER_ENC=1` (encounter builder) and `TOMEBINDER_PLAY=1` (live sheet, equipment, level-up plan; with `BELDORA_UPDATE_URL` set it tests the in-app updater).
