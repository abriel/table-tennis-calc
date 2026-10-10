/**
 * game.test.js — unit tests for the pure state machine (game.js) plus a
 * DIFFERENTIAL FUZZ test: the JS port is replayed against a verbatim
 * simulation of the original Django views (tests/reference/ref_sim.py) and
 * every intermediate state must match.
 *
 * Run:  node --test tests/        (or: npm test in spa/)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const G = require('../game.js');

/* ----------------------------- helpers ----------------------------- */

/** Convenience: start a game (apply the first-tap) then tap `seq` of players. */
function play(startServer, seq, opts = {}) {
  let s = G.initialState();
  s = G.setSettings(s, opts.endScore ?? 11, opts.innings ?? 2);
  s = G.tap(s, startServer); // first tap: designates server, scores nothing
  for (const p of seq) s = G.tap(s, p);
  return s;
}

test('defaults match the original session defaults', () => {
  const s = G.initialState();
  assert.deepEqual(s, {
    endScore: 11, innings: 2,
    player0: 0, player1: 0, super0: 0, super1: 0,
    activePlayer: null, nextActivePlayer: null, firstServer: null,
    gameJustEnded: null,
  });
});

test('first tap of a game does NOT score (original quirk) and designates the server', () => {
  const s = G.tap(G.initialState(), 0);
  assert.equal(s.player0, 0);
  assert.equal(s.player1, 0);
  assert.equal(s.activePlayer, 0);
  assert.equal(s.firstServer, 0);
  assert.equal(s.nextActivePlayer, null);
  const s1 = G.tap(G.initialState(), 1);
  assert.equal(s1.activePlayer, 1);
  assert.equal(s1.firstServer, 1);
});

test('subsequent taps add a point to the tapped player', () => {
  let s = G.tap(G.initialState(), 0);
  s = G.tap(s, 0);
  assert.equal(s.player0, 1);
  s = G.tap(s, 1);
  assert.equal(s.player1, 1);
  s = G.tap(s, 0);
  assert.equal(s.player0, 2);
});

test('input state is never mutated (pure functions)', () => {
  const s = G.tap(G.initialState(), 0);
  const before = JSON.stringify(s);
  G.tap(s, 1);
  assert.equal(JSON.stringify(s), before);
});

test('innings=2: serve rotates after every 2 points', () => {
  // Game starts with server 0 (first tap).
  let s = G.tap(G.initialState(), 0);
  assert.equal(s.activePlayer, 0);
  s = G.tap(s, 0); // total=1
  assert.equal(s.activePlayer, 0);
  s = G.tap(s, 1); // total=2 -> rotate
  assert.equal(s.activePlayer, 1);
  s = G.tap(s, 1); // total=3
  assert.equal(s.activePlayer, 1);
  s = G.tap(s, 0); // total=4 -> rotate
  assert.equal(s.activePlayer, 0);
});

test('innings=3: serve rotates after every 3 points', () => {
  let s = G.setSettings(G.initialState(), 11, 3);
  s = G.tap(s, 1);          // server 1
  assert.equal(s.activePlayer, 1);
  s = G.tap(s, 1);          // total=1
  s = G.tap(s, 0);          // total=2
  assert.equal(s.activePlayer, 1);
  s = G.tap(s, 0);          // total=3 -> rotate
  assert.equal(s.activePlayer, 0);
  s = G.tap(s, 0);          // total=4
  s = G.tap(s, 1);          // total=5
  assert.equal(s.activePlayer, 0);
  s = G.tap(s, 1);          // total=6 -> rotate
  assert.equal(s.activePlayer, 1);
});

test('next-server hint is shown only one point before a rotation', () => {
  let s = G.tap(G.initialState(), 0); // server 0, innings=2
  s = G.tap(s, 0);                    // total=1 = innings-1 -> hint: 1
  assert.equal(s.nextActivePlayer, 1);
  s = G.tap(s, 1);                    // total=2 -> rotated to 1, no hint
  assert.equal(s.nextActivePlayer, null);
  s = G.tap(s, 1);                    // total=3 -> hint: 0
  assert.equal(s.nextActivePlayer, 0);
  s = G.tap(s, 0);                    // total=4 -> rotated to 0
  assert.equal(s.nextActivePlayer, null);
});

