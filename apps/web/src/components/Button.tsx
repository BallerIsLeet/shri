"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import clsx from "clsx";

type Variant = "default" | "primary" | "ghost";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ variant = "default", className, ...rest }, ref) {
    return (
      <button
        ref={ref}
        className={clsx(
          "btn",
          variant === "primary" && "btn-primary",
          variant === "ghost" && "btn-ghost",
          className,
        )}
        {...rest}
      />
    );
  },
);
