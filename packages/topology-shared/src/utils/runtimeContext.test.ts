import { describe, expect, it } from "vitest";
import type { TopologyData } from "../types/topology";
import { readExpressionPath } from "./expression";
import { buildTopologyExpressionContext } from "./runtimeContext";

const topology: TopologyData = { id: "demo", name: "演示", version: "1", dataSources: [{ sourceId: "latest", enabled: true }], nodes: [{ key: "device_001", typeId: "device", label: "断路器", loc: "0 0", props: { identifier: "qf1" } }], links: [] };

describe("buildTopologyExpressionContext", () => {
  it("exposes the same source, node and short-path aliases", () => {
    const context = buildTopologyExpressionContext(topology, { latest: { data: { qf1: { status: "closed" } } } });
    expect(readExpressionPath(context, "latest.data.qf1.status")).toBe("closed");
    expect(readExpressionPath(context, "qf1.status")).toBe("closed");
    expect(readExpressionPath(context, "device_001.status")).toBe("closed");
  });
});
