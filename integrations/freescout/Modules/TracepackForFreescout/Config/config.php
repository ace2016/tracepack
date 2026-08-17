<?php

return [
    // Reverse-DNS style id identifying this FreeScout install as a tracepack-evidence v1
    // producer. Self-asserted, exactly like the rest of the interchange contract. Change it
    // to something specific to your own helpdesk if you're running more than one.
    'producer_id' => env('TRACEPACK_PRODUCER_ID', 'org.freescout.tracepack-for-freescout'),
    'producer_name' => env('TRACEPACK_PRODUCER_NAME', null),

    // Where the button opens. Point this at a self-hosted deployment of apps/workspace instead
    // of the default if you're not using the hosted app.tracepack.org.
    'app_url' => env('TRACEPACK_APP_URL', 'https://app.tracepack.org'),
    'max_attachment_bytes' => env('TRACEPACK_MAX_ATTACHMENT_BYTES', 10 * 1024 * 1024),
    'max_payload_bytes' => env('TRACEPACK_MAX_PAYLOAD_BYTES', 25 * 1024 * 1024),
];
