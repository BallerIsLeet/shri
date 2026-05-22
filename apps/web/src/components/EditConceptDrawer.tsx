"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Drawer } from "@/components/Drawer";

// Per-item edit drawer — the centerpiece UI. Renders a form keyed off
// item.type so REEL gets the Seedance script + camera + voiceover; CAROUSEL_*
// get slide / overlay editors.
//
// Contract (docs/16-editable-concepts.md):
//  - Saving calls item.updateConcept which bumps conceptRevision and persists
//    conceptJson. aiConceptJson stays untouched as audit trail.
//  - "Reset to AI version" calls item.resetConcept which copies aiConceptJson
//    back into conceptJson and bumps the revision.

export type ItemForDrawer = {
  id: string;
  type: "REEL" | "CAROUSEL_CANVA" | "CAROUSEL_TEXT_OVERLAY";
  hook: string;
  conceptJson: unknown;
  aiConceptJson: unknown;
  conceptRevision: number;
};

type Concept = Record<string, unknown>;

// Enums mirror `cameraPerspectiveSchema` in packages/orchestrator/src/runBriefJob.ts
// EXACTLY. Drift here causes silent data corruption — runItemJob's Zod parse
// throws and the reel never generates. See CLAUDE.md #6.
const FRAMING_OPTIONS = [
  "extreme_wide",
  "wide",
  "medium",
  "close_up",
  "extreme_close_up",
] as const;
const ANGLE_OPTIONS = [
  "low",
  "eye_level",
  "high",
  "birds_eye",
  "dutch",
] as const;
const MOVEMENT_OPTIONS = [
  "static",
  "pan",
  "tilt",
  "dolly_in",
  "dolly_out",
  "tracking",
  "handheld",
  "crane",
] as const;
const LENS_OPTIONS = ["wide_angle", "normal", "telephoto", "macro"] as const;
const FOCUS_OPTIONS = ["shallow_dof", "deep_dof", "rack_focus"] as const;
// Transition values mirror `reelSceneSchema.transitionToNext` in runBriefJob.ts.
const TRANSITION_OPTIONS = [
  "hard_cut",
  "dissolve",
  "match_cut",
  "whip_pan",
  "fade_to_black",
] as const;

function toObject(value: unknown): Concept {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Concept;
  }
  return {};
}

