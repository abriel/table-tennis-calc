from django.shortcuts import render, redirect
from django.views.decorators.http import require_POST, require_GET


def render_to(template_name):
    def decorated(view):
        def wrapper(request, *args, **kwargs):
            context = view(request, *args, **kwargs)
            if isinstance(context, dict):
                return render(
                    request,
                    template_name,
                    view(request, *args, **kwargs)
                )

            else:
                return context

        return wrapper
    return decorated


def settings_from_session():
    def decorated(view):
        def wrapper(request, *args, **kwargs):
            context = view(request, *args, **kwargs)
            if isinstance(context, dict):
                context.update(
                    {
                        'end_score': request.session['end_score'],
                        'innings': request.session['innings'],
                        'player_1': request.session['player_1'],
                        'player_0': request.session['player_0'],
                        'player_1_super_score': request.session['player_1_super_score'],
                        'player_0_super_score': request.session['player_0_super_score'],
                    }
                )

                if request.session['active_player'] is not None:
                    context['player_{}_style'.format(request.session['active_player'])] = 'active_score_block'

                if request.session['next_active_player'] is not None:
                    context['player_{}_style'.format(request.session['next_active_player'])] = 'next_active_score_block'

            return context

        return wrapper
    return decorated


def default_settings():
    def decorated(view):
        def wrapper(request, *args, **kwargs):
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
                if k not in request.session:
                    request.session[k] = defaults[k]

            return view(request, *args, **kwargs)

        return wrapper
    return decorated


@render_to('index.html')
@require_GET
@settings_from_session()
@default_settings()
def index(request):
    return {}


@render_to('settings.html')
@require_GET
@settings_from_session()
@default_settings()
def settings(request):
    return {}


@require_POST
def settings_update(request):
    request.session['end_score'] = int(request.POST['end_score'])
    request.session['innings'] = int(request.POST['innings'])

    return redirect(settings)


@require_POST
def score_update(request, player):
    player_key = 'player_{}'.format(player)
    active_player = request.session['active_player']

    if active_player is None:
        request.session['active_player'] = player
        request.session['next_game_active_player'] = int(not(player))
        return redirect(index)

    request.session[player_key] += 1

    if (request.session['player_0'] + request.session['player_1']) % request.session['innings'] == 0:
        request.session['active_player'] = int(not(active_player))

    if (request.session['player_0'] + request.session['player_1']) % request.session['innings'] == request.session['innings'] - 1:
        request.session['next_active_player'] = int(not(active_player))
    else:
        request.session['next_active_player'] = None

    if request.session['player_0'] >= request.session['end_score']:
        request.session['player_0_super_score'] += 1
        request.session['next_game_active_player'] = int(not(request.session['next_game_active_player']))
        return score_reset(request, active_player=int(not(request.session['next_game_active_player'])))

    if request.session['player_1'] >= request.session['end_score']:
        request.session['player_1_super_score'] += 1
        request.session['next_game_active_player'] = int(not(request.session['next_game_active_player']))
        return score_reset(request, active_player=int(not(request.session['next_game_active_player'])))

    return redirect(index)


@require_POST
def score_reset(request, **kwargs):
    request.session['player_0'] = 0
    request.session['player_1'] = 0
    request.session['active_player'] = kwargs.get('active_player', None)
    request.session['next_active_player'] = None

    return redirect(index)


@require_POST
def super_score_reset(request):
    request.session['player_0_super_score'] = 0
    request.session['player_1_super_score'] = 0

    return redirect(index)
