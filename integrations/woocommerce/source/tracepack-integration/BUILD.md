# TracePack browser integration source

This directory contains the human-readable source for:

    ../../assets/tracepack-integration.js

It is included with TracePack for WooCommerce so the bundled browser
JavaScript can be inspected and rebuilt without access to the private
TracePack development repository.

## Requirements

- Node.js 18 or later
- npm

## Build

From this directory run:

    npm install
    npm run build

The generated bundle is written to:

    dist/tracepack-integration.js

## Build settings

The browser bundle uses esbuild with:

- platform: browser
- format: iife
- global name: TracePackIntegration
- target: es2022
- minification enabled
- source maps enabled

## Source layout

integration/src/
    TracePack browser handoff source.

evidence-sdk/src/
    TracePack evidence validation source used by the handoff.

The build maps @tracepack/evidence-sdk to the local included SDK source.

## Third-party dependencies

The generated bundle also includes code from:

- canonicalize
- zod

These packages are installed from npm during the build.

The TracePack integration and evidence SDK source in this directory is
licensed under the Apache License, Version 2.0.
