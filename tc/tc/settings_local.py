SESSION_ENGINE = 'redis_sessions.session'

SESSION_REDIS = {
    'host': '172.17.0.2',
    'port': 6379,
    'db': 0,
    'prefix': 'tc_session',
    'socket_timeout': 2,
    'retry_on_timeout': False
}
