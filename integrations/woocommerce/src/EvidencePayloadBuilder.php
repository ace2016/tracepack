<?php

namespace TracePack\WooCommerce;

use RuntimeException;

final class EvidencePayloadBuilder
{
    public static function build( array $snapshot, $producer_version ) {
        $observations = array();
        $index = 1;

        $order_detail = sprintf(
            'WooCommerce order %s was created %s. Current status: %s. Currency: %s. Total: %s.',
            self::display_value( $snapshot['order_number'] ),
            self::display_value( $snapshot['created_at'] ),
            self::display_value( $snapshot['status'] ),
            self::display_value( $snapshot['currency'] ),
            self::display_value( $snapshot['total'] )
        );

        $observations[] = array(
            'id'     => 'obs-' . $index++,
            'kind'   => 'woocommerce_order_summary',
            'label'  => 'WooCommerce order summary',
            'detail' => $order_detail,
            'data'   => array(
                'order_number'   => $snapshot['order_number'],
                'internal_id'    => $snapshot['internal_id'],
                'created_at'     => $snapshot['created_at'],
                'status'         => $snapshot['status'],
                'currency'       => $snapshot['currency'],
                'subtotal'       => $snapshot['subtotal'],
                'discount_total' => $snapshot['discount_total'],
                'shipping_total' => $snapshot['shipping_total'],
                'tax_total'      => $snapshot['tax_total'],
                'total'          => $snapshot['total'],
                'line_items'     => $snapshot['line_items'],
            ),
        );

        if ( '' !== $snapshot['payment_method_title'] || '' !== $snapshot['transaction_id'] || '' !== $snapshot['paid_at'] ) {
            $payment_parts = array();

            if ( '' !== $snapshot['payment_method_title'] ) {
                $payment_parts[] = 'Payment method: ' . $snapshot['payment_method_title'] . '.';
            }

            if ( '' !== $snapshot['transaction_id'] ) {
                $payment_parts[] = 'Transaction reference: ' . $snapshot['transaction_id'] . '.';
            }

            if ( '' !== $snapshot['paid_at'] ) {
                $payment_parts[] = 'Paid: ' . $snapshot['paid_at'] . '.';
            }

            $observations[] = array(
                'id'     => 'obs-' . $index++,
                'kind'   => 'woocommerce_payment_summary',
                'label'  => 'Payment summary',
                'detail' => implode( ' ', $payment_parts ),
                'data'   => array(
                    'payment_method_title' => $snapshot['payment_method_title'],
                    'transaction_id'       => $snapshot['transaction_id'],
                    'paid_at'              => $snapshot['paid_at'],
                ),
            );
        }

        if ( ! empty( $snapshot['shipping_lines'] ) || '' !== $snapshot['completed_at'] ) {
            $fulfilment_parts = array();

            if ( ! empty( $snapshot['shipping_lines'] ) ) {
                $methods = array();

                foreach ( $snapshot['shipping_lines'] as $shipping_line ) {
                    if ( '' !== $shipping_line['method'] ) {
                        $methods[] = $shipping_line['method'];
                    }
                }

                if ( ! empty( $methods ) ) {
                    $fulfilment_parts[] = 'Shipping method: ' . implode( ', ', $methods ) . '.';
                }
            }

            if ( '' !== $snapshot['completed_at'] ) {
                $fulfilment_parts[] = 'Order completed: ' . $snapshot['completed_at'] . '.';
            }

            if ( ! empty( $fulfilment_parts ) ) {
                $observations[] = array(
                    'id'     => 'obs-' . $index++,
                    'kind'   => 'woocommerce_fulfilment_summary',
                    'label'  => 'Fulfilment summary',
                    'detail' => implode( ' ', $fulfilment_parts ),
                    'data'   => array(
                        'shipping_lines' => $snapshot['shipping_lines'],
                        'completed_at'   => $snapshot['completed_at'],
                    ),
                );
            }
        }

        $draft = array(
            'schema_version'    => 1,
            'source'            => array(
                'producer_id'      => 'org.tracepack.woocommerce',
                'producer_name'    => 'TracePack for WooCommerce',
                'producer_version' => (string) $producer_version,
            ),
            'capture_timestamp' => gmdate( DATE_ATOM ),
            'source_url'        => $snapshot['source_url'],
            'evidence_type'     => 'woocommerce_order_record',
            'attachments'       => array(),
            'observations'      => $observations,
            'metadata'          => array(
                'subject'            => 'WooCommerce order ' . $snapshot['order_number'],
                'external_reference' => 'Order #' . $snapshot['order_number'],
            ),
            'integrity'         => array(
                'algorithm'        => 'sha256',
                'canonicalization' => 'RFC8785',
                'payload_hash'     => str_repeat( '0', 64 ),
            ),
        );

        $draft['integrity']['payload_hash'] = self::compute_payload_hash( $draft );

        return $draft;
    }

