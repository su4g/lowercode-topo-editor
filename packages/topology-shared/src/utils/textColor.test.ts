import { describe, expect, it } from "vitest";
import { DEFAULT_TOPOLOGY_TEXT_COLOR } from "../types/topology";
import { resolveTopologyTextColor } from "./textColor";

describe("resolveTopologyTextColor", () => {
  it("uses the first explicit color and otherwise the white default", () => {
    expect(resolveTopologyTextColor("", "#abcdef")).toBe("#abcdef");
    expect(resolveTopologyTextColor(undefined, "")).toBe(DEFAULT_TOPOLOGY_TEXT_COLOR);
  });
});
