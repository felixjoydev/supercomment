'use client';

import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';

/**
 * Shared entrance-motion primitives. Server pages render data and wrap the
 * result in these client shells, so RSC data fetching stays on the server
 * while the first paint gets one orchestrated, staggered reveal.
 *
 * One spring everywhere (bounce 0) keeps the whole app's motion cohesive.
 */

const spring = { type: 'spring', duration: 0.6, bounce: 0 } as const;

/** Container that staggers its StaggerItem children (~60ms apart). */
export function Stagger({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="shown"
      transition={{ staggerChildren: 0.06, delayChildren: delay }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      variants={{
        hidden: reduced ? { opacity: 0 } : { opacity: 0, y: 12, filter: 'blur(4px)' },
        shown: reduced
          ? { opacity: 1 }
          : { opacity: 1, y: 0, filter: 'blur(0px)', transition: spring },
      }}
    >
      {children}
    </motion.div>
  );
}