    public static function compute_payload_hash( array $payload ) {
        $hashable = $payload;

        $hashable['attachments'] = array_map(
            static function ( array $attachment ) {
                unset( $attachment['data'] );
                return $attachment;
            },
            $hashable['attachments']
        );

        $hashable['integrity'] = array(
            'algorithm'        => $payload['integrity']['algorithm'],
            'canonicalization' => $payload['integrity']['canonicalization'],
        );

        return hash( 'sha256', self::canonicalize( $hashable ) );
    }

    /**
     * Canonicalizes the deliberately restricted JSON subset produced by this plugin.
     *
     * All producer-controlled numbers are encoded as strings before they reach this method.
     * The only numeric values in the first vertical slice are fixed integer protocol/schema
     * values. Object keys are fixed ASCII identifiers owned by this plugin. Rejecting floats
     * and non-ASCII object keys keeps PHP's platform-specific number/key ordering behaviour out
     * of the integrity calculation while still producing RFC 8785-compatible output for this
     * payload shape. Cross-language fixtures must continue to prove parity with
     * @tracepack/evidence-sdk before this restriction is widened.
     */
    public static function canonicalize( $value ) {
        if ( null === $value ) {
            return 'null';
        }

        if ( true === $value ) {
            return 'true';
        }

        if ( false === $value ) {
            return 'false';
        }

        if ( is_int( $value ) ) {
            return (string) $value;
        }

        if ( is_float( $value ) ) {
            throw new RuntimeException( 'Floating-point values are not allowed in the WooCommerce TracePack canonical payload. Encode monetary and measured values as strings.' );
        }

        if ( is_string( $value ) ) {
            $encoded = json_encode( $value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES );

            if ( false === $encoded ) {
                throw new RuntimeException( 'A string in the WooCommerce TracePack payload is not valid UTF-8.' );
            }

            return $encoded;
        }

        if ( ! is_array( $value ) ) {
            throw new RuntimeException( 'Unsupported value in the WooCommerce TracePack canonical payload.' );
        }

        if ( self::is_list( $value ) ) {
            $parts = array();

            foreach ( $value as $entry ) {
                $parts[] = self::canonicalize( $entry );
            }

            return '[' . implode( ',', $parts ) . ']';
        }

        $keys = array_keys( $value );

        foreach ( $keys as $key ) {
            if ( ! is_string( $key ) || 1 !== preg_match( '/^[\x20-\x7E]+$/D', $key ) ) {
                throw new RuntimeException( 'Object keys in the WooCommerce TracePack payload must be fixed ASCII strings.' );
            }
        }

        sort( $keys, SORT_STRING );
        $parts = array();

        foreach ( $keys as $key ) {
            $encoded_key = json_encode( $key, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES );

            if ( false === $encoded_key ) {
                throw new RuntimeException( 'Could not encode a WooCommerce TracePack payload key.' );
            }

            $parts[] = $encoded_key . ':' . self::canonicalize( $value[ $key ] );
        }

        return '{' . implode( ',', $parts ) . '}';
    }

    private static function is_list( array $value ) {
        if ( array() === $value ) {
            return true;
        }

        return array_keys( $value ) === range( 0, count( $value ) - 1 );
    }

    private static function display_value( $value ) {
        return '' === (string) $value ? 'not recorded' : (string) $value;
    }
}
