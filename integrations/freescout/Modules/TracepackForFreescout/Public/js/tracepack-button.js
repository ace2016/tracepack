(function () {
  "use strict";

  var button = document.getElementById("send-to-tracepack-btn");
  var status = document.getElementById("send-to-tracepack-status");
  var activeTracepackTab = null;
  var handoffActive = false;

  if (!button || !status) return;

  function showStatus(message) {
    status.style.display = "block";
    status.textContent = message;
  }

  function setBusy(busy) {
    button.style.pointerEvents = busy ? "none" : "";
    button.setAttribute("aria-disabled", busy ? "true" : "false");
  }

  function closeWindowSafely(target) {
    if (!target) return;

    try {
      if (!target.closed) target.close();
    } catch {
      // Best effort only.
    }
  }

  button.addEventListener("click", async function (event) {
    event.preventDefault();

    if (
      handoffActive &&
      activeTracepackTab &&
      !activeTracepackTab.closed
    ) {
      try {
        activeTracepackTab.focus();
      } catch {
        // Focusing another tab is best-effort on mobile browsers.
      }

      showStatus(
        "Tracepack is already open for this conversation. Continue there to finish the import."
      );
      return;
    }

    if (
      !window.confirm(
        "Send the complete conversation and all supported attachments to your Tracepack tab for review? Nothing is added until you confirm it in Tracepack."
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
        "The Tracepack integration could not be loaded. Refresh the page and try again."
      );
      return;
    }

    // Open synchronously while we are still inside the user's click gesture.
    // The common TracePack browser helper will navigate this tab only after
    // the evidence payload has been prepared and its message listener exists.
    var tracepackTab = window.open("about:blank", "_blank");

    if (!tracepackTab) {
      showStatus(
        "Your browser blocked the popup. Allow popups for this site and try again."
      );
      return;
    }

    var handoffStarted = false;

    activeTracepackTab = tracepackTab;

    setBusy(true);
    showStatus("Preparing evidence...");

    try {
      var response = await fetch(
        button.getAttribute("data-payload-url"),
        {
          headers: {
            Accept: "application/json",
          },
        }
      );

      if (!response.ok) {
        throw new Error(
          "Could not build the evidence payload (HTTP " +
            response.status +
            ")."
        );
      }

      var payload = await response.json();

      var context = {
        purpose: "support_case",
      };

      var reference = button.getAttribute("data-reference");

      if (reference) {
        context.reference = reference;
      }

      var handoff =
        window.TracePackIntegration.createTracepackHandoff({
          evidencePayload: payload,
          context: context,
          template: {
            mode: "recommend",
          },
        });

      var session =
        window.TracePackIntegration.startTracepackBrowserHandoff({
          tracepackUrl: button.getAttribute("data-tracepack-url"),
          targetWindow: tracepackTab,
          handoff: handoff,

          onStatus: function (message) {
            if (message.type === "accepted") {
              handoffActive = true;

              showStatus(
                "Received by Tracepack. Continue in the opened Tracepack tab."
              );

              // The handoff is safely queued for review now. Make the menu
              // usable again without destroying the session that is still
              // waiting for TracePack's final imported acknowledgement.
              setBusy(false);
            }

            if (message.type === "rejected") {
              showStatus(
                "Tracepack rejected this handoff. Check the opened tab for details."
              );
            }

            if (message.type === "cancelled") {
              showStatus("The Tracepack handoff was cancelled.");
            }
          },
        });

      handoffStarted = true;
      handoffActive = true;
      showStatus("Opening Tracepack...");

      var imported = await session.completion;
      var count = imported.evidence_count;

      showStatus(
        "Added to the customer's Tracepack pack (" +
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
        error &&
        typeof error === "object" &&
        typeof error.code === "string"
          ? error.code
          : "";

      if (code === "TIMED_OUT") {
        showStatus(
          "Tracepack did not answer. Keep this conversation open and try again."
        );
      } else if (code === "REJECTED") {
        showStatus(
          error.message || "Tracepack rejected this evidence handoff."
        );
      } else if (code === "CANCELLED") {
        showStatus("The Tracepack handoff was cancelled.");
      } else {
        showStatus(
          error instanceof Error
            ? error.message
            : "Something went wrong preparing the Tracepack handoff."
        );
      }
    } finally {
      setBusy(false);
    }
  });
})();
