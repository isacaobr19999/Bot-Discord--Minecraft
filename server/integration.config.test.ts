import { describe, expect, it, afterEach } from "vitest";
import { hasValidIntegrationKey, integrationHealthHandler } from "./integration-api";

type MockResponse = {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (value: unknown) => MockResponse;
};

function createResponse(): MockResponse {
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      response.statusCode = code;
      return response;
    },
    json(value: unknown) {
      response.body = value;
      return response;
    },
  };
  return response;
}

describe("integration health endpoint", () => {
  const originalKey = process.env.INTEGRATION_API_KEY;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.INTEGRATION_API_KEY;
    else process.env.INTEGRATION_API_KEY = originalKey;
  });

  it("accepts the configured integration secret through the API handler", () => {
    process.env.INTEGRATION_API_KEY = "integration-test-key";
    const response = createResponse();
    integrationHealthHandler(
      { header: (name: string) => (name === "x-integration-key" ? "integration-test-key" : undefined) } as never,
      response as never,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ ok: true, service: "minecraft-discord-platform" });
  });

  it("rejects a missing or incorrect secret", () => {
    process.env.INTEGRATION_API_KEY = "integration-test-key";
    expect(hasValidIntegrationKey("wrong-key")).toBe(false);

    const response = createResponse();
    integrationHealthHandler({ header: () => undefined } as never, response as never);
    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual({ ok: false, error: "UNAUTHORIZED" });
  });
});
