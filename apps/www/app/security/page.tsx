import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { Section } from "@/components/site/primitives";
import { PageHeader } from "@/components/site/page";
import { CtaButton, CtaLink, SmartLink } from "@/components/site/cta";
import { FaqList } from "@/components/site/Faq";
import { START_FREE_URL, DOCS_URL, CONTACT } from "@/lib/site";

const META = {
  title: "Security | Built for Previews, Not Production Risk",
  description:
    "Dormant until a valid review link. Single-use 90-second tokens. Redaction at capture. Server-enforced permissions. How SuperComment treats your site and your data.",
};

export const metadata: Metadata = pageMetadata({ ...META, path: "/security" });

const FAQ = [
  {
    q: "Can a stranger who finds my site see the overlay?",
    a: "No. Without a valid review link it renders nothing.",
  },
  {
    q: "Can a guest exfiltrate data through the agent?",
    a: "Guests cannot send to agents at all, and guest media never reaches agent payloads.",
  },
  {
    q: "Do you capture user passwords or form input?",
    a: "Form values are masked in captures; input values are never recorded in the interaction trail.",
  },
];

export default function SecurityPage() {
  return (
    <>
      <PageHeader
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Security", path: "/security" },
        ]}
        eyebrow="Built for previews"
        title="Built for previews. Careful by design."
        answer="SuperComment is designed for staging and preview environments. The embedded layer stays dormant until a valid review link activates it; review tokens are single-use and expire in 90 seconds; sensitive values are redacted at capture; and sending work to agents is a server-enforced, per-member permission."
        schemaDescription={META.description}
      />

      <Section className="space-y-12">
        <div className="max-w-2xl">
          <h2 className="text-2xl">Dormant by default.</h2>
          <p className="mt-3 text-ink-2">
            Without a valid review link, the overlay renders nothing, binds
            nothing, and captures nothing. On production deploys the loader is
            inert unless you explicitly opt in.
          </p>
        </div>
        <div className="max-w-2xl">
          <h2 className="text-2xl">Review links that expire.</h2>
          <p className="mt-3 text-ink-2">
            Opening a review link exchanges a server-minted, preview-scoped,
            single-use token, valid for 90 seconds, stripped from the URL before
            any request leaves the page. Sessions are origin-bound; a session from
            one site does not restore on another.
          </p>
        </div>
        <div className="max-w-2xl">
          <h2 className="text-2xl">Redaction at capture.</h2>
          <p className="mt-3 text-ink-2">
            Before context leaves the page: form fields are masked in visual
            captures; secret-shaped strings are stripped from text; storage values
            never leave the page, only key names; network query strings are
            removed. Best-effort by design, layered on every path, documented
            honestly in the{" "}
            <SmartLink href={DOCS_URL} className="font-medium text-ink underline underline-offset-4">
              security docs
            </SmartLink>
            <span aria-hidden="true"> →</span>.
          </p>
        </div>
        <div className="max-w-2xl">
          <h2 className="text-2xl">Permissions with teeth.</h2>
          <p className="mt-3 text-ink-2">
            Guests comment; they never dispatch. Sending work to agents is granted
            per member by a workspace owner and re-checked on the server for every
            request. Reviewer text reaches your agent labeled as untrusted input.
          </p>
        </div>
        <div className="max-w-2xl">
          <h2 className="text-2xl">Your data posture.</h2>
          <p className="mt-3 text-ink-2">
            Row-level security governs every table. Visual captures live in a
            private bucket, served to your team through short-lived signed URLs.
            Guest rasters are withheld from agent payloads.
          </p>
        </div>
        <div className="max-w-2xl">
          <h2 className="text-2xl">The honest section.</h2>
          <p className="mt-3 text-ink-2">
            SuperComment is a young product in open beta. No SOC 2 yet; a security
            page that says so beats a badge wall that implies otherwise. Found
            something?{" "}
            <SmartLink
              href={`mailto:${CONTACT.security}`}
              className="font-medium text-ink underline underline-offset-4"
            >
              {CONTACT.security}
            </SmartLink>
            . We read it same-day.
          </p>
        </div>
      </Section>

      <Section className="border-t border-line bg-surface">
        <h2 className="text-3xl">Questions, answered plainly.</h2>
        <div className="mt-8 max-w-3xl">
          <FaqList items={FAQ} />
        </div>
        <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3">
          <CtaLink href={DOCS_URL}>Read the security docs</CtaLink>
          <CtaButton href={START_FREE_URL}>Start free</CtaButton>
        </div>
      </Section>
    </>
  );
}
