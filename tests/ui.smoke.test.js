/**
 * ui.smoke.test.js — boots the real index.html (vendor Preact + htm, game.js,
 * app.js) inside jsdom and exercises the UI end-to-end: tapping, serve
 * indicators, settings modal, game-end banner, resets, keyboard input and
 * localStorage persistence.
 *
 * Run:  node --test tests/       (or: npm test in spa/)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');

// Minimal static file server so the page loads over http:// (jsdom resolves
// relative script/link URLs against the document URL; this also mirrors how
// the app is actually served in production).
function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, path.normalize(urlPath).replace(/^([/\\])+/, ''));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

let serverPromise = null;
const serverUrl = () => {
  if (!serverPromise) serverPromise = startServer();
  return serverPromise.then((s) => 'http://127.0.0.1:' + s.address().port);
};

test.after(async () => {
  if (serverPromise) (await serverPromise).close();
});

function loadPage(preloadedState) {
  return serverUrl().then((base) => JSDOM.fromURL(base + '/index.html', {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    // Seed storage BEFORE any page script runs (avoids a boot race).
    beforeParse(window) {
      if (preloadedState) {
        window.localStorage.setItem(TennisGameKey(), JSON.stringify(preloadedState));
      }
    },
  }));
}

/** Resolve when cond(document) is true (scripts load asynchronously). */
function waitFor(dom, cond, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function poll() {
      try {
        if (cond(dom.window.document)) return resolve();
      } catch (e) { /* keep polling */ }
      if (Date.now() - start > timeout) {
        return reject(new Error('timeout waiting for DOM condition'));
      }
      setTimeout(poll, 25);
    })();
  });
}

async function boot() {
  const dom = await loadPage();
  await waitFor(dom, (d) => d.querySelector('.score_block'));
  // Let post-render effects flush (wake-lock status, keyboard listener).
  await settle();
  return dom;
}

const $ = (sel, d) => d.querySelector(sel);
const $$ = (sel, d) => [...d.querySelectorAll(sel)];
const digitOf = (d, i) => $$('.score_digit', d)[i].textContent;
const blockOf = (d, i) => $$('.score_block', d)[i];
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true, cancelable: true }));

// Preact flushes re-renders asynchronously (microtask / rAF); let them settle.
const settle = () => new Promise((r) => setTimeout(r, 80));

/** Set an input value + fire change, then let Preact flush the re-render
 *  BEFORE interacting further (a synchronous Save click would otherwise
 *  read the pre-change state — a UI race that cannot happen for a human). */
const changeInput = async (input, value, win) => {
  input.value = value;
  input.dispatchEvent(new win.Event('change', { bubbles: true }));
  await settle();
};

test('page boots: two score blocks, start hint, wake-lock banner (unsupported in jsdom)', async () => {
  const dom = await boot();
  const d = dom.window.document;
  assert.equal($$('.score_block', d).length, 2);
  assert.equal(digitOf(d, 0), '0');
  assert.equal(digitOf(d, 1), '0');
  assert.ok($('.start_hint', d), 'start hint visible before first tap');
  assert.match($('.super_score_value', d).textContent, /^0\s*:\s*0$/);
  assert.match($('.wake_lock_message', d).textContent, /NOT supported/);
  assert.match($('.settings_link', d).textContent, /Win score 11 ; 2 innings/);
  dom.window.close();
});

test('tap flow: first tap is free (designates server), second tap scores', async () => {
  const dom = await boot();
  const d = dom.window.document;

  click(blockOf(d, 0)); // free first tap
  await settle();
  assert.equal(digitOf(d, 0), '0');
  assert.ok(blockOf(d, 0).classList.contains('active_score_block'), 'player 0 highlighted as server');
  assert.ok(!$('.start_hint', d), 'start hint gone after first tap');

  click(blockOf(d, 0)); // 1-0
  await settle();
  assert.equal(digitOf(d, 0), '1');
  assert.ok(blockOf(d, 1).classList.contains('next_active_score_block'), 'player 1 dotted: serves next');

  click(blockOf(d, 1)); // 1-1 -> serve rotates to player 1
  await settle();
  assert.equal(digitOf(d, 1), '1');
  assert.ok(blockOf(d, 1).classList.contains('active_score_block'), 'player 1 now serving');
  assert.ok(!blockOf(d, 1).classList.contains('next_active_score_block'));
  assert.ok(!blockOf(d, 0).classList.contains('next_active_score_block'));

  click(blockOf(d, 1)); // 1-2
  click(blockOf(d, 1)); // 1-3 -> rotates back to player 0
  await settle();
  assert.equal(digitOf(d, 1), '3');
  assert.ok(blockOf(d, 0).classList.contains('active_score_block'));
  dom.window.close();
});

test('settings modal: open, change win score, save; validation error on bad input', async () => {
  const dom = await boot();
  const d = dom.window.document;
  const win = dom.window;

  // Open the modal.
  click($$('.linklike', d)[0]);
  await waitFor(dom, (d) => d.querySelector('.modal'));
  await settle();
  assert.equal($$('.linklike', d).length, 2, 'Edit link + full-reset link in modal footer');
  const endInput = $('#end_score', d);
  const inningsInput = $('#innings', d);
  assert.equal(endInput.value, '11');
  assert.equal(inningsInput.value, '2');

  // Invalid value -> inline error, modal stays open, settings unchanged.
  await changeInput(endInput, '0', win);
  click($$('.modal .btn_primary', d)[0]);
  await settle();
  assert.ok($('.form_error', d), 'validation error shown');
  assert.ok($('.modal', d), 'modal still open');
  assert.match($('.settings_link', d).textContent, /Win score 11/);

  // Valid value -> saved and reflected in the header.
  await changeInput(endInput, '5', win);
  click($$('.modal .btn_primary', d)[0]);
  await waitFor(dom, (d) => !d.querySelector('.modal'));
  await settle();
  assert.match($('.settings_link', d).textContent, /Win score 5 ; 2 innings/);
  dom.window.close();
});

