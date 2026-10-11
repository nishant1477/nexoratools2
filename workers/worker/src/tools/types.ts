import type { Logger } from 'pino';
import type { Env } from '@nexora/config';
import type { FileKind, ToolId, ToolOptions } from '@nexora/shared';

export interface InputFile { filename: string; path: string; kind: FileKind; size: number }
export interface OutputFile { path: string; filename: string; mimeType: string }

export interface ProcessorContext<O = Record<string, unknown>> {
  jobId: string;
  options: O;
  inputs: InputFile[];
  workDir: string; // scratch space; deleted after the job
  env: Env;
  signal: AbortSignal; // aborted on timeout / shutdown
  log: Logger;
}

export type Processor = (ctx: ProcessorContext) => Promise<OutputFile[]>;

/** Type-safe way to declare a processor: options are inferred from the tool's zod schema. */
export function defineProcessor<Id extends ToolId>(
  id: Id,
  run: (ctx: ProcessorContext<ToolOptions<Id>>) => Promise<OutputFile[]>,
): { id: Id; run: Processor } {
  return { id, run: run as unknown as Processor };
}
