"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { EditConceptDrawer, type ItemForDrawer } from "@/components/EditConceptDrawer";

// The selection table — every row expands an Edit concept drawer. Checkboxes
// pick items; Generate selected enqueues per-item jobs. See docs/09-web-app.md
// "The selection table" and docs/16-editable-concepts.md.

type ConceptJson = Record<string, unknown>;

export default function BriefPage({
  params,
}: {
  params: { slug: string; id: string };
}): JSX.Element {
  const { id } = params;
  const router = useRouter();
  const utils = trpc.useUtils();

  const brief = trpc.brief.get.useQuery({ id });
  const items = trpc.item.listByBrief.useQuery({ briefId: id });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerItemId, setDrawerItemId] = useState<string | null>(null);

  const updateConcept = trpc.item.updateConcept.useMutation({
    onSuccess: async () => {
      await utils.item.listByBrief.invalidate({ briefId: id });
      if (drawerItemId) {
        await utils.item.estimateCost.invalidate({ itemId: drawerItemId });
      }
    },
  });
  const resetConcept = trpc.item.resetConcept.useMutation({
    onSuccess: async () => {
      await utils.item.listByBrief.invalidate({ briefId: id });
    },
  });
  const generateSelected = trpc.item.generateSelected.useMutation({
    onSuccess: async () => {
      await utils.item.listByBrief.invalidate({ briefId: id });
      router.push(`/jobs`);
    },
  });

  const drawerItem: ItemForDrawer | null = useMemo(() => {
    if (!drawerItemId || !items.data) return null;
    const it = items.data.find((i) => i.id === drawerItemId);
    if (!it) return null;
    return {
      id: it.id,
      type: it.type as ItemForDrawer["type"],
      hook: it.hook,
      conceptJson: it.conceptJson,
      aiConceptJson: it.aiConceptJson,
      conceptRevision: it.conceptRevision,
    };
  }, [drawerItemId, items.data]);

  const drawerCostQuery = trpc.item.estimateCost.useQuery(
    drawerItemId ? { itemId: drawerItemId } : { itemId: "" },
    { enabled: !!drawerItemId },
  );

  function toggle(id: string): void {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openDrawer(itemId: string): void {
    setDrawerItemId(itemId);
    setDrawerOpen(true);
  }

  function closeDrawer(): void {
    setDrawerOpen(false);
    // delay clearing so the transition doesn't flash empty content
    setTimeout(() => setDrawerItemId(null), 200);
  }

  async function handleSave(next: ConceptJson): Promise<void> {
    if (!drawerItemId) return;
    await updateConcept.mutateAsync({ itemId: drawerItemId, conceptJson: next });
    closeDrawer();
  }

  async function handleReset(): Promise<void> {
    if (!drawerItemId) return;
    await resetConcept.mutateAsync({ itemId: drawerItemId });
  }

  if (brief.isLoading) return <p className="muted">Loading brief…</p>;
  if (brief.error || !brief.data) return <p className="text-red-600">Brief not found.</p>;

  const itemList = items.data ?? [];
  const selectedItems = itemList.filter((i) => selected.has(i.id));
  const selectedTotal = selectedItems.reduce(
    (acc, i) => acc + (i.estCostUsd ?? 0),
    0,
  );

  return (
    <div className="space-y-6">
      <div>
        <p className="muted text-xs uppercase tracking-wide">Brief</p>
        <h1 className="text-2xl font-semibold">
          {brief.data.project.name} · #{brief.data.id.slice(0, 6)}
        </h1>
        <p className="muted mt-1 text-sm">
          {new Date(brief.data.createdAt).toLocaleString()} ·{" "}
          {brief.data.rangeDays} days · status {brief.data.status}
        </p>
      </div>

      {brief.data.rawJson && typeof brief.data.rawJson === "object" && "summary" in (brief.data.rawJson as object) && (
        <div className="card">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-muted">
            Director's summary
          </h2>
          <p className="whitespace-pre-wrap text-sm">
            {String((brief.data.rawJson as { summary?: unknown }).summary ?? "")}
          </p>
        </div>
      )}

      {itemList.length === 0 ? (
        <div className="card text-sm">
          <p className="muted">
            No items yet — the worker may still be generating. Refresh in a few
            seconds.
          </p>
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={selected.size === itemList.length}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? new Set(itemList.map((i) => i.id))
                          : new Set(),
                      )
                    }
                  />
                </th>
                <th>Type</th>
                <th>Platform</th>
                <th>Ratio</th>
                <th>Hook</th>
                <th>Cost</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {itemList.map((it) => (
                <tr key={it.id} className="hover:bg-cream/50">
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(it.id)}
                      onChange={() => toggle(it.id)}
                      disabled={it.status !== "PROPOSED" && it.status !== "SELECTED"}
                    />
                  </td>
                  <td className="font-mono text-xs">{it.type}</td>
                  <td className="text-xs">{it.platform.join(", ")}</td>
                  <td className="font-mono text-xs">{it.ratio}</td>
                  <td>
                    <button
                      type="button"
                      className="text-left text-sm hover:underline"
                      onClick={() => openDrawer(it.id)}
                    >
                      {it.hook}
                    </button>
                    {it.conceptRevision > 0 && (
                      <span className="muted ml-2 text-xs">
                        (edited · rev {it.conceptRevision})
                      </span>
                    )}
                  </td>
                  <td className="font-mono text-xs">
                    ${(it.estCostUsd ?? 0).toFixed(2)}
                  </td>
                  <td className="font-mono text-xs">{it.status}</td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => openDrawer(it.id)}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card flex items-center justify-between">
        <div className="text-sm">
          <strong>{selected.size}</strong> selected ·{" "}
          <span className="muted">est. ${selectedTotal.toFixed(2)}</span>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={selected.size === 0 || generateSelected.isPending}
          onClick={() =>
            generateSelected.mutate({ itemIds: Array.from(selected) })
          }
        >
          {generateSelected.isPending
            ? "Enqueueing…"
            : `Generate selected (${selected.size})`}
        </button>
      </div>
      {generateSelected.error && (
        <p className="text-sm text-red-600">{generateSelected.error.message}</p>
      )}

      <EditConceptDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        item={drawerItem}
        estimatedCost={drawerCostQuery.data?.usd ?? null}
        onSave={handleSave}
        onReset={handleReset}
        saving={updateConcept.isPending || resetConcept.isPending}
      />
    </div>
  );
}
