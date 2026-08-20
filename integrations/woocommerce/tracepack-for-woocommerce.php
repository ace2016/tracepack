<?php
/**
 * Plugin Name: TracePack for WooCommerce
 * Description: Create a portable TracePack evidence record from a WooCommerce order.
 * Version: 0.1.0
 * Requires at least: 6.5
 * Requires PHP: 7.4
 * Requires Plugins: woocommerce
 * License: GPL-2.0-or-later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: tracepack-for-woocommerce
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

require_once __DIR__ . '/src/OrderSnapshot.php';
require_once __DIR__ . '/src/EvidencePayloadBuilder.php';
require_once __DIR__ . '/src/Plugin.php';

add_action(
    'before_woocommerce_init',
    static function () {
        if ( class_exists( '\\Automattic\\WooCommerce\\Utilities\\FeaturesUtil' ) ) {
            \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility(
                'custom_order_tables',
                __FILE__,
                true
            );
        }
    }
);

add_action(
    'plugins_loaded',
    static function () {
        if ( ! class_exists( 'WooCommerce' ) ) {
            return;
        }

        $plugin = new \TracePack\WooCommerce\Plugin( __FILE__ );
        $plugin->register_hooks();
    }
);
