"use client";

import dynamic from "next/dynamic";

// @uiw/react-md-editor loads codemirror under the hood — pure-browser stuff.
// We dynamic-import with ssr: false so it never hits server bundling.
const ReactMd = dynamic(() => import("@uiw/react-md-editor"), {
  ssr: false,
  loading: () => <div className="muted text-sm">Loading editor…</div>,
});

export function MarkdownEditor({
  value,
  onChange,
  height = 480,
}: {
  value: string;
  onChange: (v: string) => void;
  height?: number;
}): JSX.Element {
  return (
    <div data-color-mode="light" className="rounded-md border border-ink/10">
      <ReactMd
        value={value}
        onChange={(v?: string) => onChange(v ?? "")}
        height={height}
        preview="live"
      />
    </div>
  );
}
