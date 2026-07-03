"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { Wordmark } from "./Logo";
import { CtaButton } from "./cta";
import {
  productNav,
  useCasesNav,
  SIGN_IN_URL,
  START_FREE_URL,
  DOCS_URL,
  type NavGroup,
} from "@/lib/site";

function Chevron() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
      className="text-ink-3"
    >
      <path
        d="M2 3.5 5 6.5 8 3.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DesktopDropdown({ group }: { group: NavGroup }) {
  return (
    <div className="relative group">
      <button
        type="button"
        className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-ink-2 hover:text-ink transition-colors"
      >
        {group.label}
        <Chevron />
      </button>
      <div className="invisible absolute left-0 top-full pt-2 opacity-0 transition-all group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
        <div className="min-w-52 sc-card-soft p-2">
          {group.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-lg px-3 py-2 text-sm text-ink-2 hover:bg-inset hover:text-ink transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function MobileGroup({ group }: { group: NavGroup }) {
  return (
    <details className="border-b border-line">
      <summary className="flex cursor-pointer list-none items-center justify-between py-3 text-sm font-medium text-ink">
        {group.label}
        <Chevron />
      </summary>
      <div className="pb-3">
        {group.items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="block py-2 pl-3 text-sm text-ink-2"
          >
            {item.label}
          </Link>
        ))}
      </div>
    </details>
  );
}

export function Nav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-canvas/85 backdrop-blur-md">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6 md:px-8">
        <Link href="/" aria-label="SuperComment home" className="shrink-0">
          <Wordmark />
        </Link>

        {/* Desktop */}
        <div className="hidden items-center gap-1 md:flex">
          <DesktopDropdown group={productNav} />
          <DesktopDropdown group={useCasesNav} />
          <Link
            href="/compare"
            className="px-3 py-2 text-sm text-ink-2 hover:text-ink transition-colors"
          >
            Compare
          </Link>
          <Link
            href="/pricing"
            className="px-3 py-2 text-sm text-ink-2 hover:text-ink transition-colors"
          >
            Pricing
          </Link>
          <Link
            href={DOCS_URL}
            className="px-3 py-2 text-sm text-ink-2 hover:text-ink transition-colors"
          >
            Docs
          </Link>
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <a
            href={SIGN_IN_URL}
            className="px-3 py-2 text-sm text-ink-2 hover:text-ink transition-colors"
          >
            Sign in
          </a>
          <CtaButton href={START_FREE_URL}>Start free</CtaButton>
        </div>

        {/* Mobile */}
        <div className="flex items-center gap-2 md:hidden">
          <CtaButton href={START_FREE_URL} className="px-4 py-2">
            Start free
          </CtaButton>
          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line-2 bg-surface text-ink"
          >
            <span className="sr-only">Menu</span>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              {open ? (
                <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              ) : (
                <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </div>
      </nav>

      {open ? (
        <div className="border-t border-line bg-canvas md:hidden">
          <div className="mx-auto max-w-6xl px-6 py-2">
            <MobileGroup group={productNav} />
            <MobileGroup group={useCasesNav} />
            <Link href="/compare" className="block border-b border-line py-3 text-sm font-medium text-ink">
              Compare
            </Link>
            <Link href="/pricing" className="block border-b border-line py-3 text-sm font-medium text-ink">
              Pricing
            </Link>
            <Link href={DOCS_URL} className="block border-b border-line py-3 text-sm font-medium text-ink">
              Docs
            </Link>
            <a href={SIGN_IN_URL} className="block py-3 text-sm font-medium text-ink">
              Sign in
            </a>
          </div>
        </div>
      ) : null}
    </header>
  );
}
