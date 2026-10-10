# Tennis goals count — JavaScript-only SPA

A single-page rewrite of the original Django/Python table-tennis score
counter in this repository. **No backend, no build step** — just open
`index.html` (double-click works, `file://` included) or serve the folder
with any static file server.

```
index.html        page shell (loads everything)
styles.css        styles (light + dark, mobile first)
game.js           pure scoring state machine (framework-free, UMD)
app.js            UI layer (Preact + htm)
vendor/           preact.min.js, preact-hooks.js, htm.js (vendored UMD)
tests/            node test suite (logic + UI via jsdom)
tests/reference/  verbatim simulation of the ORIGINAL Django logic (oracle)
```

## Run

```
# just open index.html, or:
npx serve .            # any static server works
python3 -m http.server # fine too :)
```

## Test

```
npm install           # dev dependency: jsdom only
npm test              # 24 tests:
                      #  - unit tests for the state machine
                      #  - DIFFERENTIAL FUZZ: replays random action sequences
                      #    against a verbatim copy of the original Django
                      #    views (tests/reference/ref_sim.py) and asserts
                      #    every intermediate state matches 1:1
                      #  - UI smoke tests (boots the real page in jsdom,
                      #    taps blocks, uses the settings modal, keyboard,
                      #    localStorage persistence)
```

## Faithful port of the original behaviour

Everything the original did is preserved — including its quirks
(see `../ANALYSIS.md` for the full analysis):

- **First tap after a reset scores nothing** — it designates the first
  server of the game (the UI now shows "tap the player who serves first"
  so this is no longer a surprise).
- Serve rotates every `innings` points (default 2); the player who will
  serve next is outlined in dotted green one point before the rotation.
- First to `end_score` wins the game (no deuce / win-by-2, like the
  original): super score +1, points reset, next game's first server
  alternates.
- **Reset Game Score** / **Reset Super Score** behave exactly as before.
- Win check runs on *both* players each tap, `player 0` first (matters if
  `end_score` is lowered mid-game) — same as the original.
- Screen Wake Lock with the same ok/fail banner (re-requested on
  tab-visibility, an improvement).

### Improvements (documented, behaviour-neutral)

- Settings are an in-page **modal** instead of a separate page.
- State persists in **localStorage** (survives reloads; the original kept
  it in a server session).
- Settings input is validated (whole numbers 1–99; the original 500'd on
  garbage).
- "X wins the game" banner on game end; keyboard shortcuts `1`/`2`;
  a "Reset everything" option in the settings modal.
- Dark mode via `prefers-color-scheme`.

## Implementation notes

- **Preact + htm** are vendored as UMD builds in `vendor/` — no bundler,
  no network needed, works offline.
- `game.js` is a framework-free, DOM-free, UMD-wrapped module: the exact
  same file runs in the browser (global `TennisGame`) and in Node
  (`require('./game.js')`) for the test suite.
- htm gotchas hit during development (kept in mind if you edit templates):
  components are written `<${Component} />` (not `<Component />`), and
  **void/unclosed tags like `<input>` break htm's parser — always write
  `<input ... />`**.
