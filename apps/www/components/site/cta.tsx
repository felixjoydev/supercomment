import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";

function isExternal(href: string) {
  return /^https?:\/\//.test(href) || href.startsWith("mailto:");
}

/** Internal links use next/link; external (app, mail) use a plain anchor. */
export function SmartLink({
  href,
  className,
  children,
  ...rest
}: {
  href: string;
  className?: string;
  children: ReactNode;
} & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  if (isExternal(href)) {
    return (
      <a href={href} className={className} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className} {...rest}>
      {children}
    </Link>
  );
}

type ButtonVariant = "primary" | "secondary";

const buttonBase =
  "inline-flex items-center justify-center rounded-full px-5 py-2.5 text-sm font-medium transition-colors whitespace-nowrap";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-ink text-white hover:bg-black",
  secondary:
    "bg-surface text-ink border border-line-2 hover:border-ink-3 shadow-soft",
};

/** A CTA button. Labels are 1 to 3 words, verb-led, zero urgency. */
export function CtaButton({
  href,
  children,
  variant = "primary",
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
  className?: string;
}) {
  return (
    <SmartLink
      href={href}
      className={cn(buttonBase, buttonVariants[variant], className)}
    >
      {children}
    </SmartLink>
  );
}

/** A descriptive text link with a trailing arrow. */
export function CtaLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <SmartLink
      href={href}
      className={cn(
        "group inline-flex items-center gap-1.5 text-sm font-medium text-ink",
        className,
      )}
    >
      <span className="underline-offset-4 group-hover:underline">
        {children}
      </span>
      <span
        aria-hidden="true"
        className="transition-transform group-hover:translate-x-0.5"
      >
        {"→"}
      </span>
    </SmartLink>
  );
}
