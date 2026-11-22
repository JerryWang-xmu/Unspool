// Runner-owned execution entry point. Keeping this import in the build ensures
// the published Runner always includes the same guarded worker boundary tested
// by the approval contracts.
export { executeGuardedTool } from "../../../execution-worker/src/tools/wrapper.js";
