import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service - Blink",
  description:
    "Blink Terms of Service - Legal terms and conditions for using our services",
  alternates: { canonical: "/terms" },
  openGraph: {
    title: "Terms of Service - Blink",
    description:
      "Blink Terms of Service - Legal terms and conditions for using our services",
    url: "https://blink.so/terms",
    siteName: "Blink",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
    type: "article",
  },
  twitter: {
    card: "summary_large_image",
    title: "Terms of Service - Blink",
    description:
      "Blink Terms of Service - Legal terms and conditions for using our services",
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

export default function TermsPage() {
  return (
    <div className="mt-16 md:mt-32 mb-16 md:mb-32 px-4 md:px-0 mx-auto max-w-4xl">
      {/* Header Section */}
      <div className="mb-16">
        <h1 className="text-3xl md:text-5xl font-medium mb-6">
          Blink Terms of Service
        </h1>
        <p className="text-lg text-gray-600 dark:text-gray-400">
          Coder Technologies, Inc.
        </p>
      </div>

      {/* Content Section */}
      <div className="space-y-12">
        <PolicySection title="Introduction">
          <p>
            <strong>
              PLEASE READ THESE BLINK TERMS OF SERVICE ("TERMS") CAREFULLY
              BEFORE USING THE SERVICES OFFERED BY CODER TECHNOLOGIES, INC.
              ("CODER").
            </strong>{" "}
            BY MUTUALLY EXECUTING ONE OR MORE ORDER FORMS WITH CODER WHICH
            REFERENCE THESE TERMS (EACH, AN "ORDER FORM"), YOU ("CUSTOMER")
            AGREE TO BE BOUND BY THESE TERMS (TOGETHER WITH ALL ORDER FORMS, THE
            "AGREEMENT") TO THE EXCLUSION OF ALL OTHER TERMS. IN ADDITION, ANY
            ONLINE ORDER FORM WHICH YOU SUBMIT VIA CODER'S STANDARD ONLINE
            PROCESS AND WHICH IS ACCEPTED BY CODER SHALL BE DEEMED TO BE
            MUTUALLY EXECUTED.
          </p>
          <p>
            <strong>
              IF YOU ARE ENTERING INTO THIS AGREEMENT ON BEHALF OF AN ENTITY,
              THEN YOU REPRESENT AND WARRANT THAT YOU ARE AUTHORIZED TO BIND
              SUCH ENTITY TO THE TERMS OF THIS AGREEMENT.
            </strong>{" "}
            IF THE TERMS OF THIS AGREEMENT ARE CONSIDERED AN OFFER, ACCEPTANCE
            IS EXPRESSLY LIMITED TO SUCH TERMS.
          </p>
        </PolicySection>

        <PolicySection title="1. Order Forms; Access to the Service">
          <p>
            Upon mutual execution, each Order Form shall be incorporated into
            and form a part of the Agreement. For each Order Form, subject to
            Customer's compliance with the terms and conditions of this
            Agreement (including any limitations and restrictions set forth on
            the applicable Order Form) Coder grants Customer a nonexclusive,
            limited, personal, nonsublicensable, nontransferable right and
            license to internally access and use the Coder product(s) and/or
            service(s) specified in such Order Form (collectively, the
            "Service," or "Services") during the applicable Order Form Term (as
            defined below) for the internal business purposes of Customer, only
            as provided herein and only in accordance with Coder's applicable
            official user documentation for such Service (the "Documentation").
          </p>
        </PolicySection>

        <PolicySection title="2. Account Types">
          <p>
            Coder allows both individual users ("Individual Customers") and
            entities ("Enterprise Customers") to create accounts to access the
            Services (an "Account"). "Customer" as used herein refers to either
            Individual Customers or Enterprise Customers, as applicable.
            Individual Customers acknowledge and agree that if such Customer
            signed up for the Services in a manner that indicates that such
            Individual Customer is associated with a particular entity or
            employer (e.g., by using an email or other credentials associated
            with such entity or employer), and if such entity or employer
            currently has or later enters into an agreement for the Services
            with Coder (an "Entity Agreement"), then at Coder's option, such
            Individual Customer's Account may be merged with and/or subsumed by
            such employer's or entity's Account under the applicable Entity
            Agreement (an "Entity Account Transfer"), at which point this
            Agreement will terminate with respect to such Individual Customer
            and any further use of the Services will be pursuant to the
            applicable Entity Agreement.
          </p>
        </PolicySection>

        <PolicySection title="3. Service Updates">
          <p>
            From time to time, Coder may provide upgrades, patches,
            enhancements, or fixes for the Services to its customers generally
            without additional charge ("Updates"), and such Updates will become
            part of the Services and subject to this Agreement; provided that
            Coder shall have no obligation under this Agreement or otherwise to
            provide any such Updates. Customer understands that Coder may make
            improvements and modifications to the Services at any time in its
            sole discretion; provided that Coder shall use commercially
            reasonable efforts to give Customer reasonable prior notice of any
            major changes.
          </p>
        </PolicySection>

        <PolicySection title="4. Modification of Terms">
          <p>
            Coder reserves the right to change these Terms at any time, and if
            Coder does so, Coder will place a notice on its website, send
            Customer an email, and/or notify Customer by some other reasonable
            means. Any such changed Terms will apply to Customer upon the
            commencement of Customer's next Renewal Term (as defined below). If
            Customer does not agree with the new Terms, Customer may reject
            them; but will no longer be able to use the Services. If Customer
            uses the Services in any way after a change to the Terms is
            effective, that means Customer agree to all of the changes. Except
            for changes by Coder as described here, no other amendment or
            modification of these Terms will be effective unless in writing and
            signed by both Customer and Coder.
          </p>
        </PolicySection>

        <PolicySection title="5. Ownership; Feedback">
          <p>
            As between the parties, Coder retains all right, title, and interest
            in and to the Services, and all software, products, works, and other
            intellectual property and moral rights related thereto or created,
            used, or provided by Coder for the purposes of this Agreement,
            including any copies and derivative works of the foregoing. Any
            software which is distributed or otherwise provided to Customer
            hereunder (including without limitation any software identified on
            an Order Form) shall be deemed a part of the "Services" and subject
            to all of the terms and conditions of this Agreement. No rights or
            licenses are granted except as expressly and unambiguously set forth
            in this Agreement.
          </p>
          <p>
            Customer may (but is not obligated to) provide suggestions, comments
            or other feedback to Coder with respect to the Service ("Feedback").
            Coder acknowledges and agrees that all Feedback is provided "AS IS"
            and without warranty of any kind. Notwithstanding anything else,
            Customer shall, and hereby does, grant to Coder a nonexclusive,
            worldwide, perpetual, irrevocable, transferable, sublicensable,
            royalty-free, fully paid up license to use and exploit the Feedback
            for any purpose. Nothing in this Agreement will impair Coder's right
            to develop, acquire, license, market, promote or distribute
            products, software or technologies that perform the same or similar
            functions as, or otherwise compete with any products, software or
            technologies that Customer may develop, produce, market, or
            distribute.
          </p>
        </PolicySection>

        <PolicySection title="6. Fees; Payment">
          <p>
            Customer shall pay Coder fees as set forth in each Order Form
            ("Fees"). Unless otherwise specified herein or in an Order Form, all
            Fees shall be invoiced annually in advance and all invoices issued
            under this Agreement are payable in U.S. dollars within thirty (30)
            days from date of invoice. Past due invoices are subject to interest
            on any outstanding balance of the lesser of 1.5% per month or the
            maximum amount permitted by law. Customer shall be responsible for
            all taxes associated with the Service (excluding taxes based on
            Coder's net income). All Fees paid are non-refundable and are not
            subject to set-off.
          </p>
          <p>
            If Customer exceeds any user or usage limitations set forth on an
            Order Form, then (i) Coder shall invoice Customer for such
            additional users or usage at the overage rates set forth on the
            Order Form (or if no overage rates are set forth on the Order Form,
            at Coder's then-current standard overage rates for such usage), in
            each case on a pro-rata basis from the first date of such excess
            usage through the end of the Order Form Initial Term or then-current
            Order Form Renewal Term (as applicable), and (ii) if such Order Form
            Term renews (in accordance with the section entitled "Term;
            Termination", below), such renewal shall include the additional fees
            for such excess users and usage.
          </p>
        </PolicySection>

        <PolicySection title="7. Restrictions">
          <p>
            Except as expressly set forth in this Agreement, Customer shall not
            (and shall not permit any third party to), directly or indirectly:
            (i) reverse engineer, decompile, disassemble, or otherwise attempt
            to discover the source code, object code, or underlying structure,
            ideas, or algorithms of the Service (except to the extent applicable
            laws specifically prohibit such restriction); (ii) modify,
            translate, or create derivative works based on the Service; (iii)
            copy, rent, lease, distribute, pledge, assign, or otherwise transfer
            or encumber rights to the Service; (iv) use the Service for the
            benefit of a third party; (v) remove or otherwise alter any
            proprietary notices or labels from the Service or any portion
            thereof; (vi) use the Service to build an application or product
            that is competitive with any Coder product or service; (vii)
            interfere or attempt to interfere with the proper working of the
            Service or any activities conducted on the Service; or (viii) bypass
            any measures Coder may use to prevent or restrict access to the
            Service (or other accounts, computer systems or networks connected
            to the Service).
          </p>
          <p>
            Customer is responsible for all of Customer's activity in connection
            with the Service, including but not limited to uploading Customer
            Data (as defined below) onto the Service. Customer (a) shall use the
            Service in compliance with all applicable local, state, national and
            foreign laws, treaties and regulations in connection with Customer's
            use of the Service (including those related to data privacy,
            international communications, export laws and the transmission of
            technical or personal data laws), and (b) shall not use the Service
            in a manner that violates any third party intellectual property,
            contractual or other proprietary rights.
          </p>
        </PolicySection>

        <PolicySection title="8. Customer Data">
          <p>
            For purposes of this Agreement, "Customer Data" shall mean any data,
            information or other material provided, uploaded, or submitted by
            Customer to the Service in the course of using the Service. Customer
            shall retain all right, title and interest in and to the Customer
            Data, including all intellectual property rights therein. Customer,
            not Coder, shall have sole responsibility for the accuracy, quality,
            integrity, legality, reliability, appropriateness, and intellectual
            property ownership or right to use of all Customer Data.
          </p>
          <p>
            Customer represents and warrants that it has all rights necessary to
            provide the Customer Data to Coder as contemplated hereunder, in
            each case without any infringement, violation or misappropriation of
            any third party rights (including, without limitation, intellectual
            property rights and rights of privacy). Coder shall use commercially
            reasonable efforts to maintain the security and integrity of the
            Service and the Customer Data. Coder is not responsible to Customer
            for any loss, destruction, or alteration of, or unauthorized access
            to Customer Data or the unauthorized use of the Service except to
            the extent due to Coder's gross negligence or willful misconduct.
          </p>
          <p>
            Customer is responsible for the use of the Service by any person to
            whom Customer has given access to the Service, even if Customer did
            not authorize such use. By using the Services, Individual Customers
            acknowledge and agree that such Customers are subject to the
            provisions in this Agreement as well as those in Coder's Privacy
            Policy (located at{" "}
            <a
              href="https://www.blink.so/privacy"
              className="underline text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200"
            >
              https://www.blink.so/privacy
            </a>
            ).
          </p>
          <p>
            If Customer is subject to GDPR and require a DPA, the parties will
            execute one prior to Customer providing Coder with any Personal
            Data. To the extent that the Customer Data includes any personal
            information, (i) Coder will process, retain, use, and disclose such
            personal information only as necessary to provide the Services
            hereunder and as otherwise permitted under this Agreement, which
            constitutes a business purpose, (ii) Coder agrees not to sell such
            personal data, to retain, use, or disclose such personal data for
            any commercial purpose other than the foregoing purposes, or to
            retain, use, or disclose such personal data outside of the scope of
            this Agreement. Coder understands its obligations under applicable
            data protection laws and will comply with them.
          </p>
          <p>
            Nothing herein shall prevent Coder from transferring an Individual
            Customer's Account and sharing an Individual Customer's Customer
            Data with an applicable Enterprise Customer in connection with an
            Entity Account Transfer (which Customer Data may then be used by
            such Enterprise Customer in accordance with the applicable Entity
            Agreement). Customer agrees and acknowledges that Customer Data may
            be irretrievably deleted if Customer's account is ninety (90) days
            or more delinquent.
          </p>
          <p>
            Notwithstanding anything to the contrary, Customer acknowledges and
            agrees that Coder may (i) internally use and modify (but not
            disclose) Customer Data for the purposes of (A) providing the
            Service to Customer and (B) generating Aggregated De-Identified Data
            (as defined below), and (ii) freely use, retain and make available
            Aggregated De-Identified Data for Coder's business purposes
            (including without limitation, for purposes of improving, testing,
            operating, promoting and marketing Coder's products and services).
            "Aggregated De-Identified Data" means data submitted to, collected
            by, or generated by Coder in connection with Customer's use of the
            Service, but only in aggregate, de-identified form which can in no
            way be linked specifically to Customer.
          </p>
        </PolicySection>

        <PolicySection title="9. Vendor Integrations">
          <p>
            Customer acknowledges and agrees that (i) the Service may integrate
            with, connect to, or otherwise use platforms, products or services
            operated or provided by third parties (e.g., other vendors of
            Customer) ("Vendor Integrations"), including via use of application
            programming interfaces (APIs) provided by such Vendor Integrations,
            (ii) the availability and operation of the Service or certain
            portions thereof may be dependent on Coder's ability to access such
            Vendor Integrations, and (iii) Customer's failure to provide
            adequate access or any retraction of permissions relating to such
            Vendor Integrations may result in a suspension or interruption of
            the Service.
          </p>
          <p>
            Customer hereby represents and warrants that it has all rights,
            licenses, permissions and consents necessary to connect, use and
            access any Vendor Integrations that it integrates with the Service,
            and Customer shall indemnify, defend and hold harmless the Coder for
            all claims, damages and liabilities arising out of Customer's use of
            any Vendor Integrations in connection with or through the Service.
            Customer is solely responsible for procuring any and all rights
            necessary for it to access Vendor Integrations (including any
            Customer Data or other information relating thereto) and for
            complying with any applicable terms or conditions thereof.
          </p>
          <p>
            Any exchange of data or other interaction between Customer and a
            third party provider is solely between Customer and such third party
            provider and is governed by such third party's terms and conditions.
            Coder cannot and does not guarantee that the Service shall
            incorporate (or continue to incorporate) any particular Vendor
            Integrations and does not make any representations or warranties
            with respect to Vendor Integrations.
          </p>
        </PolicySection>

        <PolicySection title="10. Third Party Terms">
          <p>
            Customer acknowledges and agrees that: (i) the Service may
            incorporate certain technology, information, data, and materials
            from third party providers (collectively, "Third Party Services");
            (ii) without limiting any rights that Customer may have under any
            separate agreement between Customer and any provider of a Third
            Party Service, Third Party Services may only be used in conjunction
            with the Service; and (iii) Customer's use of the Third Party
            Services hereunder shall be subject to (and Customer agrees it is
            bound by) the third party terms and conditions referenced at{" "}
            <a
              href="https://blink.so/terms/third-party-terms"
              className="underline text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200"
            >
              https://blink.so/terms/third-party-terms
            </a>{" "}
            (the "Third Party Terms Site"), as they may be modified from time to
            time by Coder and/or its third party licensors or suppliers at any
            time (collectively, the "Third Party Terms"), and which are
            incorporated into this Agreement by reference.
          </p>
          <p>
            Customer is responsible for checking the Third Party Terms Site for
            updates. Any use by Customer of the Services following a change to
            the Third Party Terms shall constitute acceptance of such change.
            Coder cannot and does not guarantee that the Service shall
            incorporate (or continue to incorporate) any particular Third Party
            Services, and does not make any representations or warranties with
            respect to Third Party Services or any third party providers.
          </p>
        </PolicySection>

        <PolicySection title="11. Term; Termination">
          <p>
            This Agreement shall commence upon the date of the first Order Form,
            and, unless earlier terminated in accordance herewith, shall last
            until the expiration of all Order Form Terms. For each Order Form,
            unless otherwise specified therein, the "Order Form Term" shall
            begin as of the effective date set forth on such Order Form, and
            unless earlier terminated as set forth herein, (x) shall continue
            for the initial term specified on such Order Form (the "Order Form
            Initial Term"), and (y) following the Order Form Initial Term, shall
            automatically renew for additional successive periods of equal
            duration to the Order Form Initial Term (each, a "Order Form Renewal
            Term") unless either party notifies the other party of such party's
            intention not to renew no later than thirty (30) days prior to the
            expiration of the Order Form Initial Term or then-current Order Form
            Renewal Term, as applicable.
          </p>
          <p>
            In the event of a material breach of this Agreement by either party,
            the non-breaching party may terminate this Agreement by providing
            written notice to the breaching party, provided that the breaching
            party does not materially cure such breach within thirty (30) days
            of receipt of such notice. Without limiting the foregoing, Coder may
            suspend or limit Customer's access to or use of the Service if (i)
            Customer's account is more than sixty (60) days past due, or (ii)
            Customer's use of the Service results in (or is reasonably likely to
            result in) damage to or material degradation of the Service which
            interferes with Coder's ability to provide access to the Service to
            other customers; provided that in the case of subsection (ii): (a)
            Coder shall use reasonable good faith efforts to work with Customer
            to resolve or mitigate the damage or degradation in order to resolve
            the issue without resorting to suspension or limitation; (b) prior
            to any such suspension or limitation, Coder shall use commercially
            reasonable efforts to provide notice to Customer describing the
            nature of the damage or degradation; and (c) Coder shall reinstate
            Customer's use of or access to the Service, as applicable, if
            Customer remediates the issue within thirty (30) days of receipt of
            such notice.
          </p>
          <p>
            All provisions of this Agreement which by their nature should
            survive termination shall survive termination, including, without
            limitation, accrued payment obligations, ownership provisions,
            warranty disclaimers, indemnity and limitations of liability. For
            clarity, any services provided by Coder to Customer, including any
            assistance in exporting the Customer Data, shall be billable at
            Coder's standard rates then in effect.
          </p>
        </PolicySection>

        <PolicySection title="12. Indemnification">
          <p>
            Each party ("Indemnitor") shall defend, indemnify, and hold harmless
            the other party, its affiliates and each of their respective
            employees, contractors, directors, suppliers and representatives
            (collectively, the "Indemnitee") from all losses, liabilities, and
            expenses paid or payable to an unaffiliated third party (including
            reasonable attorneys' fees) ("Losses"), that arise from or relate to
            any claim by such third party that (i) the Customer Data or
            Customer's use of the Service (in the case of Customer as
            Indemnitor), or (ii) the Service (in the case of Coder as
            Indemnitor), infringes, violates, or misappropriates any
            intellectual property or proprietary right of such third party;
            provided that the Indemnitee provides the Indemnitor with: (x)
            prompt written notice of any claim (provided that a failure to
            provide such notice shall only relieve the Indemnitor of its
            indemnity obligations if the Indemnitor is materially prejudiced by
            such failure); (y) the option to assume sole control over the
            defense and settlement of any claim (provided that the Indemnitee
            may participate in such defense and settlement at its own expense);
            and (z) reasonable information and assistance in connection with
            such defense and settlement (at the Indemnitor's expense).
          </p>
          <p>
            The foregoing obligations of Coder do not apply (A) with respect to
            the Service or any information, technology, materials or data (or
            any portions or components of the foregoing) to the extent (1) not
            created or provided by Coder (including without limitation any
            Customer Data), (2) made in whole or in part in accordance to
            Customer specifications, (3) modified after delivery by Coder, (4)
            combined with other products, processes or materials not provided by
            Coder (where the alleged Losses arise from or relate to such
            combination), (B) where Customer continues allegedly infringing
            activity after being notified thereof or after being informed of
            modifications that would have avoided the alleged infringement, or
            (C) to the extent Losses arise from Customer's breach of this
            Agreement.
          </p>
        </PolicySection>

        <PolicySection title="13. Free/Trial Use">
          <p>
            Coder may make the Services or certain editions of the Services
            (e.g., a free trial, evaluation, "community", or similar version)
            available to Customer free of charge ("Free Offerings").
            Notwithstanding anything else, (i) if Customer provides any Customer
            Data in connection with a Free Offering, Coder shall have no
            obligations with respect to such Customer Data, and Coder expressly
            disclaims any liability with respect to such Customer Data, (ii)
            Free Offerings are provided "AS-IS," without warranty of any kind,
            (iii) Coder shall not have any obligation to provide any support or
            uptime commitments with respect to Free Offerings, and (iv) Coder
            shall have no obligations under Section 12 (Indemnification) or
            liability of any kind with respect to Free Offerings (unless such
            exclusion of liability is not enforceable under applicable law, in
            which case Coder's liability with respect to the Free Offerings
            shall not exceed $100.00).
          </p>
        </PolicySection>

        <PolicySection title="14. Disclaimer">
          <p>
            EXCEPT AS EXPRESSLY SET FORTH HEREIN, THE SERVICE IS PROVIDED "AS
            IS" AND "AS AVAILABLE" AND ARE WITHOUT WARRANTY OF ANY KIND, EXPRESS
            OR IMPLIED, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
            TITLE, NON-INFRINGEMENT, MERCHANTABILITY AND FITNESS FOR A
            PARTICULAR PURPOSE, AND ANY WARRANTIES IMPLIED BY ANY COURSE OF
            PERFORMANCE, USAGE OF TRADE, OR COURSE OF DEALING, ALL OF WHICH ARE
            EXPRESSLY DISCLAIMED.
          </p>
        </PolicySection>

        <PolicySection title="15. Limitation of Liability">
          <p>
            EXCEPT FOR THE PARTIES' INDEMNIFICATION OBLIGATIONS AND FOR
            CUSTOMER'S BREACH OF THE SECTION ENTITLED "RESTRICTIONS", IN NO
            EVENT SHALL EITHER PARTY, NOR ITS DIRECTORS, EMPLOYEES, AGENTS,
            PARTNERS, SUPPLIERS OR CONTENT PROVIDERS, BE LIABLE UNDER CONTRACT,
            TORT, STRICT LIABILITY, NEGLIGENCE OR ANY OTHER LEGAL OR EQUITABLE
            THEORY WITH RESPECT TO THE SUBJECT MATTER OF THIS AGREEMENT (I) FOR
            ANY LOST PROFITS, DATA LOSS, COST OF PROCUREMENT OF SUBSTITUTE GOODS
            OR SERVICES, OR SPECIAL, INDIRECT, INCIDENTAL, PUNITIVE, OR
            CONSEQUENTIAL DAMAGES OF ANY KIND WHATSOEVER, SUBSTITUTE GOODS OR
            SERVICES (HOWEVER ARISING), (II) FOR ANY BUGS, VIRUSES, TROJAN
            HORSES, OR THE LIKE (REGARDLESS OF THE SOURCE OF ORIGINATION), OR
            (III) FOR ANY DIRECT DAMAGES IN EXCESS OF (IN THE AGGREGATE) THE
            FEES PAID (OR PAYABLE) BY CUSTOMER TO CODER HEREUNDER IN THE TWELVE
            (12) MONTHS PRIOR TO THE EVENT GIVING RISE TO A CLAIM HEREUNDER.
          </p>
        </PolicySection>

        <PolicySection title="16. Miscellaneous">
          <p>
            This Agreement (including all Order Forms) represents the entire
            agreement between Customer and Coder with respect to the subject
            matter hereof, and supersedes all prior or contemporaneous
            communications and proposals (whether oral, written or electronic)
            between Customer and Coder with respect thereto. In the event of any
            conflict between these Terms and an Order Form, the Order Form shall
            control. The Agreement shall be governed by and construed in
            accordance with the laws of the State of California, excluding its
            conflicts of law rules, and the parties consent to exclusive
            jurisdiction and venue in the state and federal courts located in
            San Francisco, California.
          </p>
          <p>
            All notices under this Agreement shall be in writing and shall be
            deemed to have been duly given when received, if personally
            delivered or sent by certified or registered mail, return receipt
            requested; when receipt is electronically confirmed, if transmitted
            by facsimile or e-mail; or the day after it is sent, if sent for
            next day delivery by recognized overnight delivery service. Notices
            must be sent to the contacts for each party set forth on the Order
            Form. Either party may update its address set forth above by giving
            notice in accordance with this section.
          </p>
          <p>
            Except as otherwise provided herein, any provision of this Agreement
            may be amended or waived only by a writing executed by both parties.
            Except for payment obligations, neither party shall be liable for
            any failure to perform its obligations hereunder where such failure
            results from any cause beyond such party's reasonable control,
            including, without limitation, the elements; fire; flood; severe
            weather; earthquake; vandalism; accidents; sabotage; power failure;
            denial of service attacks or similar attacks; Internet failure; acts
            of God and the public enemy; acts of war; acts of terrorism; riots;
            civil or public disturbances; strikes lock-outs or labor
            disruptions; any laws, orders, rules, regulations, acts or
            restraints of any government or governmental body or authority,
            civil or military, including the orders and judgments of courts.
          </p>
          <p>
            Neither party may assign any of its rights or obligations hereunder
            without the other party's consent; provided that (i) either party
            may assign all of its rights and obligations hereunder without such
            consent to a successor-in-interest in connection with a sale of
            substantially all of such party's business relating to this
            Agreement, and (ii) Coder may utilize subcontractors in the
            performance of its obligations hereunder. Customer agrees that Coder
            may use Customer's name and logo to refer to Customer as a customer
            of Coder on its website and in marketing materials.
          </p>
          <p>
            No agency, partnership, joint venture, or employment relationship is
            created as a result of this Agreement and neither party has any
            authority of any kind to bind the other in any respect. In any
            action or proceeding to enforce rights under this Agreement, the
            prevailing party shall be entitled to recover costs and attorneys'
            fees. If any provision of this Agreement is held to be unenforceable
            for any reason, such provision shall be reformed only to the extent
            necessary to make it enforceable. The failure of either party to act
            with respect to a breach of this Agreement by the other party shall
            not constitute a waiver and shall not limit such party's rights with
            respect to such breach or any subsequent breaches.
          </p>
        </PolicySection>
      </div>
    </div>
  );
}
