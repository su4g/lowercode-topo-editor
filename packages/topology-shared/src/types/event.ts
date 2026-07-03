import type { TopologyLink, TopologyNode } from "./topology";
import type { RuntimeStyle } from "./runtime";

export type TopologyCanvasApi = {
  setGroupVisible(groupKey: string, visible: boolean): void;
  setNodeVisible(nodeKey: string, visible: boolean): void;
  setNodeRuntime(nodeKey: string, runtime: Record<string, unknown>): void;
  setLinkRuntime(linkKey: string, runtime: Record<string, unknown>): void;
  focusNode(nodeKey: string): void;
  focusGroup(groupKey: string): void;
  selectNode(nodeKey: string): void;
  applyExternalEvent(event: TopologyExternalEvent): void;
  refreshRuntimeData(): Promise<void>;
};

export type TopologyExternalEvent =
  | { type: "SET_GROUP_VISIBLE"; target: string; visible: boolean; cascade?: boolean; reason?: string }
  | { type: "SET_GROUP_STYLE"; target: string; style: RuntimeStyle; reason?: string }
  | { type: "FOCUS_NODE"; target: string }
  | { type: "FOCUS_GROUP"; target: string; expand?: boolean }
  | { type: "SET_NODE_RUNTIME"; target: string; runtime: Record<string, unknown> }
  | { type: "SET_LINK_RUNTIME"; target: string; runtime: Record<string, unknown> };

export type TopologyEvent =
  | { type: "NODE_CLICK"; mode: "edit" | "runtime"; nodeKey: string; nodeType: string; nodeData: TopologyNode }
  | { type: "NODE_DOUBLE_CLICK"; mode: "edit" | "runtime"; nodeKey: string; nodeType: string; nodeData: TopologyNode }
  | { type: "NODE_CONTEXT_MENU"; mode: "edit" | "runtime"; nodeKey: string; nodeType: string; nodeData: TopologyNode; position: { x: number; y: number } }
  | { type: "NODE_EVENT"; mode: "edit" | "runtime"; trigger: "click" | "doubleClick" | "contextMenu"; eventName: string; eventKey: string; nodeKey: string; nodeType: string; nodeData: TopologyNode; bindNodeKey?: string; data: Record<string, unknown> }
  | { type: "LINK_CLICK"; mode: "edit" | "runtime"; linkKey: string; linkData: TopologyLink }
  | { type: "GROUP_CLICK"; mode: "edit" | "runtime"; groupKey: string; groupData: TopologyNode };
