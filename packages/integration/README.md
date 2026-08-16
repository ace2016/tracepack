# @tracepack/integration

Send evidence from another product into TracePack through a deliberate, versioned browser handoff.

## Install

    npm install @tracepack/integration

## What it does

Use @tracepack/evidence-sdk to build and validate a TracePack evidence payload.

Use @tracepack/integration to hand that payload into TracePack.

TracePack then presents the incoming evidence for human review before it becomes part of the local pack.

## Browser handoff

Import these helpers from the package:

    import {
      createTracepackHandoff,
      startTracepackBrowserHandoff,
    } from "@tracepack/integration";

The integration protocol supports:

* explicit target origin checks
* unique handoff identifiers
* version checks
* message source checks
* lifecycle acknowledgements
* replay protection
* timeouts
* template recommendation intent
* deliberate human review

A valid payload does not mean TracePack trusts the producer claims.

Producer identity remains self asserted in interchange v1.

Attachment integrity, payload integrity, producer identity, truth and evidential weight remain separate concepts.

## Browser bundle

The package also builds:

    dist/browser.global.js

The browser global is exposed as:

    TracePackIntegration

## Related packages

    npm install @tracepack/evidence-sdk
    npm install @tracepack/template-engine
    npm install @tracepack/evidence-core
    npm install -g @tracepack/cli

Developer documentation is available at dev.tracepack.org.

## Licence

Apache License 2.0.
