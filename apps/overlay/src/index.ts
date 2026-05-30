/**
 * SuperComment injected annotation overlay (stub).
 *
 * The proxy (U3) injects the built IIFE bundle into the host page. The real UI
 * — toolbar, selection modes, comment form, markers, guest entry — is U6, and
 * context capture is U7. For now we just confirm the bundle loads.
 */
import { captureFidelitySchema } from "@supercomment/shared";

function bootstrap(): void {
  // Reference the shared contract so the workspace dependency is bundled in.
  const fidelities = captureFidelitySchema.options.join(", ");
  // eslint-disable-next-line no-console
  console.log(`SuperComment overlay loaded (fidelity modes: ${fidelities}).`);
}

bootstrap();
