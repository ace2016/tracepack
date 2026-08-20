<?php

namespace TracePack\WooCommerce;

final class OrderSnapshot
{
    public static function from_order( \WC_Order $order ) {
        $line_items = array();

        foreach ( $order->get_items( 'line_item' ) as $item ) {
            $line_items[] = array(
                'name'       => (string) $item->get_name(),
                'quantity'   => (string) $item->get_quantity(),
                'subtotal'   => self::money_value( $item->get_subtotal() ),
                'total'      => self::money_value( $item->get_total() ),
                'total_tax'  => self::money_value( $item->get_total_tax() ),
            );
        }

        $shipping_lines = array();

        foreach ( $order->get_items( 'shipping' ) as $item ) {
            $shipping_lines[] = array(
                'method'     => method_exists( $item, 'get_method_title' ) ? (string) $item->get_method_title() : (string) $item->get_name(),
                'total'      => self::money_value( $item->get_total() ),
                'total_tax'  => self::money_value( $item->get_total_tax() ),
            );
        }

        return array(
            'internal_id'           => (string) $order->get_id(),
            'order_number'          => (string) $order->get_order_number(),
            'source_url'            => (string) $order->get_edit_order_url(),
            'created_at'            => self::date_value( $order->get_date_created() ),
            'paid_at'               => self::date_value( $order->get_date_paid() ),
            'completed_at'          => self::date_value( $order->get_date_completed() ),
            'status'                => (string) $order->get_status(),
            'currency'              => (string) $order->get_currency(),
            'subtotal'              => self::money_value( $order->get_subtotal() ),
            'discount_total'        => self::money_value( $order->get_discount_total() ),
            'shipping_total'        => self::money_value( $order->get_shipping_total() ),
            'tax_total'             => self::money_value( $order->get_total_tax() ),
            'total'                 => self::money_value( $order->get_total() ),
            'payment_method_title'  => (string) $order->get_payment_method_title(),
            'transaction_id'        => (string) $order->get_transaction_id(),
            'line_items'            => $line_items,
            'shipping_lines'        => $shipping_lines,
        );
    }

    private static function money_value( $value ) {
        if ( function_exists( 'wc_format_decimal' ) ) {
            return (string) wc_format_decimal( $value, wc_get_price_decimals() );
        }

        return (string) $value;
    }

    private static function date_value( $date ) {
        if ( ! $date ) {
            return '';
        }

        return $date->date( DATE_ATOM );
    }
}
