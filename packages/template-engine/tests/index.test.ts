import { describe, expect, it } from "vitest";
import { loadTemplate, parseTemplateObject, serializeTemplate } from "../src/index";

function minimalTemplate(privacyRules?: Array<{ kind: string; label: string; pattern: string; flags?: string }>) {
  return {
    id: "example",
    name: "Example template",
    version: "1.0.0",
    jurisdiction: "general",
    categories: [{ id: "docs", name: "Documents", requirement: "required", description: "", accepted_types: ["pdf"] }],
    export_sections: ["cover"],
    ...(privacyRules ? { privacy_rules: privacyRules } : {}),
  };
}

describe("loadTemplate / parseTemplateObject: privacy_rules validation", () => {
  it("accepts a rule with a valid pattern and no flags", () => {
    const template = parseTemplateObject(minimalTemplate([{ kind: "custom", label: "Custom", pattern: "[a-z]+" }]));
    expect(template.privacyRules).toHaveLength(1);
  });

  it("accepts a rule with a valid pattern and valid flags", () => {
    const template = parseTemplateObject(minimalTemplate([{ kind: "custom", label: "Custom", pattern: "[a-z]+", flags: "gi" }]));
    expect(template.privacyRules).toHaveLength(1);
  });

  it("rejects a rule whose pattern alone does not compile", () => {
    expect(() => parseTemplateObject(minimalTemplate([{ kind: "custom", label: "Custom", pattern: "(unclosed" }]))).toThrow(/regular expression/);
  });

  // The actual bug this guards against: a pattern that compiles perfectly well on its own can
  // still throw once its own declared flags are added (an invalid flag letter, or a duplicated
  // one). Before this was fixed, only the bare pattern was checked here, so a rule like this
  // passed template-load validation, then got silently dropped later by document-engine's
  // compileTemplateRules -- meaning the PII detection this rule promised never actually ran,
  // with no error or warning anywhere a template author would see it.
  it("rejects a rule with an invalid flag letter, even though the pattern alone is valid", () => {
    expect(() => parseTemplateObject(minimalTemplate([{ kind: "custom", label: "Custom", pattern: "[a-z]+", flags: "x" }]))).toThrow(/pattern and flags together/);
  });

  it("rejects a rule with duplicated flags, even though the pattern alone is valid", () => {
    expect(() => parseTemplateObject(minimalTemplate([{ kind: "custom", label: "Custom", pattern: "[a-z]+", flags: "gg" }]))).toThrow(/pattern and flags together/);
  });

  it("loadTemplate (the YAML-authored path) enforces the same pattern+flags check", () => {
    const yaml = `
id: example
name: Example template
version: 1.0.0
jurisdiction: general
privacy_rules:
  - kind: broken
    label: Broken rule
    pattern: '[a-z]+'
    flags: 'x'
categories:
  - id: docs
    name: Documents
    requirement: required
    description: ""
    accepted_types: [pdf]
export_sections: [cover]
`;
    expect(() => loadTemplate(yaml)).toThrow(/pattern and flags together/);
  });
});

describe("serializeTemplate", () => {
  it("round trips a reusable template file without losing its rules", () => {
    const original = parseTemplateObject({
      ...minimalTemplate([{ kind: "reference", label: "Reference", pattern: "REF-[0-9]+", flags: "i" }]),
      chronology_rules: { max_gap_days: 30 },
      guidance: [{ category_id: "docs", text: "Make the date visible." }],
    });
    expect(loadTemplate(serializeTemplate(original))).toEqual(original);
  });

  it("never exports local trust labels into a portable template file", () => {
    const template = { ...parseTemplateObject(minimalTemplate()), localOrigin: "imported" as const, importedFileName: "outside.yaml" };
    const yaml = serializeTemplate(template);
    expect(yaml).not.toContain("localOrigin");
    expect(yaml).not.toContain("importedFileName");
  });
});

describe("external template validation", () => {
  it("rejects duplicate category identities with a human explanation", () => {
    expect(() => loadTemplate(`id: duplicate\nname: Duplicate\nversion: "1"\njurisdiction: general\ncategories:\n  - { id: docs, name: First, requirement: required, description: '', accepted_types: [pdf] }\n  - { id: docs, name: Second, requirement: optional, description: '', accepted_types: [image] }\nexport_sections: [cover]\n`)).toThrow(/category identities must be unique/);
  });

  it("rejects guidance for a category that does not exist", () => {
    expect(() => parseTemplateObject({ ...minimalTemplate(), guidance: [{ category_id: "missing", text: "Help" }] })).toThrow(/must refer to a category/);
  });
});