test('first to endScore wins: super score, points reset, flag raised', () => {
  let s = G.setSettings(G.initialState(), 3, 2); // endScore=3 for a short test
  s = G.tap(s, 0); // first tap (no score)
  s = G.tap(s, 0); // 1-0
  s = G.tap(s, 1); // 1-1
  s = G.tap(s, 0); // 2-1
  s = G.tap(s, 1); // 2-2
  s = G.tap(s, 0); // 3-2 -> player 0 wins
  assert.equal(s.player0, 0);
  assert.equal(s.player1, 0);
  assert.equal(s.super0, 1);
  assert.equal(s.super1, 0);
  assert.equal(s.gameJustEnded, 0);
});

test('no deuce rule: reaching endScore ends the game even 1 point apart', () => {
  let s = G.setSettings(G.initialState(), 5, 2);
  s = G.tap(s, 1); // first tap, server 1 (no score)
  for (const p of [1, 1, 1, 0, 0, 0, 1, 1]) s = G.tap(s, p); // 5-3
  assert.equal(s.player0, 0);
  assert.equal(s.player1, 0);
  assert.equal(s.super1, 1);
});

test('next game first server = opponent of this game first server (alternation)', () => {
  // Game 1: first server 0 -> winner 0 (3-2 with endScore=3, innings=2)
  let s = G.setSettings(G.initialState(), 3, 2);
  s = G.tap(s, 0);
  for (const p of [0, 1, 0, 1, 0]) s = G.tap(s, p);
  assert.equal(s.super0, 1);
  assert.equal(s.firstServer, 1, 'game 2 first server flips to 1');
  assert.equal(s.activePlayer, 1);

  // Game 2 starts immediately (no free first tap after an auto game-end reset)
  s = G.tap(s, 0);
  assert.equal(s.player0, 1, 'tap in game 2 scores immediately (no free tap)');
  // finish game 2 with player 1: 1-4
  for (const p of [1, 1, 1, 1]) s = G.tap(s, p);
  assert.equal(s.super1, 1);
  assert.equal(s.firstServer, 0, 'game 3 first server flips back to 0');
  assert.equal(s.activePlayer, 0);
});

test('after a manual game reset the first-tap quirk applies again; super kept', () => {
  let s = G.setSettings(G.initialState(), 3, 2);
  s = G.tap(s, 0); // free first tap (no score)
  s = G.tap(s, 0); // 1-0
  s = G.tap(s, 0); // 2-0
  s = G.tap(s, 0); // 3-0 -> win
  assert.equal(s.super0, 1);
  s = G.resetGame(s);
  assert.equal(s.player0, 0);
  assert.equal(s.player1, 0);
  assert.equal(s.super0, 1, 'super score preserved');
  assert.equal(s.activePlayer, null);
  s = G.tap(s, 1); // free first tap again
  assert.equal(s.player1, 0);
  assert.equal(s.activePlayer, 1);
  s = G.tap(s, 1);
  assert.equal(s.player1, 1);
});

test('super score reset only clears super scores', () => {
  let s = G.setSettings(G.initialState(), 3, 2);
  s = G.tap(s, 0); // free first tap
  for (const p of [0, 1, 0, 1, 0]) s = G.tap(s, p); // game 1: 3-2, won by 0
  for (const p of [1, 1, 1]) s = G.tap(s, p);       // game 2: 0-3, won by 1
  assert.equal(s.super0, 1);
  assert.equal(s.super1, 1);
  s = G.tap(s, 1); // game 3 starts: 0-1
  s = G.resetSuperScore(s);
  assert.equal(s.super0, 0);
  assert.equal(s.super1, 0);
  assert.equal(s.player0, 0, 'mid-game state untouched');
  assert.equal(s.player1, 1);
});

test('setSettings validates like a form would (positive integers 1..99)', () => {
  const s = G.initialState();
  assert.deepEqual(G.setSettings(s, 11, 2), G.setSettings(G.initialState(), 11, 2));
  assert.deepEqual(G.setSettings(s, '15', '3'), G.setSettings(G.initialState(), 15, 3));
  assert.equal(G.setSettings(s, 0, 2), null);
  assert.equal(G.setSettings(s, 100, 2), null);
  assert.equal(G.setSettings(s, 11, 0), null);
  assert.equal(G.setSettings(s, 11, 2.5), null);
  assert.equal(G.setSettings(s, 'abc', 2), null);
  assert.equal(G.setSettings(s, 11, null), null);
});

test('settings apply live to an ongoing game', () => {
  let s = G.initialState();
  s = G.tap(s, 0);
  s = G.tap(s, 0); // 1-0
  s = G.setSettings(s, 2, 2);
  s = G.tap(s, 0); // 2-0 -> reaches new endScore=2 -> wins
  assert.equal(s.super0, 1);
  assert.equal(s.player0, 0);
});

