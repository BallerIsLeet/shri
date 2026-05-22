// THE single source of truth for R2 keys. Everything in the system that builds
// an R2 path must come through here. See docs/08-storage-and-data.md.
//
// Adding a new prefix? Add a helper here, not in the caller.

export const keys = {
  asset: (slug: string, id: string, ext: string): string =>
    `projects/${slug}/assets/${id}.${stripDot(ext)}`,

  characterBase: (slug: string, characterId: string): string =>
    `projects/${slug}/characters/${characterId}/base.png`,

  characterSheet: (slug: string, characterId: string): string =>
    `projects/${slug}/characters/${characterId}/sheet.jpg`,

  characterView: (slug: string, characterId: string, pose: string): string =>
    `projects/${slug}/characters/${characterId}/views/${pose}.png`,

  outputSlide: (slug: string, itemId: string, n: number): string =>
    `projects/${slug}/outputs/${itemId}/slide-${n}.png`,

  outputComposite: (slug: string, itemId: string): string =>
    `projects/${slug}/outputs/${itemId}/composite.png`,

  outputSeedance: (slug: string, itemId: string): string =>
    `projects/${slug}/outputs/${itemId}/seedance.mp4`,

  outputSeedanceScene: (slug: string, itemId: string, sceneOrder: number): string =>
    `projects/${slug}/outputs/${itemId}/seedance-${sceneOrder}.mp4`,

  outputVoice: (slug: string, itemId: string): string =>
    `projects/${slug}/outputs/${itemId}/voice.mp3`,

  outputFinal: (slug: string, itemId: string): string =>
    `projects/${slug}/outputs/${itemId}/final.mp4`,

  thumb: (slug: string, itemId: string): string =>
    `projects/${slug}/thumbs/${itemId}.jpg`,
} as const;

function stripDot(ext: string): string {
  return ext.startsWith(".") ? ext.slice(1) : ext;
}

export type KeyBuilders = typeof keys;
