import { loadTemplate } from "@tracepack/template-engine";
import consumerComplaintYaml from "../../../templates/consumer-complaint/template.yaml?raw";
import provenanceTraceYaml from "../../../templates/provenance-trace/template.yaml?raw";
import generalYaml from "../../../templates/general/template.yaml?raw";

// Each shipped template lives once, in templates/<id>/template.yaml -- imported here as raw
// text (Vite resolves `?raw` at build time) rather than duplicated as an inline string. A
// template used to be copy-pasted into this file by hand, which meant `templates/*/template.yaml`
// (what a contributor edits and what the CLI validates) and what actually shipped could quietly
// drift out of sync. Adding a new template is now: add `templates/<id>/template.yaml`, add one
// import line and one array entry here -- no YAML re-typed anywhere.
//
// An array, not a single constant, so a template picker has something real to iterate over
// instead of a UI that only makes sense for exactly one entry.
export const templates = [
  loadTemplate(consumerComplaintYaml),
  loadTemplate(provenanceTraceYaml),
  loadTemplate(generalYaml),
];
