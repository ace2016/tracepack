<?php

use Illuminate\Support\Facades\Route;
use Modules\TracepackForFreescout\Http\Controllers\SendToTracepackController;

// Sits behind FreeScout's own 'auth' middleware group (registered by the core app, applied here
// via the route group in TracepackForFreescoutServiceProvider). Only a logged-in agent with
// access to the conversation can ever request its payload.
Route::get('conversation/{conversation}/send-to-tracepack-payload', [SendToTracepackController::class, 'payload'])
    ->name('tracepackforfreescout.payload');
