/*
 * game.js — pure state machine for the table-tennis score app.
 *
 * Faithful port of the original Django views (app/views.py:
 * score_update / score_reset / super_score_reset / settings_update) into
 * framework-free, DOM-free functions. State is a plain object; every action
 * returns a NEW state object (the input is never mutated).
 *
 * UMD-style wrapper: works in the browser (global `TennisGame`) and in Node
 * (module.exports) so the same file is used by the app and the test suite.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TennisGame = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STORAGE_KEY = 'tc_score_state_v1';

  var DEFAULTS = {
    endScore: 11,   // points needed to win a game (original: 'end_score')
    innings: 2,     // points after which the serve rotates (original: 'innings')
    player0: 0,     // points in the current game (original: 'player_0')
    player1: 0,     // points in the current game (original: 'player_1')
    super0: 0,      // games won (original: 'player_0_super_score')
    super1: 0,      // games won (original: 'player_1_super_score')
    activePlayer: null,     // current server; null = game not started yet
                           // (original: 'active_player')
    nextActivePlayer: null, // who serves after the next point; UI hint only
                           // (original: 'next_active_player')
    firstServer: null,       // first server of the current game; used only at
                           // game end to alternate the next game's server
                           // (original: 'next_game_active_player', stored
                           //  inverted and flipped on each game end)
    gameJustEnded: null      // transient UI info: player who won the last game
  };

  function other(player) { return 1 - player; }
  function pointsKey(player) { return player === 0 ? 'player0' : 'player1'; }
  function superKey(player) { return player === 0 ? 'super0' : 'super1'; }

  /** Fresh initial state (original: `default_settings` decorator). */
  function initialState() {
    return Object.assign({}, DEFAULTS);
  }

  /**
   * Tap a player's score block (original: `score_update`).
   *
   *  - First tap of a game (activePlayer === null): no point is awarded;
   *    the tapped player becomes the first server of the game.
   *  - Otherwise: +1 point; serve rotates every `innings` points; the
   *    "serves next" hint is shown one point before a rotation; the first
   *    player to reach `endScore` wins the game (super score +1, points
   *    reset, next game's first server = opponent of this game's first
   *    server).
   */
  function tap(state, player) {
    var s = Object.assign({}, state);

    if (s.activePlayer === null) {
      s.activePlayer = player;
      s.firstServer = player;
      s.nextActivePlayer = null;
      s.gameJustEnded = null;
      return s;
    }

    // NB: the original view captures active_player BEFORE the serve rotation
    // and uses that captured value for the "serves next" hint. With
    // innings >= 2 the two conditions can never be true on the same tap, so
    // this only matters for innings == 1 — but we keep it 1:1 with the
    // original behaviour.
    var serverBefore = s.activePlayer;
    s[pointsKey(player)] += 1;
    var total = s.player0 + s.player1;

    if (total % s.innings === 0) {
      s.activePlayer = other(s.activePlayer);
    }

    s.nextActivePlayer =
      total % s.innings === s.innings - 1 ? other(serverBefore) : null;

    // Game-end check, faithful to the original: it tests BOTH players on
    // every tap (player 0 first), not just the tapped one. That matters
    // because end_score can be lowered mid-game, in which case the game
    // ends on the very next tap even if that tap went to the opponent.
    var winner = null;
    if (s.player0 >= s.endScore) winner = 0;
    else if (s.player1 >= s.endScore) winner = 1;

    if (winner !== null) {
      s[superKey(winner)] += 1;
      s.player0 = 0;
      s.player1 = 0;
      s.firstServer = other(s.firstServer);
      s.activePlayer = s.firstServer;
      s.nextActivePlayer = null;
      s.gameJustEnded = winner;
    } else {
      s.gameJustEnded = null;
    }
    return s;
  }

  /**
   * "Reset Game Score" button (original: `score_reset` without kwargs).
   * Clears the current game; because activePlayer becomes null the first
   * tap afterwards again designates the server. Super score is untouched.
   */
  function resetGame(state) {
    var s = Object.assign({}, state);
    s.player0 = 0;
    s.player1 = 0;
    s.activePlayer = null;
    s.nextActivePlayer = null;
    s.firstServer = null;
    s.gameJustEnded = null;
    return s;
  }

  /** "Reset Super Score" button (original: `super_score_reset`). */
  function resetSuperScore(state) {
    var s = Object.assign({}, state);
    s.super0 = 0;
    s.super1 = 0;
    return s;
  }

  /**
   * Apply settings (original: `settings_update`). Values are validated as
   * positive integers 1..99; anything else is rejected with null.
   * An in-progress game keeps its points (same as the original).
   */
  function setSettings(state, endScore, innings) {
    endScore = Number(endScore);
    innings = Number(innings);
    if (!Number.isInteger(endScore) || !Number.isInteger(innings)) return null;
    if (endScore < 1 || endScore > 99 || innings < 1 || innings > 99) return null;
    var s = Object.assign({}, state);
    s.endScore = endScore;
    s.innings = innings;
    return s;
  }

  /* ---------------- persistence (localStorage) ---------------- */

  function save(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) { /* private mode / no storage: ignore */ }
  }

  /** Restore persisted state, falling back to defaults for missing keys. */
  function load() {
    var base = initialState();
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return base;
      var parsed = JSON.parse(raw);
      for (var k in DEFAULTS) {
        if (Object.prototype.hasOwnProperty.call(parsed, k)) base[k] = parsed[k];
      }
      base.gameJustEnded = null; // never restore the transient banner on load
    } catch (e) { return initialState(); }
    return base;
  }

  function clear() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
  }

  return {
    DEFAULTS: DEFAULTS,
    STORAGE_KEY: STORAGE_KEY,
    initialState: initialState,
    tap: tap,
    resetGame: resetGame,
    resetSuperScore: resetSuperScore,
    setSettings: setSettings,
    other: other,
    save: save,
    load: load,
    clear: clear
  };
});
