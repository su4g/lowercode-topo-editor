import { describe, expect, it } from "vitest";
import { defaultRuntimeSource } from "./dataSource";

describe("default runtime source", () => {
  it("prefers an enabled source named default when multiple sources are enabled", () => {
    const source = defaultRuntimeSource({
      dataSources: [
        { sourceId: "other", type: "http", enabled: true },
        { sourceId: "default", type: "http", enabled: true }
      ]
    });
    expect(source?.sourceId).toBe("default");
  });

  it("falls back to the only enabled source and otherwise returns null", () => {
    expect(defaultRuntimeSource({
      dataSources: [
        { sourceId: "only", type: "http", enabled: true },
        { sourceId: "disabled", type: "http", enabled: false }
      ]
    })?.sourceId).toBe("only");
    expect(defaultRuntimeSource({
      dataSources: [
        { sourceId: "a", type: "http", enabled: true },
        { sourceId: "b", type: "http", enabled: true }
      ]
    })).toBeNull();
    expect(defaultRuntimeSource({
      dataSources: [
        { sourceId: "default", type: "http", enabled: false },
        { sourceId: "only", type: "http", enabled: true }
      ]
    })?.sourceId).toBe("only");
  });

});
