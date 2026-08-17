<?php

namespace Modules\TracepackForFreescout\Providers;

use Illuminate\Routing\Router;
use Illuminate\Support\ServiceProvider;

class TracepackForFreescoutServiceProvider extends ServiceProvider
{
    public function boot(Router $router): void
    {
        $this->loadViewsFrom(__DIR__ . '/../Resources/views', 'tracepackforfreescout');
        $this->mergeConfigFrom(__DIR__ . '/../Config/config.php', 'tracepackforfreescout');

        $router->group(['middleware' => 'auth', 'prefix' => 'conversations'], function (Router $router) {
            $this->loadRoutesFrom(__DIR__ . '/../routes/web.php');
        });

        // Confirmed against the staging installation's conversation view. This action sits
        // inside FreeScout's existing conversation actions menu and receives both objects.
        \Eventy::addAction('conversation.append_action_buttons', function ($conversation, $mailbox) {
            echo view('tracepackforfreescout::button', ['conversation' => $conversation])->render();
        }, 20, 2);
    }

    public function register(): void
    {
        //
    }
}
