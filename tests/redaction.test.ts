import { describe, it, expect } from "vitest";
import { redactString, redactJson, fingerprint, hasSecret } from "@core/redaction";

describe("redaction", () => {
  it("redacts an Anthropic API key and never keeps the raw value", () => {
    const secret = "sk-ant-api03-AAAABBBBCCCCDDDDEEEE3f9a";
    const { text, redactions } = redactString(`export ANTHROPIC_API_KEY=${secret}`);
    expect(text).not.toContain(secret);
    expect(text).toContain("•");
    expect(redactions.some((r) => r.kind === "api_key" || r.kind === "env_value")).toBe(true);
  });

  it("redacts GitHub tokens, JWTs, AWS keys and URL credentials", () => {
    const cases = [
      "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dumm_signature_here",
      "AKIAIOSFODNN7EXAMPLE",
      "postgres://user:supersecretpw@db.example.com:5432/app",
    ];
    for (const input of cases) {
      const { text } = redactString(input);
      expect(hasSecret(input)).toBe(true);
      // the raw secret token should be masked
      expect(text).toContain("•");
    }
  });

  it("redacts private key blocks", () => {
    const pk = "-----BEGIN RSA PRIVATE KEY-----\nMIIabc123\n-----END RSA PRIVATE KEY-----";
    const { text, redactions } = redactString(pk);
    expect(text).not.toContain("MIIabc123");
    expect(redactions[0].kind).toBe("private_key");
  });

  it("redacts .env-style secret assignments by value", () => {
    const { text, redactions } = redactString("DATABASE_PASSWORD=hunter2hunter2");
    expect(text).not.toContain("hunter2hunter2");
    expect(redactions.some((r) => r.kind === "env_value")).toBe(true);
  });

  it("redacts lowercase / mixed-case secret assignments (captured shell output)", () => {
    // Codex commonly captures `cat .env` style output with lowercase keys.
    for (const [input, secret] of [
      ["database_password=hunter2hunter2", "hunter2hunter2"],
      ["export my_api_key=abcdef123456", "abcdef123456"],
      ["Aws_Secret=zzzzzzzzzzzz", "zzzzzzzzzzzz"],
    ] as const) {
      const { text, redactions } = redactString(input);
      expect(text, input).not.toContain(secret);
      expect(redactions.some((r) => r.kind === "env_value"), input).toBe(true);
    }
  });

  it("walks nested JSON and records field paths", () => {
    const { value, redactions } = redactJson({
      command: "deploy",
      env: { TOKEN: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" },
    });
    const json = JSON.stringify(value);
    expect(json).not.toContain("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
    expect(redactions.length).toBeGreaterThan(0);
    expect(redactions[0].fieldPath.startsWith("$")).toBe(true);
  });

  it("produces a stable, non-empty fingerprint", () => {
    expect(fingerprint("abc")).toBe(fingerprint("abc"));
    expect(fingerprint("abc")).not.toBe(fingerprint("abd"));
    expect(fingerprint("abc")).toHaveLength(8);
  });

  it("leaves benign strings untouched", () => {
    const { text, redactions } = redactString("pnpm test && git status");
    expect(text).toBe("pnpm test && git status");
    expect(redactions).toHaveLength(0);
  });
});
