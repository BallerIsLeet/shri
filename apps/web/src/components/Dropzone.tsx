"use client";

import { useCallback, useRef, useState } from "react";
import clsx from "clsx";

export type AcceptedFile = File;

export function Dropzone({
  onFiles,
  accept,
  multiple = true,
  disabled = false,
  label = "Drop files here, or click to select",
}: {
  onFiles: (files: AcceptedFile[]) => void;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  label?: string;
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [hover, setHover] = useState(false);

  const handle = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      const arr = multiple ? Array.from(fileList) : [fileList[0]!];
      onFiles(arr);
    },
    [onFiles, multiple],
  );

  return (
    <div
      className={clsx(
        "flex cursor-pointer items-center justify-center rounded-md border-2 border-dashed border-ink/20 bg-white/60 px-4 py-8 text-sm text-ink-muted transition",
        hover && "border-ink bg-cream text-ink",
        disabled && "cursor-not-allowed opacity-50",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setHover(true);
      }}
      onDragLeave={() => setHover(false)}
      onDrop={(e) => {
        e.preventDefault();
        setHover(false);
        if (!disabled) handle(e.dataTransfer.files);
      }}
      onClick={() => {
        if (!disabled) inputRef.current?.click();
      }}
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(e) => handle(e.target.files)}
      />
      {label}
    </div>
  );
}
