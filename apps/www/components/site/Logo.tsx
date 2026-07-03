import { cn } from "@/lib/cn";

/**
 * The mark: a comment bubble holding a cursor, filled with the one vivid
 * gradient (pink into orange into violet). This is the single gradient element
 * a composition is allowed; everything around it stays quiet so it reads.
 */
export function LogoMark({
  size = 28,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <defs>
        <linearGradient id="sc-mark-gradient" x1="4" y1="3" x2="28" y2="27" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FF6FAE" />
          <stop offset="0.5" stopColor="#FF8A4C" />
          <stop offset="1" stopColor="#7B61FF" />
        </linearGradient>
      </defs>
      <path
        d="M7 3h18a4 4 0 0 1 4 4v11a4 4 0 0 1-4 4h-8.5l-6.2 5.2A1 1 0 0 1 9 26.4V22H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4Z"
        fill="url(#sc-mark-gradient)"
      />
      <path
        d="M12.4 8.6l8.6 4.5-3.6 1.2-1.5 3.6-3.5-9.3Z"
        fill="#fff"
      />
    </svg>
  );
}

export function Wordmark({
  className,
  markSize = 26,
}: {
  className?: string;
  markSize?: number;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark size={markSize} />
      <span className="text-[15px] font-semibold tracking-tight text-ink">
        SuperComment
      </span>
    </span>
  );
}
