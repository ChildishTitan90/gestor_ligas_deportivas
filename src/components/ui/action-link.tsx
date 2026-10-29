import Link from "next/link";
import type { ComponentProps } from "react";

const variants = {
  primary: "primary-action",
  secondary: "border border-border bg-surface text-primary hover:bg-background",
};

export function ActionLink({ children, className = "", variant = "primary", ...props }:
  ComponentProps<typeof Link> & { variant?: keyof typeof variants }) {
  return (
    <Link {...props} className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition-colors ${variants[variant]} ${className}`}>
      {children}
    </Link>
  );
}
