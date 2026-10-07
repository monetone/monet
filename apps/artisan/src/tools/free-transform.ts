import { createSelectionTool } from "./selection";
import type { Tool } from "./types";

export function createFreeTransformTool(): Tool {
  return createSelectionTool({ id: "free-transform" });
}
