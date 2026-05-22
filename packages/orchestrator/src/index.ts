// @shri/orchestrator — Phase C orchestrator.
//
// Barrel re-exports for consumers (apps/worker, apps/web tRPC routes that
// want to enqueue + know queue names).

export { llmLoop } from "./llmLoop.js";
export type {
  LlmLoopOpts,
  LlmLoopResult,
  LoopLogEntry,
} from "./llmLoop.js";

export {
  loadProjectPrompts,
  composeBriefSystemPrompt,
  ALLOWED_PROMPT_FILES,
} from "./loadProjectPrompts.js";
export type { ProjectPrompts } from "./loadProjectPrompts.js";

export {
  runBriefJob,
  validateConceptJson,
  composeUserPrompt,
  briefEnvelopeSchema,
  reelConceptSchema,
  canvaCarouselConceptSchema,
  textOverlayConceptSchema,
  cameraPerspectiveSchema,
  environmentSchema,
  BRIEF_TIME_TOOLS,
} from "./runBriefJob.js";
export type {
  BriefEnvelope,
  RunBriefJobOpts,
  RunBriefJobResult,
} from "./runBriefJob.js";

export {
  runItemJob,
  completeReelAfterPoll,
  substituteImageLayers,
} from "./runItemJob.js";
export type {
  RunItemJobOpts,
  RunItemJobResult,
  ReelSubmitOutcome,
  CarouselOutcome,
  EnqueuePollTick,
} from "./runItemJob.js";

export {
  BRIEF_QUEUE,
  ITEM_QUEUE,
  SEEDANCE_POLL_QUEUE,
  QUEUE_NAMES,
  SEEDANCE_POLL_DELAY_MS,
  SEEDANCE_MAX_POLL_TICKS,
} from "./queues.js";
export type {
  QueueName,
  BriefJobPayload,
  ItemJobPayload,
  SeedancePollPayload,
} from "./queues.js";
