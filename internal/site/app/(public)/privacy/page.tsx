import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy - Blink",
  description:
    "Blink Privacy Policy - How we collect, use, and protect your personal information",
  alternates: { canonical: "/privacy" },
  openGraph: {
    title: "Privacy Policy - Blink",
    description:
      "Blink Privacy Policy - How we collect, use, and protect your personal information",
    url: "https://blink.so/privacy",
    siteName: "Blink",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
    type: "article",
  },
  twitter: {
    card: "summary_large_image",
    title: "Privacy Policy - Blink",
    description:
      "Blink Privacy Policy - How we collect, use, and protect your personal information",
    images: ["/og-image.png"],
  },
};

export default function PrivacyPage() {
  return (
    <div className="mt-16 md:mt-32 mb-16 md:mb-32 px-4 md:px-0 mx-auto max-w-4xl">
      {/* Header Section */}
      <div className="mb-16">
        <h1 className="text-3xl md:text-5xl font-medium mb-6">
          Blink Privacy Policy
        </h1>
        <p className="text-lg text-gray-600 dark:text-gray-400">
          Effective date: August 29, 2025
        </p>
      </div>

      {/* Content Section */}
      <div className="space-y-8 text-gray-700 dark:text-gray-300">
        <div>
          <p className="mb-4">
            At Blink, we take your privacy seriously. Please read this Privacy
            Policy to learn how we treat your personal data. By using or
            accessing our Services in any manner, you acknowledge that you
            accept the practices and policies outlined below, and you hereby
            consent that we will collect, use and disclose your information as
            described in this Privacy Policy.
          </p>
          <p className="mb-4">
            Remember that your use of Blink's Services is at all times subject
            to our{" "}
            <a
              href="https://www.blink.so/terms"
              className="underline text-white hover:text-gray-200 break-all"
            >
              Terms and Conditions
            </a>
            , which incorporates this Privacy Policy. Any terms we use in this
            Policy without defining them have the definitions given to them in
            the Terms and Conditions. You may print a copy of this Privacy
            Policy.
          </p>
          <p className="mb-4">
            In the ordinary course of making the Services available we may
            process personal data about individuals at the direction of our
            customers. In those cases we are a service provider and our
            processing of that data is governed by the agreement in place
            between us and the applicable customer. The customer's privacy
            policy or other agreement between the customer and you or your
            organization, and not this Privacy Policy, applies to such
            processing. Where that is the case, please contact the relevant
            customer, and not Blink, in the first instance to address your
            rights with respect to such data.
          </p>
          <p className="mb-4">
            As we continually work to improve our Services, we may need to
            change this Privacy Policy from time to time. We will alert you of
            material changes by placing a notice on the Blink website, by
            sending you an email and/or by some other means. Please note that if
            you've opted not to receive legal notice emails from us (or you
            haven't provided us with your email address), those legal notices
            will still govern your use of the Services, and you are still
            responsible for reading and understanding them. If you use the
            Services after any changes to the Privacy Policy have been posted,
            that means you agree to all of the changes.
          </p>
        </div>

        <div>
          <h2 className="text-2xl font-medium mb-4">
            Privacy Policy Table of Contents
          </h2>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>What this Privacy Policy Covers</li>
            <li>Personal Data</li>
            <li>Categories of Personal Data We Collect</li>
            <li>
              Our Commercial or Business Purposes for Collecting Personal Data
            </li>
            <li>Other Permitted Purposes for Processing Personal Data</li>
            <li>Categories of Sources of Personal Data</li>
            <li>How We Disclose Your Personal Data</li>
            <li>Tracking Tools and Opt-Out</li>
            <li>Data Security</li>
            <li>Personal Data of Children</li>
            <li>Other State Law Privacy Rights</li>
            <li>
              European Union, United Kingdom, and Swiss Data Subject Rights
            </li>
            <li>Contact Information</li>
          </ul>
        </div>

        <div>
          <h2 className="text-2xl font-medium mb-4">
            What this Privacy Policy Covers
          </h2>
          <p className="mb-4">
            This Privacy Policy covers how we treat Personal Data that we gather
            when you access or use our Services. "Personal Data" means any
            information that identifies or relates to a particular individual
            and also includes information referred to as "personally
            identifiable information" or "personal information" under applicable
            data privacy laws, rules or regulations. This Privacy Policy does
            not cover the practices of companies we don't own or control or
            people we don't manage.
          </p>
        </div>

        <div>
          <h2 className="text-2xl font-medium mb-4">Personal Data</h2>

          <h3 className="text-xl font-medium mb-4">
            Categories of Personal Data We Collect
          </h3>
          <p className="mb-4">
            This chart details the categories of Personal Data that we collect
            and have collected over the past 12 months:
          </p>

          <div className="overflow-x-auto mb-6">
            <table className="min-w-full border border-gray-300 dark:border-gray-600">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  <th className="border border-gray-300 dark:border-gray-600 px-2 sm:px-4 py-2 text-left font-medium text-sm sm:text-base break-words">
                    Category of Personal Data (and Examples)
                  </th>
                  <th className="border border-gray-300 dark:border-gray-600 px-2 sm:px-4 py-2 text-left font-medium text-sm sm:text-base break-words">
                    Business or Commercial Purpose(s) for Collection
                  </th>
                  <th className="border border-gray-300 dark:border-gray-600 px-2 sm:px-4 py-2 text-left font-medium text-sm sm:text-base break-words">
                    Categories of Third Parties With Whom We Disclose this
                    Personal Data
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-gray-300 dark:border-gray-600 px-2 sm:px-4 py-2 text-sm sm:text-base break-words">
                    <strong>Professional Contact Data</strong> such as first and
                    last name, email address and information about your
                    employer.
                  </td>
                  <td className="border border-gray-300 dark:border-gray-600 px-2 sm:px-4 py-2 text-sm sm:text-base break-words">
                    Providing, Customizing and Improving the Services
                    <br />
                    Marketing the Services
                    <br />
                    Corresponding with You
                  </td>
                  <td className="border border-gray-300 dark:border-gray-600 px-2 sm:px-4 py-2 text-sm sm:text-base break-words">
                    Service Providers
                  </td>
                </tr>
                <tr>
                  <td className="border border-gray-300 dark:border-gray-600 px-2 sm:px-4 py-2 text-sm sm:text-base break-words">
                    <strong>Payment Data</strong> such as payment card type,
                    payment card number, and billing address, phone number, and
                    email.
                  </td>
                  <td className="border border-gray-300 dark:border-gray-600 px-2 sm:px-4 py-2 text-sm sm:text-base break-words">
                    Providing, Customizing and Improving the Services
                    <br />
                    Corresponding with You
                  </td>
                  <td className="border border-gray-300 dark:border-gray-600 px-2 sm:px-4 py-2 text-sm sm:text-base break-words">
                    Service Providers (specifically our payment processing
                    partner, currently Stripe, Inc.)
                  </td>
                </tr>
                <tr>
                  <td className="border border-gray-300 dark:border-gray-600 px-2 sm:px-4 py-2 text-sm sm:text-base break-words">
                    <strong>Social Network Data</strong> such as account
                    information, such as your GitHub profile image, or
                    information generated when the Services are accessed via a
                    third-party (such as Slack, GitHub, Microsoft Teams, Google
                    SSO)
                  </td>
                  <td className="border border-gray-300 dark:border-gray-600 px-2 sm:px-4 py-2 text-sm sm:text-base break-words">
                    Providing, Customizing and Improving the Services
                    <br />
                    Corresponding with You
                  </td>
                  <td className="border border-gray-300 dark:border-gray-600 px-2 sm:px-4 py-2 text-sm sm:text-base break-words">
                    Service Providers
                  </td>
                </tr>
                <tr>
                  <td className="border border-gray-300 dark:border-gray-600 px-2 sm:px-4 py-2 text-sm sm:text-base break-words">
                    <strong>Device/IP Data</strong> such as IP address and type
                    of device/operating system/browser used to access the
                    Services.
                  </td>
                  <td className="border border-gray-300 dark:border-gray-600 px-2 sm:px-4 py-2 text-sm sm:text-base break-words">
                    Providing, Customizing and Improving the Services
                  </td>
                  <td className="border border-gray-300 dark:border-gray-600 px-2 sm:px-4 py-2 text-sm sm:text-base break-words">
                    Service Providers
                  </td>
                </tr>
                <tr>
                  <td className="border border-gray-300 dark:border-gray-600 px-2 sm:px-4 py-2 text-sm sm:text-base break-words">
                    <strong>Web Analytics</strong> such as referring
                    webpage/source through which you accessed the Services and
                    statistics associated with the interaction between device or
                    browser and the Services.
                  </td>
                  <td className="border border-gray-300 dark:border-gray-600 px-2 sm:px-4 py-2 text-sm sm:text-base break-words">
                    Providing, Customizing and Improving the Services
                  </td>
                  <td className="border border-gray-300 dark:border-gray-600 px-2 sm:px-4 py-2 text-sm sm:text-base break-words">
                    Service Providers
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3 className="text-xl font-medium mb-4">
            Our Commercial or Business Purposes for Collecting Personal Data
          </h3>

          <h4 className="text-lg font-medium mb-2">
            Providing, Customizing and Improving the Services
          </h4>
          <ul className="list-disc list-inside space-y-1 ml-4 mb-4">
            <li>Providing you with the information you request.</li>
            <li>
              Meeting or fulfilling the reason you provided the information to
              us.
            </li>
            <li>Providing support and assistance for the Services.</li>
            <li>
              Improving the Services, including testing, research, internal
              analytics and product development.
            </li>
            <li>
              Personalizing the Services, website content and communications
              based on your preferences.
            </li>
            <li>Doing fraud protection, security and debugging.</li>
            <li>
              Carrying out other business purposes stated when collecting your
              Personal Data or as otherwise set forth in applicable data privacy
              laws.
            </li>
          </ul>

          <h4 className="text-lg font-medium mb-2">Corresponding with You</h4>
          <ul className="list-disc list-inside space-y-1 ml-4 mb-4">
            <li>
              Responding to correspondence that we receive from you, contacting
              you when necessary or requested, and sending you information about
              Blink or the Services.
            </li>
            <li>
              Sending emails and other communications according to your
              preferences.
            </li>
          </ul>
        </div>

        <div>
          <h3 className="text-xl font-medium mb-4">
            Other Permitted Purposes for Processing Personal Data
          </h3>
          <p className="mb-4">
            In addition, each of the above referenced categories of Personal
            Data may be collected, used, and disclosed with the government,
            including law enforcement, or other parties to meet certain legal
            requirements and enforcing legal terms including: fulfilling our
            legal obligations under applicable law, regulation, court order or
            other legal process, such as preventing, detecting and investigating
            security incidents and potentially illegal or prohibited activities;
            protecting the rights, property or safety of you, Blink or another
            party; enforcing any agreements with you; responding to claims that
            any posting or other content violates third-party rights; and
            resolving disputes.
          </p>
          <p className="mb-4">
            We will not collect additional categories of Personal Data or use
            the Personal Data we collected for materially different, unrelated
            or incompatible purposes without providing you notice or obtaining
            your consent.
          </p>
        </div>

        <div>
          <h3 className="text-xl font-medium mb-4">
            Categories of Sources of Personal Data
          </h3>
          <p className="mb-4">
            We collect Personal Data about you from the following categories of
            sources:
          </p>

          <h4 className="text-lg font-medium mb-2">You</h4>
          <ul className="list-disc list-inside space-y-1 ml-4 mb-4">
            <li>When you provide such information directly to us.</li>
            <li>
              When you create an account or use our interactive tools and
              Services.
            </li>
            <li>
              When you voluntarily provide information in free-form text boxes
              through the Services or through responses to surveys or
              questionnaires.
            </li>
            <li>When you send us an email or otherwise contact us.</li>
            <li>
              When you use the Services and such information is collected
              automatically.
            </li>
            <li>
              Through Cookies (defined in the "Tracking Tools and Opt-Out"
              section below).
            </li>
            <li>
              If you use a location-enabled browser, we may receive information
              about your location and mobile device, as applicable.
            </li>
          </ul>

          <h4 className="text-lg font-medium mb-2">Third Parties</h4>
          <h5 className="text-base font-medium mb-2">
            Third-Party Credentials
          </h5>
          <p className="mb-4">
            If you provide your third-party account credentials, such as your
            social network account credentials, to us or otherwise sign in to
            the Services through a third-party site or service, some content
            and/or information in those accounts may be transmitted into your
            account with us.
          </p>
        </div>

        <div>
          <h2 className="text-2xl font-medium mb-4">
            How We Disclose Your Personal Data
          </h2>
          <p className="mb-4">
            We disclose your Personal Data to the categories of service
            providers and other parties listed in this section. For more
            information, please refer to the state-specific sections below.
          </p>

          <h4 className="text-lg font-medium mb-2">Service Providers</h4>
          <p className="mb-2">
            These parties help us provide the Services or perform business
            functions on our behalf. They include:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-4 mb-4">
            <li>Hosting, technology and communication providers.</li>
            <li>Analytics providers for web traffic or usage of the site.</li>
            <li>Security and fraud prevention consultants.</li>
            <li>Support and customer service vendors.</li>
          </ul>

          <h4 className="text-lg font-medium mb-2">Legal Obligations</h4>
          <p className="mb-4">
            We may disclose any Personal Data that we collect with third parties
            in conjunction with any of the activities set forth under "Other
            Permitted Purposes for Processing Personal Data" section above.
          </p>

          <h4 className="text-lg font-medium mb-2">Business Transfers</h4>
          <p className="mb-4">
            All of your Personal Data that we collect may be transferred to a
            third party if we undergo a merger, acquisition, bankruptcy or other
            transaction in which that third party assumes control of our
            business (in whole or in part).
          </p>

          <h4 className="text-lg font-medium mb-2">
            Data that is Not Personal Data
          </h4>
          <p className="mb-4">
            We may create aggregated, de-identified or anonymized data from the
            Personal Data we collect, including by removing information that
            makes the data personally identifiable to a particular user. We may
            use such aggregated, de-identified or anonymized data and disclose
            it with third parties for our lawful business purposes, including to
            analyze, build and improve the Services and promote our business,
            provided that we will not disclose such data in a manner that could
            identify you.
          </p>
        </div>

        <div>
          <h2 className="text-2xl font-medium mb-4">
            Tracking Tools and Opt-Out
          </h2>
          <p className="mb-4">
            The Services use cookies and similar technologies such as pixel
            tags, web beacons, clear GIFs and JavaScript (collectively,
            "Cookies") to enable our servers to recognize your web browser, tell
            us how and when you visit and use our Services, analyze trends,
            learn about our user base and operate and improve our Services.
            Cookies are small pieces of data– usually text files – placed on
            your computer, tablet, phone or similar device when you use that
            device to access our Services. We may also supplement the
            information we collect from you with information received from third
            parties, including third parties that have placed their own Cookies
            on your device(s).
          </p>
          <p className="mb-4">
            Please note that because of our use of Cookies, the Services do not
            support "Do Not Track" requests sent from a browser at this time.
          </p>
          <p className="mb-4">We use the following types of Cookies:</p>

          <p className="mb-2">
            <strong>Essential Cookies.</strong> Essential Cookies are required
            for providing you with features or services that you have requested.
            For example, certain Cookies enable you to log into secure areas of
            our Services. Disabling these Cookies may make certain features and
            services unavailable.
          </p>

          <p className="mb-2">
            <strong>Functional Cookies.</strong> Functional Cookies are used to
            record your choices and settings regarding our Services, maintain
            your preferences over time and recognize you when you return to our
            Services. These Cookies help us to personalize our content for you,
            greet you by name and remember your preferences (for example, your
            choice of language or region).
          </p>

          <p className="mb-4">
            <strong>Performance/Analytical Cookies.</strong>{" "}
            Performance/Analytical Cookies allow us to understand how visitors
            use our Services. They do this by collecting information about the
            number of visitors to the Services, what pages visitors view on our
            Services and how long visitors are viewing pages on the Services.
            Performance/Analytical Cookies also help us measure the performance
            of our campaigns in order to help us improve our campaigns and the
            Services' content for those who engage with our content.
          </p>

          <p className="mb-4">
            You can decide whether or not to accept Cookies through your
            internet browser's settings. Most browsers have an option for
            turning off the Cookie feature, which will prevent your browser from
            accepting new Cookies, as well as (depending on the sophistication
            of your browser software) allow you to decide on acceptance of each
            new Cookie in a variety of ways. You can also delete all Cookies
            that are already on your device. If you do this, however, you may
            have to manually adjust some preferences every time you visit our
            website and some of the Services and functionalities may not work.
          </p>

          {/*          <p className="mb-4">
          {/*            To explore what Cookie settings are available to you or to modify
          {/*            your preferences with respect to Cookies, you can access your Cookie
          {/*            management settings by clicking [LINK].
          {/*          </p>*/}

          <p className="mb-4">
            To find out more information about Cookies generally, including
            information about how to manage and delete Cookies, please visit{" "}
            <a
              href="http://www.allaboutcookies.org/"
              className="underline text-white hover:text-gray-200 break-all"
            >
              http://www.allaboutcookies.org/
            </a>{" "}
            or{" "}
            <a
              href="https://ico.org.uk/for-the-public/online/cookies/"
              className="underline text-white hover:text-gray-200 break-all"
            >
              https://ico.org.uk/for-the-public/online/cookies/
            </a>{" "}
            if you are located in the European Union.
          </p>
        </div>

        <div>
          <h2 className="text-2xl font-medium mb-4">Data Security</h2>
          <p className="mb-4">
            We seek to protect your Personal Data from unauthorized access, use
            and disclosure using appropriate physical, technical, organizational
            and administrative security measures based on the type of Personal
            Data and how we are processing that data. You should also help
            protect your data by appropriately selecting and protecting your
            password and/or other sign-on mechanism; limiting access to your
            computer or device and browser; and signing off after you have
            finished accessing your account. Although we work to protect the
            security of your account and other data that we hold in our records,
            please be aware that no method of transmitting data over the
            internet or storing data is completely secure.
          </p>
        </div>

        <div>
          <h2 className="text-2xl font-medium mb-4">Data Retention</h2>
          <p className="mb-4">
            We retain Personal Data about you for as long as necessary to
            provide you with our Services or to perform our business or
            commercial purposes for collecting your Personal Data. When
            establishing a retention period for specific categories of data, we
            consider who we collected the data from, our need for the Personal
            Data, why we collected the Personal Data, and the sensitivity of the
            Personal Data. In some cases we retain Personal Data for longer, if
            doing so is necessary to comply with our legal obligations, resolve
            disputes or collect fees owed, or is otherwise permitted or required
            by applicable law, rule or regulation. We may further retain
            information in an anonymous or aggregated form where that
            information would not identify you personally. For example, we
            retain your device/IP data for as long as we need it to ensure that
            our systems are working appropriately, effectively and efficiently.
          </p>
        </div>

        <div>
          <h2 className="text-2xl font-medium mb-4">
            Personal Data of Children
          </h2>
          <p className="mb-4">
            As noted in the Terms and Conditions, we do not knowingly collect or
            solicit Personal Data from children under 13 years of age; if you
            are a child under the age of 13, please do not attempt to register
            for or otherwise use the Services or send us any Personal Data. If
            we learn we have collected Personal Data from a child under 13 years
            of age, we will delete that information as quickly as possible. If
            you believe that a child under 13 years of age may have provided
            Personal Data to us, please contact us at{" "}
            <a
              href="mailto:support@coder.com"
              className="underline text-white hover:text-gray-200 break-all"
            >
              support@coder.com
            </a>
            .
          </p>
        </div>

        <div>
          <h2 className="text-2xl font-medium mb-4">
            Other State Law Privacy Rights
          </h2>

          <h3 className="text-xl font-medium mb-4">
            California Resident Rights
          </h3>
          <p className="mb-4">
            Under California Civil Code Sections 1798.83-1798.84, California
            residents are entitled to contact us to prevent disclosure of
            Personal Data to third parties for such third parties' direct
            marketing purposes; in order to submit such a request, please
            contact us at{" "}
            <a
              href="mailto:support@coder.com"
              className="underline text-white hover:text-gray-200 break-all"
            >
              support@coder.com
            </a>
            .
          </p>
          <p className="mb-4">
            Your browser may offer you a "Do Not Track" option, which allows you
            to signal to operators of websites and web applications and services
            that you do not wish such operators to track certain of your online
            activities over time and across different websites. Our Services do
            not support Do Not Track requests at this time. To find out more
            about "Do Not Track," you can visit{" "}
            <a
              href="http://www.allaboutdnt.com"
              className="underline text-white hover:text-gray-200"
            >
              www.allaboutdnt.com
            </a>
            .
          </p>

          <h3 className="text-xl font-medium mb-4">Nevada Resident Rights</h3>
          <p className="mb-4">
            Please note that we do not currently sell your Personal Data as
            sales are defined in Nevada Revised Statutes Chapter 603A.
          </p>
        </div>

        <div>
          <h2 className="text-2xl font-medium mb-4">
            European Union and United Kingdom Data Subject Rights
          </h2>

          <h3 className="text-xl font-medium mb-4">EU and UK Residents</h3>
          <p className="mb-4">
            If you are a resident of the European Union ("EU"), United Kingdom
            ("UK"), Lichtenstein, Norway or Iceland, you may have additional
            rights under the EU or UK General Data Protection Regulation (the
            "GDPR") with respect to your Personal Data, as outlined below.
          </p>
          <p className="mb-4">
            For this section, we use the terms "Personal Data" and "processing"
            as they are defined in the GDPR, but "Personal Data" generally means
            information that can be used to individually identify a person, and
            "processing" generally covers actions that can be performed in
            connection with data such as collection, use, storage and
            disclosure. Blink will be the controller of your Personal Data
            processed in connection with the Services.
          </p>
          <p className="mb-4">
            If there are any conflicts between this section and any other
            provision of this Privacy Policy, the policy or portion that is more
            protective of Personal Data shall control to the extent of such
            conflict. If you have any questions about this section or whether
            any of the following applies to you, please contact us at{" "}
            <a
              href="mailto:support@coder.com"
              className="underline text-white hover:text-gray-200 break-all"
            >
              support@coder.com
            </a>
            .
          </p>

          <h4 className="text-lg font-medium mb-2">Personal Data We Collect</h4>
          <p className="mb-4">
            The "Categories of Personal Data We Collect" section above details
            the Personal Data that we collect from you.
          </p>

          <h4 className="text-lg font-medium mb-2">
            Personal Data Use and Processing Grounds
          </h4>
          <p className="mb-4">
            The "Our Commercial or Business Purposes for Collecting Personal
            Data" section above explains how we use your Personal Data.
          </p>
          <p className="mb-4">
            We will only process your Personal Data if we have a lawful basis
            for doing so. Lawful bases for processing include consent,
            contractual necessity and our "legitimate interests" or the
            legitimate interest of others, as further described below.
          </p>

          <p className="mb-2">
            <strong>Contractual Necessity:</strong> We process the following
            categories of Personal Data as a matter of "contractual necessity",
            meaning that we need to process the data to perform under our Terms
            of Use with you, which enables us to provide you with the Services.
            When we process data due to contractual necessity, failure to
            provide such Personal Data will result in your inability to use some
            or all portions of the Services that require such data.
          </p>

          <p className="mb-2">
            <strong>Legitimate Interest:</strong> We process the following
            categories of Personal Data when we believe it furthers the
            legitimate interest of us or third parties:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-4 mb-4">
            <li>Professional Contact Data</li>
            <li>Payment Data</li>
            <li>Social Network Data</li>
            <li>Device/IP Data</li>
            <li>Web Analytics</li>
          </ul>

          <p className="mb-4">
            We may also de-identify or anonymize Personal Data to further our
            legitimate interests.
          </p>

          <p className="mb-2">
            Examples of these legitimate interests include (as described in more
            detail above):
          </p>
          <ul className="list-disc list-inside space-y-1 ml-4 mb-4">
            <li>Providing, customizing and improving the Services.</li>
            <li>Marketing the Services.</li>
            <li>Corresponding with you.</li>
            <li>Meeting legal requirements and enforcing legal terms.</li>
            <li>Completing corporate transactions.</li>
          </ul>

          <p className="mb-4">
            <strong>Consent:</strong> In some cases, we process Personal Data
            based on the consent you expressly grant to us at the time we
            collect such data. When we process Personal Data based on your
            consent, it will be expressly indicated to you at the point and time
            of collection.
          </p>

          <p className="mb-4">
            <strong>Other Processing Grounds:</strong> From time to time we may
            also need to process Personal Data to comply with a legal
            obligation, if it is necessary to protect the vital interests of you
            or other data subjects, or if it is necessary for a task carried out
            in the public interest.
          </p>

          <h4 className="text-lg font-medium mb-2">Disclosing Personal Data</h4>
          <p className="mb-4">
            The "How We Disclose Your Personal Data" section above details how
            we disclose your Personal Data with third parties.
          </p>

          <h4 className="text-lg font-medium mb-2">
            EU, UK and Swiss Data Subject Rights
          </h4>
          <p className="mb-4">
            You have certain rights with respect to your Personal Data,
            including those set forth below. For more information about these
            rights, or to submit a request, please email us at{" "}
            <a
              href="mailto:support@coder.com"
              className="underline text-white hover:text-gray-200 break-all"
            >
              support@coder.com
            </a>
            . Please note that in some circumstances, we may not be able to
            fully comply with your request, such as if it is frivolous or
            extremely impractical, if it jeopardizes the rights of others, or if
            it is not required by law, but in those circumstances, we will still
            respond to notify you of such a decision. In some cases, we may also
            need you to provide us with additional information, which may
            include Personal Data, if necessary to verify your identity and the
            nature of your request.
          </p>

          <ul className="list-disc list-inside space-y-2 ml-4 mb-4">
            <li>
              <strong>Access:</strong> You can request more information about
              the Personal Data we hold about you and request a copy of such
              Personal Data.
            </li>
            <li>
              <strong>Rectification:</strong> If you believe that any Personal
              Data we are holding about you is incorrect or incomplete, you can
              request that we correct or supplement such data.
            </li>
            <li>
              <strong>Erasure:</strong> You can request that we erase some or
              all of your Personal Data from our systems.
            </li>
            <li>
              <strong>Withdrawal of Consent:</strong> If we are processing your
              Personal Data based on your consent (as indicated at the time of
              collection of such data), you have the right to withdraw your
              consent at any time. Please note, however, that if you exercise
              this right, you may have to then provide express consent on a
              case-by-case basis for the use or disclosure of certain of your
              Personal Data, if such use or disclosure is necessary to enable
              you to utilize some or all of our Services.
            </li>
            <li>
              <strong>Portability:</strong> You can ask for a copy of your
              Personal Data in a machine-readable format. You can also request
              that we transmit the data to another controller where technically
              feasible.
            </li>
            <li>
              <strong>Objection:</strong> You can contact us to let us know that
              you object to the further use or disclosure of your Personal Data
              for certain purposes, such as for direct marketing purposes.
            </li>
            <li>
              <strong>Restriction of Processing:</strong> You can ask us to
              restrict further processing of your Personal Data.
            </li>
            <li>
              <strong>Right to File Complaint:</strong> You have the right to
              lodge a complaint about Blink' practices with respect to your
              Personal Data with the supervisory authority of your country or EU
              Member State. A list of Supervisory Authorities is available here:{" "}
              <a
                href="https://edpb.europa.eu/about-edpb/board/members_en"
                className="underline text-white hover:text-gray-200"
              >
                https://edpb.europa.eu/about-edpb/board/members_en
              </a>
              .
            </li>
          </ul>

          <h4 className="text-lg font-medium mb-2">
            Transfers of Personal Data
          </h4>
          <p className="mb-4">
            The Services are hosted and operated in the United States ("U.S.")
            through Blink and its service providers, and if you do not reside in
            the U.S., laws in the U.S. may differ from the laws where you
            reside. By using the Services, you acknowledge that any Personal
            Data about you, regardless of whether provided by you or obtained
            from a third party, is being provided to Blink in the U.S. and will
            be hosted on U.S. servers, and you authorize Blink to transfer,
            store and process your information to and in the U.S., and possibly
            other countries. In some circumstances, your Personal Data may be
            transferred to the U.S. pursuant to a data processing agreement
            incorporating standard data protection clauses.
          </p>
        </div>

        <div>
          <h2 className="text-2xl font-medium mb-4">Contact Information</h2>
          <p className="mb-4">
            If you have any questions or comments about this Privacy Policy, the
            ways in which we collect and use your Personal Data or your choices
            and rights regarding such collection and use, please do not hesitate
            to contact us at{" "}
            <a
              href="mailto:support@coder.com"
              className="underline text-white hover:text-gray-200 break-all"
            >
              support@coder.com
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
