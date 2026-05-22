"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { ChatPanel, type ChatTurn } from "@/components/ChatPanel";

// /projects/[slug]/characters/new — toggle between Form and Chat modes.
// Both modes end up creating a Character row with description set.
// See docs/14-characters.md "Onboarding".

export default function NewCharacterPage({
  params,
}: {
  params: { slug: string };
}): JSX.Element {
  const { slug } = params;
  const router = useRouter();
  const utils = trpc.useUtils();

  const [mode, setMode] = useState<"FORM" | "CHAT">("FORM");

  const createCharacter = trpc.character.create.useMutation({
    onSuccess: async (c) => {
      await utils.character.listForProject.invalidate({ projectSlug: slug });
      router.push(`/projects/${slug}/characters/${c.id}`);
    },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">New character</h1>
      <div className="flex gap-2">
        <button
          type="button"
          className={`btn ${mode === "FORM" ? "btn-primary" : ""}`}
          onClick={() => setMode("FORM")}
        >
          Form mode
        </button>
        <button
          type="button"
          className={`btn ${mode === "CHAT" ? "btn-primary" : ""}`}
          onClick={() => setMode("CHAT")}
        >
          Chat mode
        </button>
      </div>

      {mode === "FORM" ? (
        <FormMode
          onSubmit={(values) =>
            createCharacter.mutate({
              projectSlug: slug,
              ...values,
              basisMode: "FORM",
            })
          }
          pending={createCharacter.isPending}
          error={createCharacter.error?.message ?? null}
        />
      ) : (
        <ChatMode slug={slug} />
      )}
    </div>
  );
}

function FormMode({
  onSubmit,
  pending,
  error,
}: {
  onSubmit: (values: {
    name: string;
    species?: string;
    age?: string;
    gender?: string;
    visualStyle?: string;
    description: string;
  }) => void;
  pending: boolean;
  error: string | null;
}): JSX.Element {
  const [name, setName] = useState("");
  const [species, setSpecies] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [visualStyle, setVisualStyle] = useState("");
  const [description, setDescription] = useState("");

  return (
    <form
      className="card space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          name,
          species: species || undefined,
          age: age || undefined,
          gender: gender || undefined,
          visualStyle: visualStyle || undefined,
          description,
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="block">
          <span className="label">Species / type</span>
          <input
            className="input"
            value={species}
            onChange={(e) => setSpecies(e.target.value)}
            placeholder="human, fox, robot…"
          />
        </label>
        <label className="block">
          <span className="label">Age</span>
          <input className="input" value={age} onChange={(e) => setAge(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">Gender</span>
          <input className="input" value={gender} onChange={(e) => setGender(e.target.value)} />
        </label>
        <label className="block sm:col-span-2">
          <span className="label">Visual style</span>
          <input
            className="input"
            value={visualStyle}
            onChange={(e) => setVisualStyle(e.target.value)}
            placeholder="soft pastel watercolor / low-poly 3D / minimal line drawing"
          />
        </label>
      </div>
      <label className="block">
        <span className="label">Description (2-4 sentences)</span>
        <textarea
          className="input textarea min-h-[140px]"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
        />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Save & start generation"}
        </button>
      </div>
    </form>
  );
}

function ChatMode({ slug }: { slug: string }): JSX.Element {
  const router = useRouter();
  const utils = trpc.useUtils();
  // We need a Character row before chat_design_character can persist its
  // history. Create a placeholder with mode=CHAT on first send; subsequent
  // turns operate on that row.
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = trpc.character.create.useMutation();
  const chat = trpc.character.chat.useMutation();
  const update = trpc.character.update.useMutation();

  async function ensureCharacter(): Promise<string> {
    if (characterId) return characterId;
    const c = await create.mutateAsync({
      projectSlug: slug,
      name: "Untitled (chat draft)",
      description: "placeholder — refined via chat",
      basisMode: "CHAT",
    });
    setCharacterId(c.id);
    return c.id;
  }

  async function onSend(message: string): Promise<void> {
    try {
      setError(null);
      const id = await ensureCharacter();
      const result = await chat.mutateAsync({
        projectSlug: slug,
        characterId: id,
        message,
        priorTurns: turns,
      });
      const out = result as {
        reply: string;
        suggestedDescription: string | null;
        turns: ChatTurn[];
      };
      setTurns(out.turns);
      setSuggestion(out.suggestedDescription);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onAdoptSuggestion(description: string): Promise<void> {
    if (!characterId) return;
    await update.mutateAsync({ id: characterId, patch: { description } });
    await utils.character.listForProject.invalidate({ projectSlug: slug });
    router.push(`/projects/${slug}/characters/${characterId}`);
  }

  return (
    <div className="card">
      <ChatPanel
        turns={turns}
        pending={chat.isPending || create.isPending}
        onSend={(m) => void onSend(m)}
        suggestion={suggestion}
        onAdoptSuggestion={(d) => void onAdoptSuggestion(d)}
      />
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
