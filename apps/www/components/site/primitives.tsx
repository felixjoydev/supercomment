import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Container({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-6xl px-6 md:px-8", className)}>
      {children}
    </div>
  );
}

/** A vertical rhythm band with the page container inside. */
export function Section({
  children,
  className,
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("py-16 md:py-24", className)}>
      <Container>{children}</Container>
    </section>
  );
}

/** Caps eyebrow kicker: THE PROBLEM, THE LOOP, AGENT READY. */
export function Eyebrow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <p className={cn("eyebrow", className)}>{children}</p>;
}

/** Section heading: optional eyebrow above an h2. */
export function SectionHead({
  eyebrow,
  title,
  children,
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("max-w-3xl", className)}>
      {eyebrow ? <Eyebrow className="mb-4">{eyebrow}</Eyebrow> : null}
      <h2 className="text-3xl md:text-4xl">{title}</h2>
      {children ? (
        <div className="mt-4 text-lg text-ink-2 measure">{children}</div>
      ) : null}
    </div>
  );
}

/**
 * The direct answer: the 40-60 word first paragraph AI engines lift. Larger
 * lead type, held to a comfortable measure.
 */
export function DirectAnswer({ children }: { children: ReactNode }) {
  return (
    <p className="mt-6 text-lg md:text-xl leading-relaxed text-ink-2 measure">
      {children}
    </p>
  );
}

/** A lettered/numbered small kicker chip used inside step cards. */
export function StepNumber({ n }: { n: number }) {
  return (
    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-inset text-ink text-sm font-medium tnum">
      {n}
    </span>
  );
}
