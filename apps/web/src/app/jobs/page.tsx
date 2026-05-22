"use client";

import { useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";

// /jobs — global log polled every 2s. Click a row to expand its logs[].

export default function JobsPage(): JSX.Element {
  const [filter, setFilter] = useState<"" | "QUEUED" | "RUNNING" | "DONE" | "FAILED">("");
  const jobs = trpc.job.list.useQuery(
    filter ? { limit: 100, status: filter } : { limit: 100 },
    { refetchInterval: 2000 },
  );
  const [expanded, setExpanded] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const retry = trpc.job.retry.useMutation({
    onSuccess: () => utils.job.list.invalidate(),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Jobs</h1>
        <select
          className="select w-40"
          value={filter}
          onChange={(e) =>
            setFilter(
              e.target.value as "" | "QUEUED" | "RUNNING" | "DONE" | "FAILED",
            )
          }
        >
          <option value="">All statuses</option>
          <option value="QUEUED">Queued</option>
          <option value="RUNNING">Running</option>
          <option value="DONE">Done</option>
          <option value="FAILED">Failed</option>
        </select>
      </div>
      <div className="card overflow-x-auto p-0">
        <table className="table">
          <thead>
            <tr>
              <th>Created</th>
              <th>Kind</th>
              <th>Status</th>
              <th>Item</th>
              <th>Cost</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {jobs.data?.flatMap((j) => {
              const rows = [
                <tr
                  key={j.id}
                  className="cursor-pointer hover:bg-cream/50"
                  onClick={() => setExpanded(expanded === j.id ? null : j.id)}
                >
                  <td className="muted text-xs">
                    {new Date(j.createdAt).toLocaleString()}
                  </td>
                  <td className="font-mono text-xs">{j.kind}</td>
                  <td>
                    <StatusBadge status={j.status} />
                  </td>
                  <td className="text-sm">
                    {j.item ? (
                      <Link
                        href={`/projects/${j.item.project.slug}/items/${j.item.id}`}
                        className="no-underline hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {j.item.hook}
                      </Link>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="font-mono text-xs">
                    {j.costUsd != null ? `$${j.costUsd.toFixed(2)}` : "—"}
                  </td>
                  <td className="text-right">
                    {j.status === "FAILED" && j.item && (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          retry.mutate({ id: j.id });
                        }}
                      >
                        Retry
                      </button>
                    )}
                  </td>
                </tr>,
              ];
              if (expanded === j.id) {
                rows.push(
                  <tr key={`${j.id}-logs`}>
                    <td colSpan={6} className="bg-cream/40">
                      {j.error && (
                        <p className="mb-2 text-sm text-red-700">{j.error}</p>
                      )}
                      <pre className="overflow-auto text-xs">
                        {JSON.stringify(j.logs, null, 2)}
                      </pre>
                    </td>
                  </tr>,
                );
              }
              return rows;
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }): JSX.Element {
  const tone =
    status === "DONE"
      ? "bg-emerald-100 text-emerald-800"
      : status === "FAILED"
        ? "bg-red-100 text-red-800"
        : status === "RUNNING"
          ? "bg-amber-100 text-amber-800"
          : "bg-ink/10 text-ink";
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-mono ${tone}`}>
      {status}
    </span>
  );
}
