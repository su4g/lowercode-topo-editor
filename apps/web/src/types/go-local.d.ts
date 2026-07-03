declare module "*.js";

declare global {
  interface Window {
    go: typeof import("gojs");
  }
}

export {};
