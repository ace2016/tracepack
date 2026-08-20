<?php

require_once __DIR__ . '/../src/EvidencePayloadBuilder.php';

use TracePack\WooCommerce\EvidencePayloadBuilder;

$snapshot = array(
    'internal_id'          => '18431',
    'order_number'         => '18431',
    'source_url'           => 'https://shop.example.test/wp-admin/admin.php?page=wc-orders&action=edit&id=18431',
    'created_at'           => '2026-08-19T09:12:00+00:00',
    'paid_at'              => '2026-08-19T09:13:00+00:00',
    'completed_at'         => '2026-08-20T11:30:00+00:00',
    'status'               => 'completed',
    'currency'             => 'GBP',
    'subtotal'             => '129.99',
    'discount_total'       => '10.00',
    'shipping_total'       => '4.99',
    'tax_total'            => '24.99',
    'total'                => '149.97',
    'payment_method_title' => 'Card payment',
    'transaction_id'       => 'txn_test_18431',
    'line_items'           => array(
        array(
            'name'      => 'Café mug ☕',
            'quantity'  => '2',
            'subtotal'  => '89.99',
            'total'     => '79.99',
            'total_tax' => '15.99',
        ),
        array(
            'name'      => 'Delivery cover – édition spéciale',
            'quantity'  => '1',
            'subtotal'  => '40.00',
            'total'     => '40.00',
            'total_tax' => '8.00',
        ),
    ),
    'shipping_lines'       => array(
        array(
            'method'    => 'Tracked delivery',
            'total'     => '4.99',
            'total_tax' => '1.00',
        ),
    ),
);

$payload = EvidencePayloadBuilder::build( $snapshot, '0.1.0-test' );

if ( 1 !== $payload['schema_version'] ) {
    fwrite( STDERR, "schema_version is not 1\n" );
    exit( 1 );
}

if ( 'woocommerce_order_record' !== $payload['evidence_type'] ) {
    fwrite( STDERR, "unexpected evidence_type\n" );
    exit( 1 );
}

if ( array() !== $payload['attachments'] ) {
    fwrite( STDERR, "first vertical slice must not create attachments\n" );
    exit( 1 );
}

if ( count( $payload['observations'] ) < 2 ) {
    fwrite( STDERR, "expected order and payment observations\n" );
    exit( 1 );
}

if ( 64 !== strlen( $payload['integrity']['payload_hash'] ) ) {
    fwrite( STDERR, "payload hash is not a 64-character SHA-256 hex string\n" );
    exit( 1 );
}

$fixture = __DIR__ . '/fixture-payload.json';
$json = json_encode( $payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES );

if ( false === $json ) {
    fwrite( STDERR, "could not encode fixture payload\n" );
    exit( 1 );
}

file_put_contents( $fixture, $json . PHP_EOL );

echo "WooCommerce payload builder fixture: ok\n";
echo "Wrote {$fixture}\n";
echo "payload_hash: {$payload['integrity']['payload_hash']}\n";
