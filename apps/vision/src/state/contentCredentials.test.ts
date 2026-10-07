// VIS-C2PA-02 — Content Credentials on an *incoming* file. The native plugin
// hands back the raw `c2pa::Reader` report; this proves we reduce it to the
// facts the File Info dialog shows, and that a signature which failed to
// validate is surfaced rather than quietly rendered as a clean credential.
//
// REPORT is a real report captured from `c2pa_sign.rs`'s round-trip test (a
// signed export chained over a signed parent), trimmed of thumbnails and the
// success list.
import { describe, expect, it } from "vitest";

import { summarizeContentCredentials, VERIFY_URL } from "./contentCredentials";

const REPORT = JSON.stringify(
  {
    "active_manifest": "urn:c2pa:5c941edc-0bde-4f2a-a08d-aceda4156edb",
    "manifests": {
      "urn:c2pa:936a1bca-aac2-4a60-bebf-1ff3f3a0a165": {
        "claim_generator_info": [
          {
            "name": "Monet Vision",
            "version": "0.1.0",
            "org.contentauth.c2pa_rs": "0.89.0"
          }
        ],
        "title": "Monet Vision Export",
        "instance_id": "xmp:iid:8a01941f-bbc3-4022-8abc-8fcda08b61bc",
        "assertions": [
          {
            "label": "c2pa.actions.v2",
            "data": {
              "actions": [
                {
                  "action": "c2pa.created"
                }
              ]
            }
          },
          {
            "label": "stds.schema-org.CreativeWork",
            "data": {
              "@context": "https://schema.org",
              "@type": "CreativeWork"
            },
            "kind": "Json"
          }
        ],
        "signature_info": {
          "alg": "Es256",
          "issuer": "Monet",
          "common_name": "Monet Vision Dev Signer",
          "cert_serial_number": "154842234208574034390307887293372884702673699990"
        },
        "label": "urn:c2pa:936a1bca-aac2-4a60-bebf-1ff3f3a0a165",
        "claim_version": 2
      },
      "urn:c2pa:5c941edc-0bde-4f2a-a08d-aceda4156edb": {
        "claim_generator_info": [
          {
            "name": "Monet Vision",
            "version": "0.1.0",
            "org.contentauth.c2pa_rs": "0.89.0"
          }
        ],
        "title": "Monet Vision Export",
        "instance_id": "xmp:iid:6866b9f4-bafc-4070-b46e-b5e13db6e2c0",
        "ingredients": [
          {
            "title": "in.png",
            "format": "image/png",
            "instance_id": "xmp:iid:cf5244e6-1819-4aa0-a7ce-a153e1d15763",
            "relationship": "parentOf",
            "active_manifest": "urn:c2pa:936a1bca-aac2-4a60-bebf-1ff3f3a0a165",
            "manifest_data": {
              "format": "application/c2pa",
              "identifier": "urn:c2pa:936a1bca-aac2-4a60-bebf-1ff3f3a0a165"
            },
            "label": "c2pa.ingredient.v3"
          }
        ],
        "assertions": [
          {
            "label": "c2pa.actions.v2",
            "data": {
              "actions": [
                {
                  "action": "c2pa.opened",
                  "parameters": {
                    "ingredients": [
                      {
                        "url": "self#jumbf=c2pa.assertions/c2pa.ingredient.v3",
                        "hash": "RF+4Vc+1mlwSBwSNq6NQ9UbyInds0Xztg4HiSpxzvdo="
                      }
                    ]
                  }
                },
                {
                  "action": "c2pa.edited"
                }
              ]
            }
          },
          {
            "label": "stds.schema-org.CreativeWork",
            "data": {
              "@context": "https://schema.org",
              "@type": "CreativeWork"
            },
            "kind": "Json"
          }
        ],
        "signature_info": {
          "alg": "Es256",
          "issuer": "Monet",
          "common_name": "Monet Vision Dev Signer",
          "cert_serial_number": "154842234208574034390307887293372884702673699990"
        },
        "label": "urn:c2pa:5c941edc-0bde-4f2a-a08d-aceda4156edb",
        "claim_version": 2
      }
    },
    "validation_status": [
      {
        "code": "signingCredential.untrusted",
        "url": "self#jumbf=/c2pa/urn:c2pa:5c941edc-0bde-4f2a-a08d-aceda4156edb/c2pa.signature",
        "explanation": "signing certificate untrusted"
      }
    ],
    "validation_results": {
      "activeManifest": {
        "success": [],
        "informational": [],
        "failure": [
          {
            "code": "signingCredential.untrusted",
            "url": "self#jumbf=/c2pa/urn:c2pa:5c941edc-0bde-4f2a-a08d-aceda4156edb/c2pa.signature",
            "explanation": "signing certificate untrusted"
          }
        ]
      }
    },
    "validation_state": "Valid"
  },
);

describe("summarizeContentCredentials", () => {
  it("reduces a real reader report to who made it, who signed it, and what was done", () => {
    const s = summarizeContentCredentials(REPORT)!;
    expect(s.producer).toBe("Monet Vision 0.1.0");
    expect(s.title).toBe("Monet Vision Export");
    expect(s.signedBy).toBe("Monet");
    expect(s.signedOn).toBeNull(); // no timestamp authority configured
    expect(s.state).toBe("Valid");
    // Only the ACTIVE manifest's actions — the parent manifest in the same
    // store says "Created", which is not what happened to this file.
    expect(s.actions).toEqual(["Opened", "Edited"]);
    expect(s.ingredients).toEqual(["in.png"]);
  });

  it("surfaces why validation failed instead of showing a clean credential", () => {
    expect(summarizeContentCredentials(REPORT)!.issues).toEqual(["signing certificate untrusted"]);

    // v1 manifests have no validation_results; the status list still explains.
    const legacy = JSON.parse(REPORT) as Record<string, unknown>;
    delete legacy.validation_results;
    expect(summarizeContentCredentials(JSON.stringify(legacy))!.issues)
      .toEqual(["signing certificate untrusted"]);
  });

  it("treats an unusable report as nothing to show, never a thrown dialog", () => {
    expect(summarizeContentCredentials("not json")).toBeNull();
    expect(summarizeContentCredentials("[]")).toBeNull();
    // A store whose active manifest is missing from the map.
    expect(summarizeContentCredentials(JSON.stringify({ active_manifest: "x", manifests: {} }))).toBeNull();
  });

  it("degrades gracefully when the optional halves of a manifest are absent", () => {
    const bare = JSON.stringify({
      active_manifest: "m",
      manifests: { m: { claim_generator: "Some App/1.0" } },
    });
    const s = summarizeContentCredentials(bare)!;
    expect(s.producer).toBe("Some App/1.0");
    expect(s.signedBy).toBeNull();
    expect(s.state).toBe("Unknown");
    expect(s.actions).toEqual([]);
    expect(s.ingredients).toEqual([]);
    expect(s.issues).toEqual([]);
  });

  it("humanises action ids without inventing labels", () => {
    const report = JSON.stringify({
      active_manifest: "m",
      manifests: {
        m: {
          assertions: [{
            label: "c2pa.actions",
            data: { actions: [{ action: "c2pa.color_adjustments" }, { action: "com.vendor.thing" }] },
          }],
        },
      },
    });
    expect(summarizeContentCredentials(report)!.actions).toEqual(["Color adjustments", "Com vendor thing"]);
  });

  it("points at the independent verifier, not our own verdict", () => {
    expect(VERIFY_URL).toBe("https://contentcredentials.org/verify");
  });
});