export function EditConceptDrawer({
  open,
  onClose,
  item,
  estimatedCost,
  onSave,
  onReset,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  item: ItemForDrawer | null;
  estimatedCost: number | null;
  onSave: (next: Concept) => Promise<void> | void;
  onReset: () => Promise<void> | void;
  saving: boolean;
}): JSX.Element | null {
  const [draft, setDraft] = useState<Concept>({});

  useEffect(() => {
    if (item) setDraft(toObject(item.conceptJson));
  }, [item]);

  if (!item) return null;

  function patch(updater: (prev: Concept) => Concept): void {
    setDraft((prev) => updater(prev));
  }

  function setField(key: string, value: unknown): void {
    patch((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Edit ${item.type.toLowerCase()}: "${item.hook}"`}
      footer={
        <>
          <span className="muted mr-auto text-xs">
            rev {item.conceptRevision} · est ${estimatedCost?.toFixed(2) ?? "—"}
          </span>
          <button
            type="button"
            className="btn"
            onClick={() => void onReset()}
            disabled={saving}
          >
            Reset to AI version
          </button>
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void onSave(draft)}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      {item.type === "REEL" && <ReelEditor draft={draft} setField={setField} patch={patch} />}
      {item.type === "CAROUSEL_CANVA" && (
        <CanvaCarouselEditor draft={draft} setField={setField} patch={patch} />
      )}
      {item.type === "CAROUSEL_TEXT_OVERLAY" && (
        <TextOverlayEditor draft={draft} setField={setField} />
      )}
    </Drawer>
  );
}

// ---------- REEL --------------------------------------------------------------

function ReelEditor({
  draft,
  setField,
  patch,
}: {
  draft: Concept;
  setField: (k: string, v: unknown) => void;
  patch: (u: (p: Concept) => Concept) => void;
}): JSX.Element {
  const hook = (draft.hook as string) ?? "";
  const audioMode = (draft.audioMode as string) ?? "seedance";
  const durationS = (draft.durationS as number) ?? 8;
  const voiceoverText = (draft.voiceoverText as string) ?? "";
  const caption = (draft.caption as string) ?? "";
  const notes = (draft.notes as string) ?? "";
  const environment = (draft.environment as Concept) ?? {};
  const scenes = (Array.isArray(draft.scenes) ? draft.scenes : []) as Array<Concept>;

  function currentScenes(prev: Concept): Array<Concept> {
    return Array.isArray(prev.scenes) ? (prev.scenes as Array<Concept>) : [];
  }
  function setScene(idx: number, updater: (s: Concept) => Concept): void {
    patch((prev) => ({
      ...prev,
      scenes: currentScenes(prev).map((s, i) => (i === idx ? updater(s) : s)),
    }));
  }
  function addScene(): void {
    patch((prev) => {
      const cur = currentScenes(prev);
      return {
        ...prev,
        scenes: [
          ...cur,
          {
            order: cur.length,
            durationS: 4,
            seedanceScript: {
              prompt: "",
              cameraPerspective: {
                framing: "medium",
                angle: "eye_level",
                movement: "static",
                lens: "normal",
                focus: "shallow_dof",
              },
            },
          },
        ],
      };
    });
  }
  function removeScene(idx: number): void {
    patch((prev) => ({
      ...prev,
      scenes: currentScenes(prev).filter((_, i) => i !== idx),
    }));
  }
  function moveScene(idx: number, dir: -1 | 1): void {
    patch((prev) => {
      const cur = currentScenes(prev);
      const next = [...cur];
      const tgt = idx + dir;
      if (tgt < 0 || tgt >= next.length) return prev;
      const a = next[idx];
      const b = next[tgt];
      if (!a || !b) return prev;
      next[idx] = b;
      next[tgt] = a;
      return { ...prev, scenes: next };
    });
  }

  return (
    <div className="space-y-5">
      <Row>
        <Field label="Hook">
          <input
            className="input"
            value={hook}
            onChange={(e) => setField("hook", e.target.value)}
          />
        </Field>
      </Row>

      <Row cols={3}>
        <Field label="Duration (s)">
          <input
            className="input"
            type="number"
            min={1}
            max={60}
            value={durationS}
            onChange={(e) => setField("durationS", Number(e.target.value))}
          />
        </Field>
        <Field label="Audio mode">
          <select
            className="select"
            value={audioMode}
            onChange={(e) => setField("audioMode", e.target.value)}
          >
            <option value="seedance">seedance</option>
            <option value="silent">silent</option>
            <option value="voiceover">voiceover</option>
          </select>
        </Field>
        <Field label="Caption">
          <input
            className="input"
            value={caption}
            onChange={(e) => setField("caption", e.target.value)}
          />
        </Field>
      </Row>

      {audioMode === "voiceover" && (
        <Field label="Voiceover text">
          <textarea
            className="input textarea min-h-[80px]"
            value={voiceoverText}
            onChange={(e) => setField("voiceoverText", e.target.value)}
            placeholder="Read aloud over the reel."
          />
        </Field>
      )}

      <fieldset className="rounded-md border border-ink/10 p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Environment (shared by every scene)
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Setting">
            <input
              className="input"
              value={(environment.setting as string) ?? ""}
              onChange={(e) =>
                setField("environment", { ...environment, setting: e.target.value })
              }
              placeholder="e.g. warm domestic interior, late afternoon"
            />
          </Field>
          <Field label="Mood">
            <input
              className="input"
              value={(environment.mood as string) ?? ""}
              onChange={(e) =>
                setField("environment", { ...environment, mood: e.target.value })
              }
              placeholder="e.g. nostalgic, slightly playful"
            />
          </Field>
          <Field label="Palette">
            <input
              className="input"
              value={(environment.palette as string) ?? ""}
              onChange={(e) =>
                setField("environment", { ...environment, palette: e.target.value })
              }
            />
          </Field>
          <Field label="Lighting">
            <input
              className="input"
              value={(environment.lighting as string) ?? ""}
              onChange={(e) =>
                setField("environment", { ...environment, lighting: e.target.value })
              }
            />
          </Field>
        </div>
      </fieldset>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Scenes ({scenes.length})</h3>
          <button type="button" className="btn" onClick={addScene}>
            + Add scene
          </button>
        </div>
        {scenes.length === 0 && (
          <p className="muted text-xs">
            No scenes yet. Single-scene is the default — add one to start.
          </p>
        )}
        <div className="space-y-3">
          {scenes.map((scene, i) => (
            <SceneEditor
              key={i}
              index={i}
              isFirst={i === 0}
              isLast={i === scenes.length - 1}
              scene={scene}
              onChange={(updater) => setScene(i, updater)}
              onRemove={() => removeScene(i)}
              onMoveUp={() => moveScene(i, -1)}
              onMoveDown={() => moveScene(i, 1)}
            />
          ))}
        </div>
      </div>

      <Field label="Notes (not sent to Seedance)">
        <textarea
          className="input textarea min-h-[60px]"
          value={notes}
          onChange={(e) => setField("notes", e.target.value)}
        />
      </Field>

      <CharacterRefsEditor draft={draft} setField={setField} />
    </div>
  );
}

function SceneEditor({
  index,
  isFirst,
  isLast,
  scene,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  index: number;
  isFirst: boolean;
  isLast: boolean;
  scene: Concept;
  onChange: (u: (s: Concept) => Concept) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}): JSX.Element {
  const sd = (scene.seedanceScript as Concept) ?? {};
  const cam = (sd.cameraPerspective as Concept) ?? {};

  function setSd(key: string, value: unknown): void {
    onChange((prev) => ({
      ...prev,
      seedanceScript: { ...((prev.seedanceScript as Concept) ?? {}), [key]: value },
    }));
  }
  function setCam(key: string, value: unknown): void {
    onChange((prev) => {
      const cur = (prev.seedanceScript as Concept) ?? {};
      const curCam = (cur.cameraPerspective as Concept) ?? {};
      return {
        ...prev,
        seedanceScript: { ...cur, cameraPerspective: { ...curCam, [key]: value } },
      };
    });
  }

  return (
    <div className="rounded-md border border-ink/10 bg-cream/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Scene {index + 1}
        </span>
        <div className="flex gap-1">
          <button type="button" className="btn btn-ghost" onClick={onMoveUp} disabled={isFirst}>
            ↑
          </button>
          <button type="button" className="btn btn-ghost" onClick={onMoveDown} disabled={isLast}>
            ↓
          </button>
          <button type="button" className="btn btn-ghost" onClick={onRemove}>
            Remove
          </button>
        </div>
      </div>
      <Field label="Seedance prompt">
        <textarea
          className="input textarea min-h-[80px]"
          value={(sd.prompt as string) ?? ""}
          onChange={(e) => setSd("prompt", e.target.value)}
          placeholder="Describe THIS beat — recap environment for continuity."
        />
      </Field>
      <Row cols={5}>
        <Field label="Framing">
          <SelectEnum
            value={(cam.framing as string) ?? "medium"}
            options={FRAMING_OPTIONS}
            onChange={(v) => setCam("framing", v)}
          />
        </Field>
        <Field label="Angle">
          <SelectEnum
            value={(cam.angle as string) ?? "eye_level"}
            options={ANGLE_OPTIONS}
            onChange={(v) => setCam("angle", v)}
          />
        </Field>
        <Field label="Movement">
          <SelectEnum
            value={(cam.movement as string) ?? "static"}
            options={MOVEMENT_OPTIONS}
            onChange={(v) => setCam("movement", v)}
          />
        </Field>
        <Field label="Lens">
          <SelectEnum
            value={(cam.lens as string) ?? "normal"}
            options={LENS_OPTIONS}
            onChange={(v) => setCam("lens", v)}
          />
        </Field>
        <Field label="Focus">
          <SelectEnum
            value={(cam.focus as string) ?? "shallow_dof"}
            options={FOCUS_OPTIONS}
            onChange={(v) => setCam("focus", v)}
          />
        </Field>
      </Row>
      <Row cols={3}>
        <Field label="Duration (s)">
          <input
            className="input"
            type="number"
            min={1}
            max={30}
            value={(scene.durationS as number) ?? 4}
            onChange={(e) =>
              onChange((prev) => ({ ...prev, durationS: Number(e.target.value) }))
            }
          />
        </Field>
        <Field label="Transition to next">
          <SelectEnum
            value={(scene.transitionToNext as string) ?? "hard_cut"}
            options={TRANSITION_OPTIONS}
            onChange={(v) =>
              onChange((prev) => ({ ...prev, transitionToNext: v }))
            }
          />
        </Field>
        <Field label="Character view R2 key (optional)">
          <input
            className="input"
            value={(scene.characterViewR2Key as string) ?? ""}
            onChange={(e) =>
              onChange((prev) => ({ ...prev, characterViewR2Key: e.target.value }))
            }
            placeholder="i2v anchor"
          />
        </Field>
      </Row>
    </div>
  );
}

function CharacterRefsEditor({
  draft,
  setField,
}: {
  draft: Concept;
  setField: (k: string, v: unknown) => void;
}): JSX.Element {
  const characterIds = (Array.isArray(draft.characterIds)
    ? draft.characterIds
    : []) as string[];
  return (
    <Field label="Character IDs (comma-separated)">
      <input
        className="input"
        value={characterIds.join(", ")}
        onChange={(e) =>
          setField(
            "characterIds",
            e.target.value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          )
        }
        placeholder="ck_… , ck_…"
      />
    </Field>
  );
}

// ---------- CAROUSEL_CANVA ----------------------------------------------------

function CanvaCarouselEditor({
  draft,
  setField,
  patch,
}: {
  draft: Concept;
  setField: (k: string, v: unknown) => void;
  patch: (u: (p: Concept) => Concept) => void;
}): JSX.Element {
  const hook = (draft.hook as string) ?? "";
  const caption = (draft.caption as string) ?? "";
  const slides = (Array.isArray(draft.slides) ? draft.slides : []) as Array<Concept>;

  function currentSlides(prev: Concept): Array<Concept> {
    return Array.isArray(prev.slides) ? (prev.slides as Array<Concept>) : [];
  }
  function setSlide(idx: number, updater: (s: Concept) => Concept): void {
    patch((prev) => ({
      ...prev,
      slides: currentSlides(prev).map((s, i) => (i === idx ? updater(s) : s)),
    }));
  }
  function removeSlide(idx: number): void {
    patch((prev) => ({
      ...prev,
      slides: currentSlides(prev).filter((_, i) => i !== idx),
    }));
  }
  function addSlide(): void {
    patch((prev) => ({
      ...prev,
      slides: [
        ...currentSlides(prev),
        { spec: { layers: [] }, embeddedImagePrompts: [] as unknown[] },
      ],
    }));
  }

  return (
    <div className="space-y-5">
      <Field label="Hook">
        <input
          className="input"
          value={hook}
          onChange={(e) => setField("hook", e.target.value)}
        />
      </Field>
      <Field label="Caption">
        <input
          className="input"
          value={caption}
          onChange={(e) => setField("caption", e.target.value)}
        />
      </Field>
      <CharacterRefsEditor draft={draft} setField={setField} />

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Slides ({slides.length})</h3>
          <button type="button" className="btn" onClick={addSlide}>
            + Add slide
          </button>
        </div>
        <div className="space-y-3">
          {slides.map((slide, i) => (
            <details
              key={i}
              className="rounded-md border border-ink/10 bg-cream/30 p-3"
            >
              <summary className="cursor-pointer text-sm font-semibold">
                Slide {i + 1}
              </summary>
              <div className="mt-3 space-y-2">
                <Field label="Slide spec (JSON)">
                  <textarea
                    className="input textarea min-h-[140px]"
                    value={JSON.stringify(slide.spec ?? {}, null, 2)}
                    onChange={(e) => {
                      try {
                        const parsed = JSON.parse(e.target.value);
                        setSlide(i, (prev) => ({ ...prev, spec: parsed }));
                      } catch {
                        // Ignore invalid JSON mid-typing — user keeps editing.
                        setSlide(i, (prev) => ({
                          ...prev,
                          _specRaw: e.target.value,
                        }));
                      }
                    }}
                  />
                </Field>
                <Field label="Embedded image prompts (JSON array)">
                  <textarea
                    className="input textarea min-h-[100px]"
                    value={JSON.stringify(slide.embeddedImagePrompts ?? [], null, 2)}
                    onChange={(e) => {
                      try {
                        const parsed = JSON.parse(e.target.value);
                        setSlide(i, (prev) => ({
                          ...prev,
                          embeddedImagePrompts: parsed,
                        }));
                      } catch {
                        setSlide(i, (prev) => ({
                          ...prev,
                          _imagePromptsRaw: e.target.value,
                        }));
                      }
                    }}
                  />
                </Field>
                <Field label="Notes">
                  <input
                    className="input"
                    value={(slide.notes as string) ?? ""}
                    onChange={(e) =>
                      setSlide(i, (prev) => ({ ...prev, notes: e.target.value }))
                    }
                  />
                </Field>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => removeSlide(i)}
                >
                  Remove slide
                </button>
              </div>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- CAROUSEL_TEXT_OVERLAY --------------------------------------------

function TextOverlayEditor({
  draft,
  setField,
}: {
  draft: Concept;
  setField: (k: string, v: unknown) => void;
}): JSX.Element {
  const hook = (draft.hook as string) ?? "";
  const caption = (draft.caption as string) ?? "";
  const basePrompt = (draft.basePrompt as string) ?? "";
  const overlayText = (draft.overlayText as string) ?? "";
  const textStyle = (draft.textStyle as Concept) ?? {};
  return (
    <div className="space-y-5">
      <Field label="Hook">
        <input
          className="input"
          value={hook}
          onChange={(e) => setField("hook", e.target.value)}
        />
      </Field>
      <Field label="Base prompt (the photo)">
        <textarea
          className="input textarea min-h-[100px]"
          value={basePrompt}
          onChange={(e) => setField("basePrompt", e.target.value)}
        />
      </Field>
      <Field label="Overlay text (the headline)">
        <textarea
          className="input textarea min-h-[60px]"
          value={overlayText}
          onChange={(e) => setField("overlayText", e.target.value)}
        />
      </Field>
      <Row cols={4}>
        <Field label="Font">
          <SelectEnum
            value={(textStyle.font as string) ?? "Inter"}
            options={["Inter", "Inter-Bold", "DM-Serif", "JetBrains-Mono"] as const}
            onChange={(v) => setField("textStyle", { ...textStyle, font: v })}
          />
        </Field>
        <Field label="Size">
          <input
            className="input"
            type="number"
            value={(textStyle.size as number) ?? 96}
            onChange={(e) =>
              setField("textStyle", { ...textStyle, size: Number(e.target.value) })
            }
          />
        </Field>
        <Field label="Color">
          <input
            className="input"
            value={(textStyle.color as string) ?? "#0f172a"}
            onChange={(e) =>
              setField("textStyle", { ...textStyle, color: e.target.value })
            }
          />
        </Field>
        <Field label="Align">
          <SelectEnum
            value={(textStyle.align as string) ?? "center"}
            options={["left", "center", "right"] as const}
            onChange={(v) => setField("textStyle", { ...textStyle, align: v })}
          />
        </Field>
      </Row>
      <Field label="Caption">
        <input
          className="input"
          value={caption}
          onChange={(e) => setField("caption", e.target.value)}
        />
      </Field>
    </div>
  );
}

// ---------- Layout helpers ----------------------------------------------------

function Row({ cols = 1, children }: { cols?: number; children: ReactNode }): JSX.Element {
  const cls =
    cols === 1
      ? "grid gap-3"
      : cols === 2
        ? "grid gap-3 sm:grid-cols-2"
        : cols === 3
          ? "grid gap-3 sm:grid-cols-3"
          : cols === 4
            ? "grid gap-3 sm:grid-cols-4"
            : "grid gap-3 sm:grid-cols-5";
  return <div className={cls}>{children}</div>;
}

function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

function SelectEnum({
  value,
  options,
  onChange,
}: {
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}): JSX.Element {
  return (
    <select
      className="select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}