test('game end: banner shown, super score incremented, points reset', async () => {
  const dom = await boot();
  const d = dom.window.document;
  const win = dom.window;

  // Lower the win score to 3 through the modal.
  click($$('.linklike', d)[0]);
  await waitFor(dom, (d) => d.querySelector('.modal'));
  const endInput = $('#end_score', d);
  endInput.value = '3';
  endInput.dispatchEvent(new win.Event('change', { bubbles: true }));
  await settle();
  click($$('.modal .btn_primary', d)[0]);
  await waitFor(dom, (d) => !d.querySelector('.modal'));
  await settle();

  // Play: free tap (server 0), then 0,1,0,1,0 -> 3-2, player 0 (index) wins.
  click(blockOf(d, 0));
  for (const p of [0, 1, 0, 1, 0]) {
    click(blockOf(d, p));
    await settle();
  }
  assert.match($('.game_banner', d).textContent, /Player 1 wins the game/);
  assert.match($('.super_score_value', d).textContent, /^1\s*:\s*0$/);
  assert.equal(digitOf(d, 0), '0');
  assert.equal(digitOf(d, 1), '0', 'points reset for BOTH players');
  assert.ok(blockOf(d, 1).classList.contains('active_score_block'), 'player 2 serves first in game 2');
  dom.window.close();
});

test('reset buttons: game reset returns to start hint; super reset clears games', async () => {
  const dom = await boot();
  const d = dom.window.document;
  const win = dom.window;

  // Get to a mid-game state with one game won: win score 3.
  click($$('.linklike', d)[0]);
  await waitFor(dom, (d) => d.querySelector('.modal'));
  const endInput = $('#end_score', d);
  endInput.value = '3';
  endInput.dispatchEvent(new win.Event('change', { bubbles: true }));
  await settle();
  click($$('.modal .btn_primary', d)[0]);
  await waitFor(dom, (d) => !d.querySelector('.modal'));
  await settle();

  click(blockOf(d, 0)); // free
  for (const p of [0, 1, 0, 1, 0]) {
    click(blockOf(d, p));
    await settle();
  } // 3-2, P1 (label) wins
  assert.match($('.super_score_value', d).textContent, /^1\s*:\s*0$/);

  // Start game 2 with a point.
  click(blockOf(d, 1)); // 0-1
  await settle();
  assert.equal(digitOf(d, 1), '1');

  const buttons = $$('.reset_block .btn', d);
  assert.equal(buttons.length, 2);
  click(buttons[0]); // Reset Game Score
  await settle();
  assert.equal(digitOf(d, 0), '0');
  assert.equal(digitOf(d, 1), '0');
  assert.ok($('.start_hint', d), 'start hint back after game reset');
  assert.match($('.super_score_value', d).textContent, /^1\s*:\s*0$/, 'super score kept');

  click(buttons[1]); // Reset Super Score
  await settle();
  assert.match($('.super_score_value', d).textContent, /^0\s*:\s*0$/);
  dom.window.close();
});

test('keyboard: "1" / "2" add points, Escape closes settings modal', async () => {
  const dom = await boot();
  const d = dom.window.document;
  const win = dom.window;

  const key = (k) => d.dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true }));

  key('1'); // free first tap for player 0
  await settle();
  assert.ok(blockOf(d, 0).classList.contains('active_score_block'));
  key('1'); // 1-0
  await settle();
  key('2'); // 1-1
  await settle();
  assert.equal(digitOf(d, 0), '1');
  assert.equal(digitOf(d, 1), '1');

  // Keyboard is ignored while the modal is open (except Escape).
  click($$('.linklike', d)[0]);
  await waitFor(dom, (d) => d.querySelector('.modal'));
  await settle();
  key('1');
  await settle();
  assert.equal(digitOf(d, 0), '1', 'no scoring while modal is open');
  key('Escape');
  await waitFor(dom, (d) => !d.querySelector('.modal'));
  dom.window.close();
});

test('state persists to localStorage and is restored on a fresh page load', async () => {
  const dom1 = await boot();
  const d1 = dom1.window.document;
  click(blockOf(d1, 0)); // free
  click(blockOf(d1, 0)); // 1-0
  click(blockOf(d1, 1)); // 1-1
  await settle();

  const stored = JSON.parse(dom1.window.localStorage.getItem(TennisGameKey()));
  assert.equal(stored.player0, 1);
  assert.equal(stored.player1, 1);
  assert.equal(stored.activePlayer, 1, 'serve rotated after 2 points');
  dom1.window.close();

  // A second page seeded with the same storage should restore the state.
  const dom2 = await loadPage(stored);
  await waitFor(dom2, (d) => d.querySelector('.score_block'));
  await settle();
  assert.equal($$('.score_digit', dom2.window.document)[0].textContent, '1');
  assert.equal($$('.score_digit', dom2.window.document)[1].textContent, '1');
  dom2.window.close();
});

// localStorage key — imported from the same game.js the page uses.
function TennisGameKey() {
  return require('../game.js').STORAGE_KEY;
}
