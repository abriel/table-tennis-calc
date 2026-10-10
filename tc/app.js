/*
 * app.js — UI layer for the table-tennis score SPA.
 *
 * Renders the scoreboard with Preact (vendored UMD builds in vendor/, so
 * there is no build step and no backend — the page works offline, even from
 * file://). All game logic lives in game.js (global `TennisGame`); this file
 * only handles rendering, user input, persistence (localStorage) and the
 * Screen Wake Lock.
 */
(function () {
  'use strict';

  var h = preact.h;
  var html = htm.bind(h);
  // In classic-script (UMD) usage the hooks are exposed as the global
  // `preactHooks`, not on `preact` itself.
  var hooks = (typeof preactHooks !== 'undefined') ? preactHooks : preact;
  if (typeof hooks.useState !== 'function') {
    throw new Error('Preact hooks missing — load vendor/preact-hooks.js after vendor/preact.min.js');
  }
  var useState = hooks.useState;
  var useEffect = hooks.useEffect;
  var useRef = hooks.useRef;
  var G = TennisGame;

  /* ----------------------------- wake lock ----------------------------- */

  /**
   * Requests the Screen Wake Lock and re-requests it whenever the tab
   * becomes visible again (the original requested it once only).
   * Returns 'ok' | 'fail'.
   */
  function useWakeLock() {
    var statusState = useState('checking');
    var setStatus = statusState[1];
    var sentinelRef = useRef(null);

    useEffect(function () {
      var cancelled = false;

      if (!('wakeLock' in navigator)) {
        setStatus('fail');
        return;
      }

      function request() {
        navigator.wakeLock.request('screen').then(function (sentinel) {
          if (cancelled) { sentinel.release(); return; }
          sentinelRef.current = sentinel;
          setStatus('ok');
          sentinel.addEventListener('release', function () {
            if (!cancelled && sentinelRef.current === sentinel) setStatus('fail');
          });
        }).catch(function () {
          if (!cancelled) setStatus('fail');
        });
      }

      function onVisibilityChange() {
        if (document.visibilityState === 'visible') request();
      }

      document.addEventListener('visibilitychange', onVisibilityChange);
      request();

      return function () {
        cancelled = true;
        document.removeEventListener('visibilitychange', onVisibilityChange);
        if (sentinelRef.current) {
          sentinelRef.current.release().catch(function () {});
        }
      };
    }, []);

    return statusState[0];
  }

  /* ----------------------------- components ----------------------------- */

  function WakeLockBanner(props) {
    var status = props.status;
    if (status === 'checking') return null;
    var ok = status === 'ok';
    return html`<div class=${'wake_lock_message ' + (ok ? 'wake_lock_ok' : 'wake_lock_fail')}>
      ${ok ? 'Screen Wake Lock activated.' : 'Screen Wake Lock is NOT supported.'}
    </div>`;
  }

  function ScoreBlock(props) {
    var player = props.player;
    var state = props.state;
    var onTap = props.onTap;
    var score = player === 0 ? state.player0 : state.player1;
    var isActive = state.activePlayer === player;
    var isNext = state.nextActivePlayer === player;

    var cls = 'score_block'
      + (isActive ? ' active_score_block' : '')
      + (isNext ? ' next_active_score_block' : '');

    var serveTag = isActive ? 'serves' : isNext ? 'serves next' : '';

    function handleKey(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onTap(player);
      }
    }

    return html`
      <div class=${cls} role="button" tabindex="0"
           aria-label=${'Add a point for player ' + (player + 1) + (serveTag ? ' (' + serveTag + ')' : '')}
           onclick=${function () { onTap(player); }}
           onkeydown=${handleKey}>
        <div class="player_label">Player ${player + 1}${serveTag ? ' — ' + serveTag : ''}</div>
        <div class="score_digit">${score}</div>
      </div>`;
  }

  function SettingsModal(props) {
    // The modal is mounted fresh each time it opens, so initialising the
    // fields from props.state here is always correct.
    var endScoreState = useState(String(props.state.endScore));
    var inningsState = useState(String(props.state.innings));
    var errorState = useState('');

    function save() {
      var next = G.setSettings(props.state, endScoreState[0], inningsState[0]);
      if (next === null) {
        errorState[1]('Enter whole numbers between 1 and 99.');
        return;
      }
      errorState[1]('');
      props.onSave(next);
    }

    return html`
      <div class="modal_backdrop"
           onclick=${function (e) { if (e.target === e.currentTarget) props.onClose(); }}>
        <div class="modal" role="dialog" aria-label="Settings">
          <h2>Settings</h2>

          <label for="end_score">Win score (points to win a game)</label>
          <input id="end_score" type="number" min="1" max="99" step="1"
                 value=${endScoreState[0]}
                 onchange=${function (e) { endScoreState[1](e.target.value); }} />

          <label for="innings">Innings (points per serve)</label>
          <input id="innings" type="number" min="1" max="99" step="1"
                 value=${inningsState[0]}
                 onchange=${function (e) { inningsState[1](e.target.value); }} />

          ${errorState[0] ? html`<div class="form_error">${errorState[0]}</div>` : null}

          <div class="modal_buttons">
            <button class="btn btn_primary" onclick=${save}>Save</button>
            <button class="btn" onclick=${props.onClose}>Cancel</button>
          </div>

          <div class="modal_footer">
            <button class="linklike" onclick=${props.onFullReset}>
              Reset everything (scores, games, settings)
            </button>
          </div>
        </div>
      </div>`;
  }

  function GameBanner(props) {
    var winner = props.winner;
    if (winner === null) return null;
    return html`<div class="game_banner">
      <div><strong>Player ${winner + 1} wins the game!</strong></div>
      <div class="game_banner_sub">next server: Player ${(1 - winner) + 1} — tap to continue</div>
    </div>`;
  }

  /* -------------------------------- app -------------------------------- */

  function App() {
    // Restore persisted state (localStorage) — replaces the original
    // server-side Django session.
    var stateTuple = useState(function () { return G.load(); });
    var state = stateTuple[0];
    var setState = stateTuple[1];

    var showSettingsState = useState(false);
    var setShowSettings = showSettingsState[1];
    var bannerState = useState(null);
    var setBanner = bannerState[1];

    var stateRef = useRef(state);
    stateRef.current = state;
    var settingsOpenRef = useRef(showSettingsState[0]);
    settingsOpenRef.current = showSettingsState[0];
    var bannerTimer = useRef(null);

    var wakeLockStatus = useWakeLock();

    function onFullReset() {
      G.clear();
      stateRef.current = G.initialState();
      G.save(stateRef.current);
      setState(stateRef.current);
      setShowSettings(false);
    }

    function dispatch(action, player) {
      var s = stateRef.current;
      var next =
        action === 'tap' ? G.tap(s, player) :
        action === 'resetGame' ? G.resetGame(s) :
        G.resetSuperScore(s);
      if (next === null) return;
      stateRef.current = next;
      G.save(next);
      setState(next);
      if (action === 'tap' && next.gameJustEnded !== null) {
        setBanner(next.gameJustEnded);
        clearTimeout(bannerTimer.current);
        bannerTimer.current = setTimeout(function () { setBanner(null); }, 4000);
      }
    }

    // Keyboard: 1 / 2 score for a player (ignored while the modal is open),
    // Escape closes the modal.
    useEffect(function () {
      function onKey(e) {
        if (settingsOpenRef.current) {
          if (e.key === 'Escape') setShowSettings(false);
          return;
        }
        if (e.key === '1') dispatch('tap', 0);
        else if (e.key === '2') dispatch('tap', 1);
      }
      document.addEventListener('keydown', onKey);
      return function () { document.removeEventListener('keydown', onKey); };
    }, []);

    var notStarted = state.activePlayer === null;

    return html`
      <div class="page">
        <header class="top_bar">
          <span class="title">Tennis goals count</span>
          <span class="settings_link">
            Settings: Win score ${state.endScore} ; ${state.innings} innings.
            [ <button class="linklike" onclick=${function () { setShowSettings(true); }}>Edit</button> ]
          </span>
        </header>

        <${WakeLockBanner} status=${wakeLockStatus} />

        ${notStarted
          ? html`<div class="start_hint">
              Game not started — tap the player who serves first.
            </div>`
          : null}

        <${ScoreBlock} player=${0} state=${state} onTap=${function () { dispatch('tap', 0); }} />
        <${ScoreBlock} player=${1} state=${state} onTap=${function () { dispatch('tap', 1); }} />

        <div class="super_score_block">
          <span class="super_score_label">GAMES</span>
          <span class="super_score_value">${state.super0} : ${state.super1}</span>
        </div>

        <div class="reset_block">
          <button class="btn" onclick=${function () { dispatch('resetGame'); }}>Reset Game Score</button>
          <button class="btn" onclick=${function () { dispatch('resetSuperScore'); }}>Reset Super Score</button>
        </div>

        <div class="key_hints">Keyboard: 1 / 2 to add a point</div>

        <${GameBanner} winner=${bannerState[0]} />

        ${showSettingsState[0]
          ? html`<${SettingsModal}
              state=${state}
              onClose=${function () { setShowSettings(false); }}
              onSave=${function (next) {
                stateRef.current = next;
                G.save(next);
                setState(next);
                setShowSettings(false);
              }}
              onFullReset=${onFullReset} />`
          : null}
      </div>`;
  }

  /* -------------------------------- boot -------------------------------- */

  function boot() {
    preact.render(html`<${App} />`, document.getElementById('app'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
