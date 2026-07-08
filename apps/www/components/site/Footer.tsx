import Link from "next/link";
import { LogoMark } from "./Logo";
import { footerColumns, FOOTER_SIGNOFF, START_FREE_URL } from "@/lib/site";
import { CtaButton } from "./cta";

export function Footer() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto max-w-6xl px-6 py-16 md:px-8">
        <div className="grid gap-10 lg:grid-cols-6">
          <div className="lg:col-span-2">
            <span className="inline-flex items-center gap-2">
              <LogoMark size={24} />
              <span className="text-sm font-semibold text-ink">SuperComment</span>
            </span>
            <p className="mt-4 max-w-xs text-sm text-ink-2">
              The comment layer between your reviewers and your coding agent.
            </p>
            <div className="mt-5">
              <CtaButton href={START_FREE_URL}>Start free</CtaButton>
            </div>
          </div>

          {footerColumns.map((col) => (
            <div key={col.heading}>
              <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-3">
                {col.heading}
              </h3>
              <ul className="mt-4 space-y-2.5">
                {col.items.map((item) => (
                  <li key={item.label}>
                    {item.muted ? (
                      <span className="text-sm text-ink-3">{item.label}</span>
                    ) : (
                      <Link
                        href={item.href}
                        className="text-sm text-ink-2 hover:text-ink transition-colors"
                      >
                        {item.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 flex flex-col items-start justify-between gap-4 border-t border-line pt-6 sm:flex-row sm:items-center">
          <p className="text-sm text-ink-2">
            {FOOTER_SIGNOFF}{" "}
            <span
              aria-hidden="true"
              className="bg-clip-text text-transparent gradient-mark"
            >
              {"♡"}
            </span>{" "}
            <span className="text-ink">SuperComment</span>
          </p>
          <p className="text-sm text-ink-3">© 2026 SuperComment</p>
        </div>
      </div>
    </footer>
  );
}
