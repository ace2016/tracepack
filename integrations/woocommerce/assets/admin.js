(function () {
  "use strict";

  var button = document.getElementById("tracepack-send-order");
  var status = document.getElementById("tracepack-send-order-status");
  var config = window.tracepackWooCommerce || {};
  var activeTracepackTab = null;
  var handoffActive = false;

  if (!button || !status) return;

  function showStatus(message) {
    status.textContent = message;
  }

  function setBusy(busy) {
    button.disabled = busy;
    button.setAttribute("aria-busy", busy ? "true" : "false");
  }

  function closeWindowSafely(target) {
    if (!target) return;

    try {
      if (!target.closed) target.close();
    } catch (error) {
      // Best effort only.
    }
  }

  button.addEventListener("click", async function () {
    if (
      handoffActive &&
      activeTracepackTab &&
      !activeTracepackTab.closed
    ) {
      try {
        activeTracepackTab.focus();
      } catch (error) {
        // Focusing another tab is best-effort on mobile browsers.
      }

      showStatus(
        "TracePack is already open for this order. Continue there to finish the import."
      );
      return;
    }

    if (
      !window.confirm(
        "Send this WooCommerce order to your TracePack tab for review? Nothing is added until you confirm it in TracePack."
      )
    ) {
      return;
    }

    if (
      !window.TracePackIntegration ||
      typeof window.TracePackIntegration.createTracepackHandoff !== "function" ||
      typeof window.TracePackIntegration.startTracepackBrowserHandoff !== "function"
    ) {
      showStatus(
        "The TracePack integration bundle is not available. Build the WooCommerce integration assets and refresh this page."
      );
      return;
    }

    var tracepackTab = window.open("about:blank", "_blank");

    if (!tracepackTab) {
      showStatus(
        "Your browser blocked the TracePack tab. Allow popups for this site and try again."
      );
      return;
    }

    activeTracepackTab = tracepackTab;
    var handoffStarted = false;

    setBusy(true);
    showStatus("Preparing order evidence...");

    try {
      var form = new FormData();
      form.append("action", config.ajaxAction || "tracepack_woocommerce_payload");
      form.append("order_id", button.getAttribute("data-order-id") || "");
      form.append("nonce", button.getAttribute("data-nonce") || "");

      var response = await fetch(config.ajaxUrl, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
        },
        body: form,
      });

      var result = await response.json();

      if (!response.ok || !result || result.success !== true || !result.data) {
        var message =
          result && result.data && result.data.message
            ? result.data.message
            : "WooCommerce could not prepare this TracePack evidence record.";
        throw new Error(message);
      }

      var payload = result.data.payload;
      var reference =
        result.data.reference || button.getAttribute("data-reference") || "";

      var handoff = window.TracePackIntegration.createTracepackHandoff({
        evidencePayload: payload,
        context: {
          purpose: "order_evidence",
          reference: reference,
        },
        template: {
          mode: "suggest",
          template_id: "woocommerce-order-evidence",
        },
      });

      var session = window.TracePackIntegration.startTracepackBrowserHandoff({
        tracepackUrl: config.tracepackUrl || "https://app.tracepack.org",
        targetWindow: tracepackTab,
        handoff: handoff,
        onStatus: function (message) {
          if (message.type === "accepted") {
            handoffActive = true;
            setBusy(false);
            showStatus(
              "Received by TracePack. Continue in the opened TracePack tab to review the order evidence."
            );
          }

          if (message.type === "rejected") {
            showStatus(
              "TracePack rejected this handoff. Check the opened tab for details."
            );
          }

          if (message.type === "cancelled") {
            showStatus("The TracePack handoff was cancelled.");
          }
        },
      });

      handoffStarted = true;
      handoffActive = true;
      showStatus("Opening TracePack...");

      var imported = await session.completion;
      var count = imported.evidence_count;

      showStatus(
        "Added to TracePack (" +
          count +
          " item" +
          (count === 1 ? "" : "s") +
          ")."
      );

      handoffActive = false;
      activeTracepackTab = null;
    } catch (error) {
      if (!handoffStarted) {
        closeWindowSafely(tracepackTab);
      }

      handoffActive = false;
      activeTracepackTab = null;

      var code =
        error && typeof error === "object" && typeof error.code === "string"
          ? error.code
          : "";

      if (code === "TIMED_OUT") {
        showStatus(
          "TracePack did not answer. Keep this order open and try again."
        );
      } else if (code === "CANCELLED") {
        showStatus("The TracePack handoff was cancelled.");
      } else {
        showStatus(
          error instanceof Error
            ? error.message
            : "Something went wrong preparing the TracePack handoff."
        );
      }
    } finally {
      setBusy(false);
    }
  });
})();
