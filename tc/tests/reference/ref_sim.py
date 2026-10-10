#!/usr/bin/env python3
"""
ref_sim.py — verbatim simulation of the ORIGINAL Django app's scoring logic
(app/views.py of /myapp), with `request.session` replaced by a plain dict.

Used only as a differential-testing oracle for the JavaScript port in
spa/game.js. Do not "improve" the logic here: it must stay 1:1 with the
original views, including quirks.

Usage:
    python3 ref_sim.py --seed 42 --steps 5000 --out steps.json

Emits a JSON array; each entry describes one action plus the full
expected session state right after applying it:
    [{"action": "tap", "player": 0, "state": {...}}, ...]
"""
import argparse
import json
import random


def default_settings(session):
    # app/views.py: default_settings decorator
    defaults = {
        'innings': 2,
        'end_score': 11,
        'player_1': 0,
        'player_0': 0,
        'active_player': None,
        'next_active_player': None,
        'next_game_active_player': None,
        'player_1_super_score': 0,
        'player_0_super_score': 0,
    }
    for k in defaults.keys():
        if k not in session:
            session[k] = defaults[k]
    return session


def score_reset(session, **kwargs):
    # app/views.py: score_reset
    session['player_0'] = 0
    session['player_1'] = 0
    session['active_player'] = kwargs.get('active_player', None)
    session['next_active_player'] = None


def score_update(session, player):
    """Returns the winner (0/1) if this tap ended a game, else None."""
    # app/views.py: score_update
    player_key = 'player_{}'.format(player)
    active_player = session['active_player']

    if active_player is None:
        session['active_player'] = player
        session['next_game_active_player'] = int(not(player))
        return None

    session[player_key] += 1

    if (session['player_0'] + session['player_1']) % session['innings'] == 0:
        session['active_player'] = int(not(active_player))

    if (session['player_0'] + session['player_1']) % session['innings'] == session['innings'] - 1:
        session['next_active_player'] = int(not(active_player))
    else:
        session['next_active_player'] = None

    if session['player_0'] >= session['end_score']:
        session['player_0_super_score'] += 1
        session['next_game_active_player'] = int(not(session['next_game_active_player']))
        score_reset(session, active_player=int(not(session['next_game_active_player'])))
        return 0

    if session['player_1'] >= session['end_score']:
        session['player_1_super_score'] += 1
        session['next_game_active_player'] = int(not(session['next_game_active_player']))
        score_reset(session, active_player=int(not(session['next_game_active_player'])))
        return 1

    return None


def super_score_reset(session):
    # app/views.py: super_score_reset
    session['player_0_super_score'] = 0
    session['player_1_super_score'] = 0


def settings_update(session, end_score, innings):
    # app/views.py: settings_update
    session['end_score'] = int(end_score)
    session['innings'] = int(innings)


def run(seed, steps):
    rng = random.Random(seed)
    session = default_settings({})
    out = []

    for _ in range(steps):
        r = rng.random()
        if r < 0.82:
            player = rng.randint(0, 1)
            winner = score_update(session, player)
            out.append({'action': 'tap', 'player': player,
                        'winner': winner, 'state': dict(session)})
        elif r < 0.88:
            score_reset(session)  # "Reset Game Score" button
            out.append({'action': 'resetGame', 'state': dict(session)})
        elif r < 0.92:
            super_score_reset(session)
            out.append({'action': 'resetSuperScore', 'state': dict(session)})
        else:
            # occasional settings change (valid values only, like the form)
            settings_update(session, rng.randint(1, 15), rng.randint(1, 4))
            out.append({'action': 'setSettings', 'endScore': session['end_score'],
                        'innings': session['innings'], 'state': dict(session)})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--steps', type=int, default=5000)
    ap.add_argument('--out', required=True)
    args = ap.parse_args()
    with open(args.out, 'w') as f:
        json.dump(run(args.seed, args.steps), f)


if __name__ == '__main__':
    main()
