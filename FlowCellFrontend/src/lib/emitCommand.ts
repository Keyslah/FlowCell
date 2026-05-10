import type { CommandEnvelope, CommandResult } from "../types";
import { emitBackendEnvelope } from "./tauri";

export async function emitCommand(
  commandEnvelope: CommandEnvelope
): Promise<CommandResult> {
  return emitBackendEnvelope(commandEnvelope);
}