test('win check runs on BOTH players (original quirk): lowering endScore mid-game', () => {
  // p0 has 4 points with endScore=11; then endScore is lowered to 4 while
  // the game is in progress. The very next tap — even on player 1's side —
  // ends the game and player 0 (already at the score) wins.
  let s = G.setSettings(G.initialState(), 11, 2);
  s = G.tap(s, 0); // free first tap, server 0
  for (const p of [0, 0, 0, 1, 0]) s = G.tap(s, p); // 4-1
  assert.equal(s.player0, 4);
  s = G.setSettings(s, 4, 2);
  s = G.tap(s, 1); // 4-2 -> player 0 already at endScore=4 -> player 0 wins
  assert.equal(s.super0, 1);
  assert.equal(s.super1, 0);
  assert.equal(s.player0, 0);
  assert.equal(s.player1, 0);
  assert.equal(s.gameJustEnded, 0);
});

test('if both players are already at endScore, player 0 wins the check (original order)', () => {
  let s = G.setSettings(G.initialState(), 11, 2);
  s = G.tap(s, 0); // free first tap
  for (const p of [0, 1, 0, 1, 0, 1, 0, 1, 0]) s = G.tap(s, p); // 5-4
  s = G.setSettings(s, 4, 2);
  s = G.tap(s, 1); // 5-5, both >= 4 -> original checks player 0 first
  assert.equal(s.gameJustEnded, 0);
  assert.equal(s.super0, 1);
});

/* --------------------- differential fuzz vs Python ref --------------------- */

/**
 * Replay a fuzz trace produced by tests/reference/ref_sim.py (a verbatim
 * simulation of the original Django views) against the JS state machine and
 * assert that every intermediate state matches the original.
 */
function replayTrace(trace, label) {
  let s = G.initialState();

  for (let i = 0; i < trace.length; i++) {
    const step = trace[i];
    const ref = step.state;

    if (step.action === 'tap') s = G.tap(s, step.player);
    else if (step.action === 'resetGame') s = G.resetGame(s);
    else if (step.action === 'resetSuperScore') s = G.resetSuperScore(s);
    else if (step.action === 'setSettings') {
      const ns = G.setSettings(s, step.endScore, step.innings);
      assert.notEqual(ns, null, `${label}: step ${i}: setSettings rejected`);
      s = ns;
    } else {
      assert.fail(`${label}: unknown action ${step.action} at step ${i}`);
    }

    // Points and games won must always match.
    assert.equal(s.player0, ref.player_0, `${label} step ${i}: player0 after ${JSON.stringify(step)}`);
    assert.equal(s.player1, ref.player_1, `${label} step ${i}: player1`);
    assert.equal(s.super0, ref.player_0_super_score, `${label} step ${i}: super0`);
    assert.equal(s.super1, ref.player_1_super_score, `${label} step ${i}: super1`);
    assert.equal(s.endScore, ref.end_score, `${label} step ${i}: endScore`);
    assert.equal(s.innings, ref.innings, `${label} step ${i}: innings`);

    // Server (None <-> null) must match.
    assert.equal(s.activePlayer, ref.active_player, `${label} step ${i}: activePlayer`);
    assert.equal(s.nextActivePlayer, ref.next_active_player, `${label} step ${i}: nextActivePlayer`);

    // While a game is in progress, our firstServer must be consistent with
    // the original's next_game_active_player (stored inverted there).
    if (s.activePlayer !== null) {
      assert.equal(s.firstServer, 1 - ref.next_game_active_player,
        `${label} step ${i}: firstServer invariant`);
    }

    // Game-end event: the JS flag must equal the winner reported by the ref
    // (or be cleared on any tap / reset that does not end a game).
    if (step.action === 'tap') {
      assert.equal(s.gameJustEnded, step.winner ?? null, `${label} step ${i}: gameJustEnded`);
    } else if (step.action === 'resetGame') {
      assert.equal(s.gameJustEnded, null, `${label} step ${i}: gameJustEnded after reset`);
    }
  }
}

test('differential fuzz: JS port matches original Django logic exactly', { timeout: 60000 }, () => {
  const refSim = path.join(__dirname, 'reference', 'ref_sim.py');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-fuzz-'));

  for (const seed of [1, 42, 20261008]) {
    const out = path.join(tmp, `steps-${seed}.json`);
    execFileSync('python3', [refSim, '--seed', String(seed), '--steps', '4000', '--out', out],
      { stdio: 'pipe' });
    const trace = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.ok(trace.length === 4000, `seed ${seed}: trace length`);
    replayTrace(trace, `seed ${seed}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});
