import { describe, expect, it } from "vitest";
import { topologyDataSchema } from "./topology";

describe("topologyDataSchema", () => {
  it("keeps standalone editor fields and strips platform virtual-device bindings", () => {
    const parsed = topologyDataSchema.parse({
      id: "demo",
      name: "独立拓扑",
      version: "1.0.0",
      schemaVersion: 2,
      dataSources: [{ refId: "source-ref-1", sourceId: "latest" }],
      canvas: { width: 1920, height: 1080 },
      nodes: [{
        key: "n1",
        typeId: "device",
        label: "设备",
        loc: "0 0",
        labelOffset: { x: 8, y: 4 },
        virtualBinding: { deviceId: 1, pointIds: [2] }
      }],
      links: []
    });

    expect(parsed.canvas).toEqual({ width: 1920, height: 1080 });
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.dataSources?.[0]?.refId).toBe("source-ref-1");
    expect(parsed.nodes[0]?.labelOffset).toEqual({ x: 8, y: 4 });
    expect(parsed.nodes[0]).not.toHaveProperty("virtualBinding");
  });
});
