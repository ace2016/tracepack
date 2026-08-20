<?php

namespace TracePack\WooCommerce;

final class Plugin
{
    const VERSION = '0.1.0';
    const AJAX_ACTION = 'tracepack_woocommerce_payload';
    const NONCE_PREFIX = 'tracepack_woocommerce_order_';

    private $plugin_file;

    public function __construct( $plugin_file ) {
        $this->plugin_file = $plugin_file;
    }

    public function register_hooks() {
        add_action( 'add_meta_boxes', array( $this, 'register_order_metabox' ) );
        add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_admin_assets' ) );
        add_action( 'wp_ajax_' . self::AJAX_ACTION, array( $this, 'handle_payload_request' ) );
    }

    public function register_order_metabox() {
        foreach ( $this->order_screen_ids() as $screen_id ) {
            add_meta_box(
                'tracepack-woocommerce-order',
                'TracePack',
                array( $this, 'render_order_metabox' ),
                $screen_id,
                'side',
                'high'
            );
        }
    }

    public function render_order_metabox( $post_or_order ) {
        $order = $this->resolve_order( $post_or_order );

        if ( ! $order ) {
            echo '<p>' . esc_html__( 'TracePack could not read this WooCommerce order.', 'tracepack-for-woocommerce' ) . '</p>';
            return;
        }

        if ( ! current_user_can( 'edit_shop_orders' ) ) {
            echo '<p>' . esc_html__( 'You do not have permission to send this order to TracePack.', 'tracepack-for-woocommerce' ) . '</p>';
            return;
        }

        $order_id = $order->get_id();
        $nonce = wp_create_nonce( self::NONCE_PREFIX . $order_id );
        $reference = 'Order #' . $order->get_order_number();

        echo '<p>' . esc_html__( 'Create a portable evidence record from this WooCommerce order.', 'tracepack-for-woocommerce' ) . '</p>';
        echo '<p><button type="button" class="button button-primary" id="tracepack-send-order"';
        echo ' data-order-id="' . esc_attr( (string) $order_id ) . '"';
        echo ' data-nonce="' . esc_attr( $nonce ) . '"';
        echo ' data-reference="' . esc_attr( $reference ) . '">';
        echo esc_html__( 'Send to TracePack', 'tracepack-for-woocommerce' );
        echo '</button></p>';
        echo '<p class="description">' . esc_html__( 'Nothing is added until you review and confirm it in TracePack.', 'tracepack-for-woocommerce' ) . '</p>';
        echo '<p id="tracepack-send-order-status" class="description" aria-live="polite"></p>';
    }

    public function enqueue_admin_assets() {
        if ( ! function_exists( 'get_current_screen' ) ) {
            return;
        }

        $screen = get_current_screen();

        if ( ! $screen || ! in_array( $screen->id, $this->order_screen_ids(), true ) ) {
            return;
        }

        $asset_url = plugin_dir_url( $this->plugin_file ) . 'assets/';
        $integration_path = plugin_dir_path( $this->plugin_file ) . 'assets/tracepack-integration.js';

        if ( file_exists( $integration_path ) ) {
            wp_enqueue_script(
                'tracepack-integration',
                $asset_url . 'tracepack-integration.js',
                array(),
                self::VERSION,
                true
            );
        }

        wp_enqueue_script(
            'tracepack-for-woocommerce',
            $asset_url . 'admin.js',
            file_exists( $integration_path ) ? array( 'tracepack-integration' ) : array(),
            self::VERSION,
            true
        );

        wp_localize_script(
            'tracepack-for-woocommerce',
            'tracepackWooCommerce',
            array(
                'ajaxUrl'      => admin_url( 'admin-ajax.php' ),
                'ajaxAction'   => self::AJAX_ACTION,
                'tracepackUrl' => 'https://app.tracepack.org',
            )
        );
    }

    public function handle_payload_request() {
        if ( ! current_user_can( 'edit_shop_orders' ) ) {
            wp_send_json_error( array( 'message' => 'You do not have permission to send WooCommerce orders to TracePack.' ), 403 );
        }

        $order_id = isset( $_POST['order_id'] ) ? absint( wp_unslash( $_POST['order_id'] ) ) : 0;

        if ( ! $order_id ) {
            wp_send_json_error( array( 'message' => 'A valid WooCommerce order ID is required.' ), 400 );
        }

        check_ajax_referer( self::NONCE_PREFIX . $order_id, 'nonce' );

        $order = wc_get_order( $order_id );

        if ( ! $order instanceof \WC_Order ) {
            wp_send_json_error( array( 'message' => 'WooCommerce could not find this order.' ), 404 );
        }

        try {
            $snapshot = OrderSnapshot::from_order( $order );
            $payload = EvidencePayloadBuilder::build( $snapshot, self::VERSION );
        } catch ( \Throwable $error ) {
            wp_send_json_error( array( 'message' => 'TracePack could not prepare this order evidence.' ), 500 );
        }

        wp_send_json_success(
            array(
                'payload'   => $payload,
                'reference' => 'Order #' . $order->get_order_number(),
            )
        );
    }

    private function resolve_order( $post_or_order ) {
        if ( $post_or_order instanceof \WC_Order ) {
            return $post_or_order;
        }

        if ( $post_or_order instanceof \WP_Post ) {
            return wc_get_order( $post_or_order->ID );
        }

        return false;
    }

    private function order_screen_ids() {
        $screen_ids = array( 'shop_order' );

        if ( function_exists( 'wc_get_page_screen_id' ) ) {
            $screen_ids[] = wc_get_page_screen_id( 'shop-order' );
        }

        return array_values( array_unique( array_filter( $screen_ids ) ) );
    }
}
