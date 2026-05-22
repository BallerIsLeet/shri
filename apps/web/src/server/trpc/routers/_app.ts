import { router } from "../init";
import { projectRouter } from "./project";
import { characterRouter } from "./character";
import { assetRouter } from "./asset";
import { briefRouter } from "./brief";
import { itemRouter } from "./item";
import { outputRouter } from "./output";
import { promptRouter } from "./prompt";
import { jobRouter } from "./job";

export const appRouter = router({
  project: projectRouter,
  character: characterRouter,
  asset: assetRouter,
  brief: briefRouter,
  item: itemRouter,
  output: outputRouter,
  prompt: promptRouter,
  job: jobRouter,
});

export type AppRouter = typeof appRouter;
