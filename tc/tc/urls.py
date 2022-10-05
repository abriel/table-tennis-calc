"""tc URL Configuration

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/4.1/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path

from app import views as app_views

urlpatterns = [
    path('admin/', admin.site.urls),
    path('', app_views.index, name='app-index'),
    path('settings', app_views.settings, name='app-settings'),
    path('settings/update', app_views.settings_update, name='app-settings-update'),
    path('score/update/<int:player>', app_views.score_update, name='app-score-update'),
    path('score/reset', app_views.score_reset, name='app-score-reset'),
    path('superscore/reset', app_views.super_score_reset, name='app-super-score-reset'),
]
