import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Third Party Provider Terms - Blink",
  description:
    "Third party provider terms and conditions for services integrated with Blink",
  alternates: { canonical: "/terms/third-party-terms" },
  openGraph: {
    title: "Third Party Provider Terms - Blink",
    description:
      "Third party provider terms and conditions for services integrated with Blink",
    url: "https://blink.coder.com/terms/third-party-terms",
    siteName: "Blink",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
    type: "article",
  },
  twitter: {
    card: "summary_large_image",
    title: "Third Party Provider Terms - Blink",
    description:
      "Third party provider terms and conditions for services integrated with Blink",
    images: ["/og-image.png"],
  },
};

interface PolicySectionProps {
  title: string;
  children: React.ReactNode;
  isSubSection?: boolean;
}

function PolicySection({
  title,
  children,
  isSubSection = false,
}: PolicySectionProps) {
  const headingClass = isSubSection
    ? "text-xl font-medium mb-4"
    : "text-2xl font-medium mb-6";

  return (
    <section className="mb-8">
      <h2 className={headingClass}>{title}</h2>
      <div className="text-gray-700 dark:text-gray-300 space-y-4">
        {children}
      </div>
    </section>
  );
}

export default function ThirdPartyTermsPage() {
  return (
    <div className="mt-16 md:mt-32 mb-16 md:mb-32 px-4 md:px-0 mx-auto max-w-4xl">
      {/* Header Section */}
      <div className="mb-16">
        <h1 className="text-3xl md:text-5xl font-medium mb-6">
          Third Party Provider Terms
        </h1>
        <p className="text-lg text-gray-600 dark:text-gray-400">
          Coder Technologies, Inc.
        </p>
      </div>

      {/* Content Section */}
      <div className="space-y-12">
        <PolicySection title="Overview">
          <p>
            Blink products and services may include data, information, software
            or other services provided by third parties. Some third-party
            providers require Coder Technologies, Inc. to pass additional terms
            through to you. These third-party provider terms are subject to
            change at the provider's discretion and new third-party providers
            may be added from time to time. Please find below the current
            third-party provider terms for our products and services. Your use
            of our products and services constitutes your agreement to be bound
            by these third-party terms, which are incorporated into your
            agreement.
          </p>
        </PolicySection>

        <PolicySection title="Third Party Services">
          <p>
            The following third-party services and providers are integrated into
            or used by Blink. By using Blink, you agree to comply with the terms
            and conditions of these third-party providers:
          </p>

          <div className="mt-6 space-y-6">
            <div className="border-l-4 border-white pl-4">
              <h3 className="font-medium text-lg mb-2">
                <a
                  href="https://www.anthropic.com/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline text-white hover:text-gray-300"
                >
                  Anthropic
                </a>
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                AI language model services provided by Anthropic. Usage is
                subject to Anthropic's terms of service and acceptable use
                policies.
              </p>
            </div>

            <div className="border-l-4 border-white pl-4">
              <h3 className="font-medium text-lg mb-2">
                <a
                  href="https://ai.google.dev/gemini-api/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline text-white hover:text-gray-300"
                >
                  Google Gemini
                </a>
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                AI language model services provided by Google. Usage is governed
                by Google's Gemini API terms of service and privacy policies.
              </p>
            </div>

            <div className="border-l-4 border-white pl-4">
              <h3 className="font-medium text-lg mb-2">
                <a
                  href="https://openai.com/terms/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline text-white hover:text-gray-300"
                >
                  OpenAI
                </a>
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                AI language model services provided by OpenAI. Usage is subject
                to OpenAI's terms of use and usage policies.
              </p>
            </div>

            <div className="border-l-4 border-white pl-4">
              <h3 className="font-medium text-lg mb-2">
                <a
                  href="https://openrouter.ai/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline text-white hover:text-gray-300"
                >
                  OpenRouter
                </a>
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                AI model routing and access services provided by OpenRouter.
                Usage is governed by OpenRouter's terms of service.
              </p>
            </div>

            <div className="border-l-4 border-white pl-4">
              <h3 className="font-medium text-lg mb-2">
                <a
                  href="https://www.cloudflare.com/terms/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline text-white hover:text-gray-300"
                >
                  Cloudflare
                </a>
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Content delivery network and security services provided by
                Cloudflare. Usage is subject to Cloudflare's terms of service.
              </p>
            </div>
          </div>
        </PolicySection>

        <PolicySection title="Updates and Changes">
          <p>
            This page will be updated as new third-party providers are added or
            existing provider terms change. We recommend checking this page
            periodically for updates. Continued use of Blink services after any
            changes constitutes acceptance of the updated third-party terms.
          </p>
        </PolicySection>

        <PolicySection title="Contact Information">
          <p>
            If you have questions about these third-party provider terms or need
            specific information about a particular provider, please contact us
            through our standard support channels.
          </p>
        </PolicySection>
      </div>
    </div>
  );
}
