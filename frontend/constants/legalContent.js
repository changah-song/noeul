// Legal documents for Noeul, parsed from the published website pages
// (privacy.html / terms.html, last updated June 26, 2026). Keep this file in
// sync with the website versions — content only, no styling.
//
// Shape: { title, updated, sections: [{ heading?, blocks: [{ type, text }] }] }
//   type 'p'      — paragraph
//   type 'bullet' — bulleted list item
//   type 'sub'    — sub-heading (h3)

const p = (text) => ({ type: 'p', text });
const b = (text) => ({ type: 'bullet', text });
const sub = (text) => ({ type: 'sub', text });

export const CONTACT_EMAIL = 'noeul.app@gmail.com';

export const CONTACT_ADDRESS = 'Noeul\n64-16 Sincheon-daero 183beon-gil\nBusanjin-gu, Busan 47262\nSouth Korea';

const PRIVACY_POLICY = {
  title: 'Privacy Policy',
  updated: 'Last updated June 26, 2026',
  sections: [
    {
      blocks: [
        p('This Privacy Notice for Noeul ("we," "us," or "our") describes how and why we might access, collect, store, use, and/or share ("process") your personal information when you use our services ("Services"), including when you:'),
        b('Download and use our mobile application (Noeul), or any other application of ours that links to this Privacy Notice;'),
        b('Use Noeul. Noeul is a language learning app that helps users improve their reading comprehension in Chinese, Korean, and English by letting them read real books in their target language. When users tap on an unfamiliar word, the app instantly surfaces a dictionary definition and its breakdown. Vocabulary is tracked across reading sessions to help users build proficiency over time. The app uses AI to assist with contextual lookups and supports Google sign-in for account management.'),
        b('Engage with us in other related ways, including any marketing or events.'),
        p(`Questions or concerns? Reading this Privacy Notice will help you understand your privacy rights and choices. We are responsible for making decisions about how your personal information is processed. If you do not agree with our policies and practices, please do not use our Services. If you still have any questions or concerns, please contact us at ${CONTACT_EMAIL}.`),
      ],
    },
    {
      heading: 'Summary of key points',
      blocks: [
        p('This summary provides key points from our Privacy Notice. You can find out more details about any of these topics in the sections below.'),
        p('What personal information do we process? When you visit, use, or navigate our Services, we may process personal information depending on how you interact with us and the Services, the choices you make, and the products and features you use.'),
        p('Do we process any sensitive personal information? Some of the information may be considered "special" or "sensitive" in certain jurisdictions, for example your racial or ethnic origins, sexual orientation, and religious beliefs. We do not process sensitive personal information.'),
        p('Do we collect any information from third parties? We do not collect any information from third parties.'),
        p('How do we process your information? We process your information to provide, improve, and administer our Services, communicate with you, for security and fraud prevention, and to comply with law. We may also process your information for other purposes with your consent. We process your information only when we have a valid legal reason to do so.'),
        p('In what situations and with which parties do we share personal information? We may share information in specific situations and with specific third parties.'),
        p('How do we keep your information safe? We have adequate organizational and technical processes and procedures in place to protect your personal information. However, no electronic transmission over the internet or information storage technology can be guaranteed to be 100% secure, so we cannot promise or guarantee that hackers, cybercriminals, or other unauthorized third parties will not be able to defeat our security and improperly collect, access, steal, or modify your information.'),
        p('What are your rights? Depending on where you are located geographically, the applicable privacy law may mean you have certain rights regarding your personal information.'),
        p(`How do you exercise your rights? The easiest way to exercise your rights is by contacting us at ${CONTACT_EMAIL}. We will consider and act upon any request in accordance with applicable data protection laws.`),
      ],
    },
    {
      heading: '1. What information do we collect?',
      blocks: [
        sub('Personal information you disclose to us'),
        p('In Short: We collect personal information that you provide to us.'),
        p('We collect personal information that you voluntarily provide to us when you register on the Services, express an interest in obtaining information about us or our products and Services, when you participate in activities on the Services, or otherwise when you contact us.'),
        p('Personal Information Provided by You. The personal information that we collect depends on the context of your interactions with us and the Services, the choices you make, and the products and features you use. The personal information we collect may include the following:'),
        b('email addresses'),
        b('usernames'),
        b('passwords'),
        p('Sensitive Information. We do not process sensitive information.'),
        p('Social Media Login Data. We may provide you with the option to register with us using your existing Google account. If you choose to register in this way, we will collect certain profile information about you from Google, as described in the section called "How do we handle your social logins?" below.'),
        p('Application Data. If you use our application(s), we also may collect the following information if you choose to provide us with access or permission:'),
        b("Mobile Device Access. We may request access or permission to certain features from your mobile device, including your mobile device's screen overlay / display over other apps, and other features. If you wish to change our access or permissions, you may do so in your device's settings."),
        p('This information is primarily needed to maintain the security and operation of our application(s), for troubleshooting, and for our internal analytics and reporting purposes.'),
        p('All personal information that you provide to us must be true, complete, and accurate, and you must notify us of any changes to such personal information.'),
        sub('Information automatically collected'),
        p('In Short: Some information — such as your Internet Protocol (IP) address and/or browser and device characteristics — is collected automatically when you visit our Services.'),
        p('We automatically collect certain information when you visit, use, or navigate the Services. This information does not reveal your specific identity (like your name or contact information) but may include device and usage information, such as your IP address, browser and device characteristics, operating system, language preferences, referring URLs, device name, country, location, information about how and when you use our Services, and other technical information. This information is primarily needed to maintain the security and operation of our Services, and for our internal analytics and reporting purposes.'),
        p('The information we collect includes:'),
        b('Log and Usage Data. Log and usage data is service-related, diagnostic, usage, and performance information our servers automatically collect when you access or use our Services and which we record in log files. Depending on how you interact with us, this log data may include your IP address, device information, browser type, and settings and information about your activity in the Services (such as the date/time stamps associated with your usage, pages and files viewed, searches, and other actions you take such as which features you use), device event information (such as system activity, error reports (sometimes called "crash dumps"), and hardware settings).'),
        b('Device Data. We collect device data such as information about your computer, phone, tablet, or other device you use to access the Services. Depending on the device used, this device data may include information such as your IP address (or proxy server), device and application identification numbers, location, browser type, hardware model, Internet service provider and/or mobile carrier, operating system, and system configuration information.'),
        b('Inferred data. Proficiency levels and vocabulary knowledge inferred from your reading activity and word lookup history.'),
        sub('Google API'),
        p('Our use of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements.'),
      ],
    },
    {
      heading: '2. How do we process your information?',
      blocks: [
        p('In Short: We process your information to provide, improve, and administer our Services, communicate with you, for security and fraud prevention, and to comply with law. We may also process your information for other purposes with your consent.'),
        p('We process your personal information for a variety of reasons, depending on how you interact with our Services, including:'),
        b('To facilitate account creation and authentication and otherwise manage user accounts. We may process your information so you can create and log in to your account, as well as keep your account in working order.'),
        b('To deliver and facilitate delivery of services to the user. We may process your information to provide you with the requested service.'),
        b('To respond to user inquiries/offer support to users. We may process your information to respond to your inquiries and solve any potential issues you might have with the requested service.'),
        b('To send administrative information to you. We may process your information to send you details about our products and services, changes to our terms and policies, and other similar information.'),
        b('To request feedback. We may process your information when necessary to request feedback and to contact you about your use of our Services.'),
        b('To protect our Services. We may process your information as part of our efforts to keep our Services safe and secure, including fraud monitoring and prevention.'),
        b('To identify usage trends. We may process information about how you use our Services to better understand how they are being used so we can improve them.'),
        b("To save or protect an individual's vital interest. We may process your information when necessary to save or protect an individual's vital interest, such as to prevent harm."),
      ],
    },
    {
      heading: '3. What legal bases do we rely on to process your information?',
      blocks: [
        p('In Short: We only process your personal information when we believe it is necessary and we have a valid legal reason (i.e., legal basis) to do so under applicable law, like with your consent, to comply with laws, to provide you with services to enter into or fulfill our contractual obligations, to protect your rights, or to fulfill our legitimate business interests.'),
        p('If you are located in the EU or UK, this section applies to you.'),
        p('The General Data Protection Regulation (GDPR) and UK GDPR require us to explain the valid legal bases we rely on in order to process your personal information. As such, we may rely on the following legal bases to process your personal information:'),
        b('Consent. We may process your information if you have given us permission (i.e., consent) to use your personal information for a specific purpose. You can withdraw your consent at any time.'),
        b('Performance of a Contract. We may process your personal information when we believe it is necessary to fulfill our contractual obligations to you, including providing our Services or at your request prior to entering into a contract with you.'),
        b('Legitimate Interests. We may process your information when we believe it is reasonably necessary to achieve our legitimate business interests and those interests do not outweigh your interests and fundamental rights and freedoms. For example, we may process your personal information in order to: analyze how our Services are used so we can improve them to engage and retain users; diagnose problems and/or prevent fraudulent activities; understand how our users use our products and services so we can improve user experience.'),
        b('Legal Obligations. We may process your information where we believe it is necessary for compliance with our legal obligations, such as to cooperate with a law enforcement body or regulatory agency, exercise or defend our legal rights, or disclose your information as evidence in litigation in which we are involved.'),
        b('Vital Interests. We may process your information where we believe it is necessary to protect your vital interests or the vital interests of a third party, such as situations involving potential threats to the safety of any person.'),
        p('If you are located in Canada, this section applies to you.'),
        p('We may process your information if you have given us specific permission (i.e., express consent) to use your personal information for a specific purpose, or in situations where your permission can be inferred (i.e., implied consent). You can withdraw your consent at any time.'),
        p('In some exceptional cases, we may be legally permitted under applicable law to process your information without your consent, including, for example:'),
        b('If collection is clearly in the interests of an individual and consent cannot be obtained in a timely way'),
        b('For investigations and fraud detection and prevention'),
        b('For business transactions provided certain conditions are met'),
        b('If it is contained in a witness statement and the collection is necessary to assess, process, or settle an insurance claim'),
        b('For identifying injured, ill, or deceased persons and communicating with next of kin'),
        b('If we have reasonable grounds to believe an individual has been, is, or may be victim of financial abuse'),
        b('If it is reasonable to expect collection and use with consent would compromise the availability or the accuracy of the information and the collection is reasonable for purposes related to investigating a breach of an agreement or a contravention of the laws of Canada or a province'),
        b('If disclosure is required to comply with a subpoena, warrant, court order, or rules of the court relating to the production of records'),
        b('If it was produced by an individual in the course of their employment, business, or profession and the collection is consistent with the purposes for which the information was produced'),
        b('If the collection is solely for journalistic, artistic, or literary purposes'),
        b('If the information is publicly available and is specified by the regulations'),
        b('We may disclose de-identified information for approved research or statistics projects, subject to ethics oversight and confidentiality commitments'),
      ],
    },
    {
      heading: '4. When and with whom do we share your personal information?',
      blocks: [
        p('In Short: We may share information in specific situations described in this section and/or with the following third parties.'),
        p('Vendors, Consultants, and Other Third-Party Service Providers. We may share your data with third-party vendors, service providers, contractors, or agents ("third parties") who perform services for us or on our behalf and require access to such information to do that work. We have contracts in place with our third parties, which are designed to help safeguard your personal information. This means that they cannot do anything with your personal information unless we have instructed them to do it. They will also not share your personal information with any organization apart from us. They also commit to protect the data they hold on our behalf and to retain it for the period we instruct.'),
        p('The third parties we may share personal information with are as follows:'),
        b('AI Service Providers: Anthropic'),
        b('User Account Registration and Authentication: GitHub OAuth'),
        b('Translation: RapidAPI'),
        b('Data Storage / Backend: Supabase'),
        p('We also may need to share your personal information in the following situations:'),
        b('Business Transfers. We may share or transfer your information in connection with, or during negotiations of, any merger, sale of company assets, financing, or acquisition of all or a portion of our business to another company.'),
      ],
    },
    {
      heading: '5. Do we offer artificial intelligence-based products?',
      blocks: [
        p('In Short: We offer products, features, or tools powered by artificial intelligence, machine learning, or similar technologies.'),
        p('As part of our Services, we offer products, features, or tools powered by artificial intelligence, machine learning, or similar technologies (collectively, "AI Products"). These tools are designed to enhance your experience and provide you with innovative solutions. The terms in this Privacy Notice govern your use of the AI Products within our Services.'),
        sub('Use of AI Technologies'),
        p('We provide the AI Products through third-party service providers ("AI Service Providers"), including Anthropic. As outlined in this Privacy Notice, your input, output, and personal information will be shared with and processed by these AI Service Providers to enable your use of our AI Products for purposes outlined in "What legal bases do we rely on to process your information?" You must not use the AI Products in any way that violates the terms or policies of any AI Service Provider.'),
        sub('Our AI Products'),
        p('Our AI Products are designed for the following functions:'),
        b('AI insights'),
        b('AI translation'),
        b('Natural language processing'),
        b('Text analysis'),
        sub('How We Process Your Data Using AI'),
        p("All personal information processed using our AI Products is handled in line with our Privacy Notice and our agreement with third parties. This ensures high security and safeguards your personal information throughout the process, giving you peace of mind about your data's safety."),
      ],
    },
    {
      heading: '6. How do we handle your social logins?',
      blocks: [
        p('In Short: If you choose to register or log in to our Services using your Google account, we may have access to certain information about you.'),
        p('Our Services offer you the ability to register and log in using your Google account. Where you choose to do this, we will receive certain profile information about you from Google. The profile information we receive will often include your name, email address, and profile picture, as well as other information you choose to make available.'),
        p('We will use the information we receive only for the purposes that are described in this Privacy Notice or that are otherwise made clear to you on the relevant Services. Please note that we do not control, and are not responsible for, other uses of your personal information by Google. We recommend that you review their privacy notice to understand how they collect, use, and share your personal information, and how you can set your privacy preferences on their sites and apps.'),
      ],
    },
    {
      heading: '7. How long do we keep your information?',
      blocks: [
        p('In Short: We keep your information for as long as necessary to fulfill the purposes outlined in this Privacy Notice unless otherwise required by law.'),
        p('We will only keep your personal information for as long as it is necessary for the purposes set out in this Privacy Notice, unless a longer retention period is required or permitted by law (such as tax, accounting, or other legal requirements). No purpose in this notice will require us keeping your personal information for longer than the period of time in which users have an account with us.'),
        p('When we have no ongoing legitimate business need to process your personal information, we will either delete or anonymize such information, or, if this is not possible (for example, because your personal information has been stored in backup archives), then we will securely store your personal information and isolate it from any further processing until deletion is possible.'),
      ],
    },
    {
      heading: '8. How do we keep your information safe?',
      blocks: [
        p('In Short: We aim to protect your personal information through a system of organizational and technical security measures.'),
        p('We have implemented appropriate and reasonable technical and organizational security measures designed to protect the security of any personal information we process. However, despite our safeguards and efforts to secure your information, no electronic transmission over the Internet or information storage technology can be guaranteed to be 100% secure, so we cannot promise or guarantee that hackers, cybercriminals, or other unauthorized third parties will not be able to defeat our security and improperly collect, access, steal, or modify your information. Although we will do our best to protect your personal information, transmission of personal information to and from our Services is at your own risk. You should only access the Services within a secure environment.'),
      ],
    },
    {
      heading: '9. What are your privacy rights?',
      blocks: [
        p('In Short: Depending on your state of residence in the US or in some regions, such as the European Economic Area (EEA), United Kingdom (UK), Switzerland, and Canada, you have rights that allow you greater access to and control over your personal information. You may review, change, or terminate your account at any time, depending on your country, province, or state of residence.'),
        p('In some regions (like the EEA, UK, Switzerland, and Canada), you have certain rights under applicable data protection laws. These may include the right (i) to request access and obtain a copy of your personal information, (ii) to request rectification or erasure; (iii) to restrict the processing of your personal information; (iv) if applicable, to data portability; and (v) not to be subject to automated decision-making. If a decision that produces legal or similarly significant effects is made solely by automated means, we will inform you, explain the main factors, and offer a simple way to request human review. In certain circumstances, you may also have the right to object to the processing of your personal information. You can make such a request by contacting us by using the contact details provided in the section "How can you contact us about this notice?" below.'),
        p('We will consider and act upon any request in accordance with applicable data protection laws.'),
        p('If you are located in the EEA or UK and you believe we are unlawfully processing your personal information, you also have the right to complain to your Member State data protection authority or UK data protection authority.'),
        p('If you are located in Switzerland, you may contact the Federal Data Protection and Information Commissioner.'),
        sub('Withdrawing your consent'),
        p('If we are relying on your consent to process your personal information, which may be express and/or implied consent depending on the applicable law, you have the right to withdraw your consent at any time. You can withdraw your consent at any time by contacting us by using the contact details provided in the section "How can you contact us about this notice?" below.'),
        p('However, please note that this will not affect the lawfulness of the processing before its withdrawal nor, when applicable law allows, will it affect the processing of your personal information conducted in reliance on lawful processing grounds other than consent.'),
        sub('Account Information'),
        p('If you would at any time like to review or change the information in your account or terminate your account, you can:'),
        b('Log in to your account settings and update your user account.'),
        p('Upon your request to terminate your account, we will deactivate or delete your account and information from our active databases. However, we may retain some information in our files to prevent fraud, troubleshoot problems, assist with any investigations, enforce our legal terms and/or comply with applicable legal requirements.'),
        p(`If you have questions or comments about your privacy rights, you may email us at ${CONTACT_EMAIL}.`),
      ],
    },
    {
      heading: '10. Controls for do-not-track features',
      blocks: [
        p('Most web browsers and some mobile operating systems and mobile applications include a Do-Not-Track ("DNT") feature or setting you can activate to signal your privacy preference not to have data about your online browsing activities monitored and collected. At this stage, no uniform technology standard for recognizing and implementing DNT signals has been finalized. As such, we do not currently respond to DNT browser signals or any other mechanism that automatically communicates your choice not to be tracked online. If a standard for online tracking is adopted that we must follow in the future, we will inform you about that practice in a revised version of this Privacy Notice.'),
        p('California law requires us to let you know how we respond to web browser DNT signals. Because there currently is not an industry or legal standard for recognizing or honoring DNT signals, we do not respond to them at this time.'),
      ],
    },
    {
      heading: '11. Do United States residents have specific privacy rights?',
      blocks: [
        p('In Short: If you are a resident of California, Colorado, Connecticut, Delaware, Florida, Indiana, Iowa, Kentucky, Maryland, Minnesota, Montana, Nebraska, New Hampshire, New Jersey, Oregon, Rhode Island, Tennessee, Texas, Utah, or Virginia, you may have the right to request access to and receive details about the personal information we maintain about you and how we have processed it, correct inaccuracies, get a copy of, or delete your personal information. You may also have the right to withdraw your consent to our processing of your personal information. These rights may be limited in some circumstances by applicable law. More information is provided below.'),
        sub('Categories of Personal Information We Collect'),
        p('The list below shows the categories of personal information we have collected in the past twelve (12) months, with illustrative examples of each category and whether we collect it. For a comprehensive inventory of all personal information we process, please refer to the section "What information do we collect?"'),
        b('A. Identifiers (contact details, such as real name, alias, postal address, telephone or mobile contact number, unique personal identifier, online identifier, Internet Protocol address, email address, and account name) — Collected: YES'),
        b('B. Personal information as defined in the California Customer Records statute (name, contact information, education, employment, employment history, and financial information) — Collected: YES'),
        b('C. Protected classification characteristics under state or federal law (gender, age, date of birth, race and ethnicity, national origin, marital status, and other demographic data) — Collected: NO'),
        b('D. Commercial information (transaction information, purchase history, financial details, and payment information) — Collected: NO'),
        b('E. Biometric information (fingerprints and voiceprints) — Collected: NO'),
        b('F. Internet or other similar network activity (browsing history, search history, online behavior, interest data, and interactions with our and other websites, applications, systems, and advertisements) — Collected: NO'),
        b('G. Geolocation data (device location) — Collected: NO'),
        b('H. Audio, electronic, sensory, or similar information (images and audio, video or call recordings created in connection with our business activities) — Collected: NO'),
        b('I. Professional or employment-related information (business contact details in order to provide you our Services at a business level or job title, work history, and professional qualifications if you apply for a job with us) — Collected: NO'),
        b('J. Education Information (student records and directory information) — Collected: NO'),
        b("K. Inferences drawn from collected personal information (inferences drawn from any of the collected personal information listed above to create a profile or summary about, for example, an individual's preferences and characteristics) — Collected: YES"),
        b('L. Sensitive personal information — Collected: NO'),
        p('We may also collect other personal information outside of these categories through instances where you interact with us in person, online, or by phone or mail in the context of:'),
        b('Receiving help through our customer support channels;'),
        b('Participation in customer surveys or contests; and'),
        b('Facilitation in the delivery of our Services and to respond to your inquiries.'),
        p('We will use and retain the collected personal information as needed to provide the Services or for:'),
        b('Category A — As long as the user has an account with us'),
        b('Category B — As long as the user has an account with us'),
        b('Category K — As long as the user has an account with us'),
        sub('Sources of Personal Information'),
        p('Learn more about the sources of personal information we collect in "What information do we collect?"'),
        sub('How We Use and Share Personal Information'),
        p('Learn more about how we use your personal information in the section, "How do we process your information?"'),
        p('Will your information be shared with anyone else?'),
        p('We may disclose your personal information with our service providers pursuant to a written contract between us and each service provider. Learn more about how we disclose personal information in the section, "When and with whom do we share your personal information?"'),
        p('We may use your personal information for our own business purposes, such as for undertaking internal research for technological development and demonstration. This is not considered to be "selling" of your personal information.'),
        p('We have not sold or shared any personal information to third parties for a business or commercial purpose in the preceding twelve (12) months. We have disclosed the following categories of personal information to third parties for a business or commercial purpose in the preceding twelve (12) months: the categories of third parties to whom we disclosed personal information for a business or commercial purpose can be found under "When and with whom do we share your personal information?"'),
        sub('Your Rights'),
        p('You have rights under certain US state data protection laws. However, these rights are not absolute, and in certain cases, we may decline your request as permitted by law. These rights include:'),
        b('Right to know whether or not we are processing your personal data'),
        b('Right to access your personal data'),
        b('Right to correct inaccuracies in your personal data'),
        b('Right to request the deletion of your personal data'),
        b('Right to obtain a copy of the personal data you previously shared with us'),
        b('Right to non-discrimination for exercising your rights'),
        b('Right to opt out of the processing of your personal data if it is used for targeted advertising (or sharing as defined under California\'s privacy law), the sale of personal data, or profiling in furtherance of decisions that produce legal or similarly significant effects ("profiling")'),
        p('Depending upon the state where you live, you may also have the following rights:'),
        b('Right to access the categories of personal data being processed (as permitted by applicable law, including the privacy law in Minnesota)'),
        b('Right to obtain a list of the categories of third parties to which we have disclosed personal data (as permitted by applicable law, including the privacy law in California, Delaware, and Maryland)'),
        b('Right to obtain a list of specific third parties to which we have disclosed personal data (as permitted by applicable law, including the privacy law in Minnesota and Oregon)'),
        b('Right to obtain a list of third parties to which we have sold personal data (as permitted by applicable law, including the privacy law in Connecticut)'),
        b('Right to review, understand, question, and depending on where you live, correct how personal data has been profiled (as permitted by applicable law, including the privacy law in Connecticut and Minnesota)'),
        b('Right to limit use and disclosure of sensitive personal data (as permitted by applicable law, including the privacy law in California)'),
        b('Right to opt out of the collection of sensitive data and personal data collected through the operation of a voice or facial recognition feature (as permitted by applicable law, including the privacy law in Florida)'),
        sub('How to Exercise Your Rights'),
        p(`To exercise these rights, you can contact us by emailing us at ${CONTACT_EMAIL}, or by referring to the contact details at the bottom of this document.`),
        p('Under certain US state data protection laws, you can designate an authorized agent to make a request on your behalf. We may deny a request from an authorized agent that does not submit proof that they have been validly authorized to act on your behalf in accordance with applicable laws.'),
        sub('Request Verification'),
        p('Upon receiving your request, we will need to verify your identity to determine you are the same person about whom we have the information in our system. We will only use personal information provided in your request to verify your identity or authority to make the request. However, if we cannot verify your identity from the information already maintained by us, we may request that you provide additional information for the purposes of verifying your identity and for security or fraud-prevention purposes.'),
        p('If you submit the request through an authorized agent, we may need to collect additional information to verify your identity before processing your request and the agent will need to provide a written and signed permission from you to submit such request on your behalf.'),
        sub('Appeals'),
        p(`Under certain US state data protection laws, if we decline to take action regarding your request, you may appeal our decision by emailing us at ${CONTACT_EMAIL}. We will inform you in writing of any action taken or not taken in response to the appeal, including a written explanation of the reasons for the decisions. If your appeal is denied, you may submit a complaint to your state attorney general.`),
        sub('California "Shine The Light" Law'),
        p('California Civil Code Section 1798.83, also known as the "Shine The Light" law, permits our users who are California residents to request and obtain from us, once a year and free of charge, information about categories of personal information (if any) we disclosed to third parties for direct marketing purposes and the names and addresses of all third parties with which we shared personal information in the immediately preceding calendar year. If you are a California resident and would like to make such a request, please submit your request in writing to us by using the contact details provided in the section "How can you contact us about this notice?"'),
      ],
    },
    {
      heading: '12. Do other regions have specific privacy rights?',
      blocks: [
        p('In Short: You may have additional rights based on the country you reside in.'),
        sub('Australia'),
        p("We collect and process your personal information under the obligations and conditions set by Australia's Privacy Act 1988 (Privacy Act)."),
        p('This Privacy Notice satisfies the notice requirements defined in the Privacy Act, in particular: what personal information we collect from you, from which sources, for which purposes, and other recipients of your personal information.'),
        p('If you do not wish to provide the personal information necessary to fulfill their applicable purpose, it may affect our ability to provide our services, in particular:'),
        b('offer you the products or services that you want'),
        b('respond to or help with your requests'),
        b('manage your account with us'),
        b('confirm your identity and protect your account'),
        p('At any time, you have the right to request access to or correction of your personal information. You can make such a request by contacting us by using the contact details provided in the section "How can you review, update, or delete the data we collect from you?"'),
        p('If you believe we are unlawfully processing your personal information, you have the right to submit a complaint about a breach of the Australian Privacy Principles to the Office of the Australian Information Commissioner.'),
      ],
    },
    {
      heading: '13. Do we make updates to this notice?',
      blocks: [
        p('In Short: Yes, we will update this notice as necessary to stay compliant with relevant laws.'),
        p('We may update this Privacy Notice from time to time. The updated version will be indicated by an updated "Revised" date at the top of this Privacy Notice. If we make material changes to this Privacy Notice, we may notify you either by prominently posting a notice of such changes or by directly sending you a notification. We encourage you to review this Privacy Notice frequently to be informed of how we are protecting your information.'),
      ],
    },
    {
      heading: '14. How can you contact us about this notice?',
      blocks: [
        p(`If you have questions or comments about this notice, you may email us at ${CONTACT_EMAIL} or contact us by post at:`),
        p(CONTACT_ADDRESS),
      ],
    },
    {
      heading: '15. How can you review, update, or delete the data we collect from you?',
      blocks: [
        p(`Based on the applicable laws of your country or state of residence in the US, you may have the right to request access to the personal information we collect from you, details about how we have processed it, correct inaccuracies, or delete your personal information. You may also have the right to withdraw your consent to our processing of your personal information. These rights may be limited in some circumstances by applicable law. To request to review, update, or delete your personal information, please email us at ${CONTACT_EMAIL}.`),
      ],
    },
  ],
};

const TERMS_OF_SERVICE = {
  title: 'Terms of Use',
  updated: 'Last updated June 26, 2026',
  sections: [
    {
      heading: 'Agreement to our legal terms',
      blocks: [
        p('We are Noeul ("Company," "we," "us," "our").'),
        p('We operate the Noeul mobile application, as well as any other related products and services that refer or link to these legal terms (the "Legal Terms") (collectively, the "Services").'),
        p(`You can contact us by email at ${CONTACT_EMAIL} or by mail to 64-16 Sincheon-daero 183beon-gil, Busanjin-gu, Busan 47262, South Korea.`),
        p('These Legal Terms constitute a legally binding agreement made between you, whether personally or on behalf of an entity ("you"), and Noeul, concerning your access to and use of the Services. You agree that by accessing the Services, you have read, understood, and agreed to be bound by all of these Legal Terms. IF YOU DO NOT AGREE WITH ALL OF THESE LEGAL TERMS, THEN YOU ARE EXPRESSLY PROHIBITED FROM USING THE SERVICES AND YOU MUST DISCONTINUE USE IMMEDIATELY.'),
        p('Supplemental terms and conditions or documents that may be posted on the Services from time to time are hereby expressly incorporated herein by reference. We reserve the right, in our sole discretion, to make changes or modifications to these Legal Terms at any time and for any reason. We will alert you about any changes by updating the "Last updated" date of these Legal Terms, and you waive any right to receive specific notice of each such change. It is your responsibility to periodically review these Legal Terms to stay informed of updates. You will be subject to, and will be deemed to have been made aware of and to have accepted, the changes in any revised Legal Terms by your continued use of the Services after the date such revised Legal Terms are posted.'),
        p('We recommend that you print a copy of these Legal Terms for your records.'),
      ],
    },
    {
      heading: '1. Our services',
      blocks: [
        p('The information provided when using the Services is not intended for distribution to or use by any person or entity in any jurisdiction or country where such distribution or use would be contrary to law or regulation or which would subject us to any registration requirement within such jurisdiction or country. Accordingly, those persons who choose to access the Services from other locations do so on their own initiative and are solely responsible for compliance with local laws, if and to the extent local laws are applicable.'),
      ],
    },
    {
      heading: '2. Intellectual property rights',
      blocks: [
        sub('Our intellectual property'),
        p('We are the owner or the licensee of all intellectual property rights in our Services, including all source code, databases, functionality, software, website designs, audio, video, text, photographs, and graphics in the Services (collectively, the "Content"), as well as the trademarks, service marks, and logos contained therein (the "Marks").'),
        p('Our Content and Marks are protected by copyright and trademark laws (and various other intellectual property rights and unfair competition laws) and treaties around the world.'),
        p('The Content and Marks are provided in or through the Services "AS IS" for your personal, non-commercial use or internal business purpose only.'),
        sub('Your use of our Services'),
        p('Subject to your compliance with these Legal Terms, including the "PROHIBITED ACTIVITIES" section below, we grant you a non-exclusive, non-transferable, revocable license to:'),
        b('access the Services; and'),
        b('download or print a copy of any portion of the Content to which you have properly gained access,'),
        p('solely for your personal, non-commercial use or internal business purpose.'),
        p('Except as set out in this section or elsewhere in our Legal Terms, no part of the Services and no Content or Marks may be copied, reproduced, aggregated, republished, uploaded, posted, publicly displayed, encoded, translated, transmitted, distributed, sold, licensed, or otherwise exploited for any commercial purpose whatsoever, without our express prior written permission.'),
        p(`If you wish to make any use of the Services, Content, or Marks other than as set out in this section or elsewhere in our Legal Terms, please address your request to: ${CONTACT_EMAIL}. If we ever grant you the permission to post, reproduce, or publicly display any part of our Services or Content, you must identify us as the owners or licensors of the Services, Content, or Marks and ensure that any copyright or proprietary notice appears or is visible on posting, reproducing, or displaying our Content.`),
        p('We reserve all rights not expressly granted to you in and to the Services, Content, and Marks.'),
        p('Any breach of these Intellectual Property Rights will constitute a material breach of our Legal Terms and your right to use our Services will terminate immediately.'),
        sub('Your submissions'),
        p('Please review this section and the "PROHIBITED ACTIVITIES" section carefully prior to using our Services to understand the (a) rights you give us and (b) obligations you have when you post or upload any content through the Services.'),
        p('Submissions: By directly sending us any question, comment, suggestion, idea, feedback, or other information about the Services ("Submissions"), you agree to assign to us all intellectual property rights in such Submission. You agree that we shall own this Submission and be entitled to its unrestricted use and dissemination for any lawful purpose, commercial or otherwise, without acknowledgment or compensation to you.'),
        p('You are responsible for what you post or upload: By sending us Submissions through any part of the Services you:'),
        b('confirm that you have read and agree with our "PROHIBITED ACTIVITIES" and will not post, send, publish, upload, or transmit through the Services any Submission that is illegal, harassing, hateful, harmful, defamatory, obscene, bullying, abusive, discriminatory, threatening to any person or group, sexually explicit, false, inaccurate, deceitful, or misleading;'),
        b('to the extent permissible by applicable law, waive any and all moral rights to any such Submission;'),
        b('warrant that any such Submission are original to you or that you have the necessary rights and licenses to submit such Submissions and that you have full authority to grant us the above-mentioned rights in relation to your Submissions; and'),
        b('warrant and represent that your Submissions do not constitute confidential information.'),
        p("You are solely responsible for your Submissions and you expressly agree to reimburse us for any and all losses that we may suffer because of your breach of (a) this section, (b) any third party's intellectual property rights, or (c) applicable law."),
      ],
    },
    {
      heading: '3. User representations',
      blocks: [
        p('By using the Services, you represent and warrant that: (1) you have the legal capacity and you agree to comply with these Legal Terms; (2) you are not a minor in the jurisdiction in which you reside; (3) you will not access the Services through automated or non-human means, whether through a bot, script or otherwise; (4) you will not use the Services for any illegal or unauthorized purpose; and (5) your use of the Services will not violate any applicable law or regulation.'),
        p('If you provide any information that is untrue, inaccurate, not current, or incomplete, we have the right to suspend or terminate your account and refuse any and all current or future use of the Services (or any portion thereof).'),
      ],
    },
    {
      heading: '4. Prohibited activities',
      blocks: [
        p('You may not access or use the Services for any purpose other than that for which we make the Services available. The Services may not be used in connection with any commercial endeavors except those that are specifically endorsed or approved by us.'),
        p('As a user of the Services, you agree not to:'),
        b('Systematically retrieve data or other content from the Services to create or compile, directly or indirectly, a collection, compilation, database, or directory without written permission from us.'),
        b('Trick, defraud, or mislead us and other users, especially in any attempt to learn sensitive account information such as user passwords.'),
        b('Circumvent, disable, or otherwise interfere with security-related features of the Services, including features that prevent or restrict the use or copying of any Content or enforce limitations on the use of the Services and/or the Content contained therein.'),
        b('Disparage, tarnish, or otherwise harm, in our opinion, us and/or the Services.'),
        b('Use any information obtained from the Services in order to harass, abuse, or harm another person.'),
        b('Make improper use of our support services or submit false reports of abuse or misconduct.'),
        b('Use the Services in a manner inconsistent with any applicable laws or regulations.'),
        b('Engage in unauthorized framing of or linking to the Services.'),
        b("Upload or transmit (or attempt to upload or to transmit) viruses, Trojan horses, or other material, including excessive use of capital letters and spamming (continuous posting of repetitive text), that interferes with any party's uninterrupted use and enjoyment of the Services or modifies, impairs, disrupts, alters, or interferes with the use, features, functions, operation, or maintenance of the Services."),
        b('Engage in any automated use of the system, such as using scripts to send comments or messages, or using any data mining, robots, or similar data gathering and extraction tools.'),
        b('Delete the copyright or other proprietary rights notice from any Content.'),
        b('Attempt to impersonate another user or person or use the username of another user.'),
        b('Upload or transmit (or attempt to upload or to transmit) any material that acts as a passive or active information collection or transmission mechanism, including without limitation, clear graphics interchange formats ("gifs"), 1×1 pixels, web bugs, cookies, or other similar devices (sometimes referred to as "spyware" or "passive collection mechanisms" or "pcms").'),
        b('Interfere with, disrupt, or create an undue burden on the Services or the networks or services connected to the Services.'),
        b('Harass, annoy, intimidate, or threaten any of our employees or agents engaged in providing any portion of the Services to you.'),
        b('Attempt to bypass any measures of the Services designed to prevent or restrict access to the Services, or any portion of the Services.'),
        b("Copy or adapt the Services' software, including but not limited to Flash, PHP, HTML, JavaScript, or other code."),
        b('Except as permitted by applicable law, decipher, decompile, disassemble, or reverse engineer any of the software comprising or in any way making up a part of the Services.'),
        b('Except as may be the result of standard search engine or Internet browser usage, use, launch, develop, or distribute any automated system, including without limitation, any spider, robot, cheat utility, scraper, or offline reader that accesses the Services, or use or launch any unauthorized script or other software.'),
        b('Use a buying agent or purchasing agent to make purchases on the Services.'),
        b('Make any unauthorized use of the Services, including collecting usernames and/or email addresses of users by electronic or other means for the purpose of sending unsolicited email, or creating user accounts by automated means or under false pretenses.'),
        b('Use the Services as part of any effort to compete with us or otherwise use the Services and/or the Content for any revenue-generating endeavor or commercial enterprise.'),
      ],
    },
    {
      heading: '5. User generated contributions',
      blocks: [
        p('We may provide you with the opportunity to create, submit, post, display, transmit, perform, publish, distribute, or broadcast content and materials to us or on the Services, including but not limited to text, writings, video, audio, photographs, graphics, comments, suggestions, or personal information or other material (collectively, "Contributions"). Contributions may be viewable by other users of the Services and through third-party websites. When you create or make available any Contributions, you thereby represent and warrant that:'),
        b('The creation, distribution, transmission, public display, or performance, and the accessing, downloading, or copying of your Contributions do not and will not infringe the proprietary rights, including but not limited to the copyright, patent, trademark, trade secret, or moral rights of any third party.'),
        b('You are the creator and owner of or have the necessary licenses, rights, consents, releases, and permissions to use and to authorize us, the Services, and other users of the Services to use your Contributions in any manner contemplated by the Services and these Legal Terms.'),
        b('Your Contributions are not false, inaccurate, or misleading.'),
        b('Your Contributions are not unsolicited or unauthorized advertising, promotional materials, pyramid schemes, chain letters, spam, mass mailings, or other forms of solicitation.'),
        b('Your Contributions are not obscene, lewd, lascivious, filthy, violent, harassing, libelous, slanderous, or otherwise objectionable (as determined by us).'),
        b('Your Contributions do not ridicule, mock, disparage, intimidate, or abuse anyone.'),
        b('Your Contributions are not used to harass or threaten (in the legal sense of those terms) any other person and to promote violence against a specific person or class of people.'),
        b('Your Contributions do not violate any applicable law, regulation, or rule.'),
        b('Your Contributions do not violate the privacy or publicity rights of any third party.'),
        b('Your Contributions do not violate any applicable law concerning child pornography, or otherwise intended to protect the health or well-being of minors.'),
        b('Your Contributions do not include any offensive comments that are connected to race, national origin, gender, sexual preference, or physical handicap.'),
        b('Your Contributions do not otherwise violate, or link to material that violates, any provision of these Legal Terms, or any applicable law or regulation.'),
        p('Any use of the Services in violation of the foregoing violates these Legal Terms and may result in, among other things, termination or suspension of your rights to use the Services.'),
      ],
    },
    {
      heading: '6. Contribution license',
      blocks: [
        p('You and Services agree that we may access, store, process, and use any information and personal data that you provide and your choices (including settings).'),
        p('By submitting suggestions or other feedback regarding the Services, you agree that we can use and share such feedback for any purpose without compensation to you.'),
        p('We do not assert any ownership over your Contributions. You retain full ownership of all of your Contributions and any intellectual property rights or other proprietary rights associated with your Contributions. We are not liable for any statements or representations in your Contributions provided by you in any area on the Services. You are solely responsible for your Contributions to the Services and you expressly agree to exonerate us from any and all responsibility and to refrain from any legal action against us regarding your Contributions.'),
      ],
    },
    {
      heading: '7. Services management',
      blocks: [
        p('We reserve the right, but not the obligation, to: (1) monitor the Services for violations of these Legal Terms; (2) take appropriate legal action against anyone who, in our sole discretion, violates the law or these Legal Terms, including without limitation, reporting such user to law enforcement authorities; (3) in our sole discretion and without limitation, refuse, restrict access to, limit the availability of, or disable (to the extent technologically feasible) any of your Contributions or any portion thereof; (4) in our sole discretion and without limitation, notice, or liability, to remove from the Services or otherwise disable all files and content that are excessive in size or are in any way burdensome to our systems; and (5) otherwise manage the Services in a manner designed to protect our rights and property and to facilitate the proper functioning of the Services.'),
      ],
    },
    {
      heading: '8. Term and termination',
      blocks: [
        p('These Legal Terms shall remain in full force and effect while you use the Services. WITHOUT LIMITING ANY OTHER PROVISION OF THESE LEGAL TERMS, WE RESERVE THE RIGHT TO, IN OUR SOLE DISCRETION AND WITHOUT NOTICE OR LIABILITY, DENY ACCESS TO AND USE OF THE SERVICES (INCLUDING BLOCKING CERTAIN IP ADDRESSES), TO ANY PERSON FOR ANY REASON OR FOR NO REASON, INCLUDING WITHOUT LIMITATION FOR BREACH OF ANY REPRESENTATION, WARRANTY, OR COVENANT CONTAINED IN THESE LEGAL TERMS OR OF ANY APPLICABLE LAW OR REGULATION. WE MAY TERMINATE YOUR USE OR PARTICIPATION IN THE SERVICES OR DELETE ANY CONTENT OR INFORMATION THAT YOU POSTED AT ANY TIME, WITHOUT WARNING, IN OUR SOLE DISCRETION.'),
        p('If we terminate or suspend your account for any reason, you are prohibited from registering and creating a new account under your name, a fake or borrowed name, or the name of any third party, even if you may be acting on behalf of the third party. In addition to terminating or suspending your account, we reserve the right to take appropriate legal action, including without limitation pursuing civil, criminal, and injunctive redress.'),
      ],
    },
    {
      heading: '9. Modifications and interruptions',
      blocks: [
        p('We reserve the right to change, modify, or remove the contents of the Services at any time or for any reason at our sole discretion without notice. However, we have no obligation to update any information on our Services. We will not be liable to you or any third party for any modification, price change, suspension, or discontinuance of the Services.'),
        p('We cannot guarantee the Services will be available at all times. We may experience hardware, software, or other problems or need to perform maintenance related to the Services, resulting in interruptions, delays, or errors. We reserve the right to change, revise, update, suspend, discontinue, or otherwise modify the Services at any time or for any reason without notice to you. You agree that we have no liability whatsoever for any loss, damage, or inconvenience caused by your inability to access or use the Services during any downtime or discontinuance of the Services. Nothing in these Legal Terms will be construed to obligate us to maintain and support the Services or to supply any corrections, updates, or releases in connection therewith.'),
      ],
    },
    {
      heading: '10. Governing law',
      blocks: [
        p('These Legal Terms shall be governed by and defined following the laws of South Korea. Noeul and yourself irrevocably consent that the courts of South Korea shall have exclusive jurisdiction to resolve any dispute which may arise in connection with these Legal Terms.'),
      ],
    },
    {
      heading: '11. Dispute resolution',
      blocks: [
        sub('Informal Negotiations'),
        p('To expedite resolution and control the cost of any dispute, controversy, or claim related to these Legal Terms (each a "Dispute" and collectively, the "Disputes") brought by either you or us (individually, a "Party" and collectively, the "Parties"), the Parties agree to first attempt to negotiate any Dispute (except those Disputes expressly provided below) informally for at least thirty (30) days before initiating arbitration. Such informal negotiations commence upon written notice from one Party to the other Party.'),
        sub('Binding Arbitration'),
        p('If the parties are unable to resolve the dispute through informal negotiation, the dispute shall be finally resolved by arbitration in accordance with the United Nations Commission on International Trade Law Arbitration Rules in force at the time of commencement of the arbitration. The number of arbitrators shall be one. The seat, or legal place, of arbitration shall be Busan, South Korea. The language of the proceedings shall be English. The governing law of these Legal Terms shall be substantive law of South Korea.'),
        sub('Restrictions'),
        p('The Parties agree that any arbitration shall be limited to the Dispute between the Parties individually. To the full extent permitted by law, (a) no arbitration shall be joined with any other proceeding; (b) there is no right or authority for any Dispute to be arbitrated on a class-action basis or to utilize class action procedures; and (c) there is no right or authority for any Dispute to be brought in a purported representative capacity on behalf of the general public or any other persons.'),
        sub('Exceptions to Informal Negotiations and Arbitration'),
        p('The Parties agree that the following Disputes are not subject to the above provisions concerning informal negotiations binding arbitration: (a) any Disputes seeking to enforce or protect, or concerning the validity of, any of the intellectual property rights of a Party; (b) any Dispute related to, or arising from, allegations of theft, piracy, invasion of privacy, or unauthorized use; and (c) any claim for injunctive relief. If this provision is found to be illegal or unenforceable, then neither Party will elect to arbitrate any Dispute falling within that portion of this provision found to be illegal or unenforceable and such Dispute shall be decided by a court of competent jurisdiction within the courts listed for jurisdiction above, and the Parties agree to submit to the personal jurisdiction of that court.'),
      ],
    },
    {
      heading: '12. Corrections',
      blocks: [
        p('There may be information on the Services that contains typographical errors, inaccuracies, or omissions, including descriptions, pricing, availability, and various other information. We reserve the right to correct any errors, inaccuracies, or omissions and to change or update the information on the Services at any time, without prior notice.'),
      ],
    },
    {
      heading: '13. Disclaimer',
      blocks: [
        p("THE SERVICES ARE PROVIDED ON AN AS-IS AND AS-AVAILABLE BASIS. YOU AGREE THAT YOUR USE OF THE SERVICES WILL BE AT YOUR SOLE RISK. TO THE FULLEST EXTENT PERMITTED BY LAW, WE DISCLAIM ALL WARRANTIES, EXPRESS OR IMPLIED, IN CONNECTION WITH THE SERVICES AND YOUR USE THEREOF, INCLUDING, WITHOUT LIMITATION, THE IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. WE MAKE NO WARRANTIES OR REPRESENTATIONS ABOUT THE ACCURACY OR COMPLETENESS OF THE SERVICES' CONTENT OR THE CONTENT OF ANY WEBSITES OR MOBILE APPLICATIONS LINKED TO THE SERVICES AND WE WILL ASSUME NO LIABILITY OR RESPONSIBILITY FOR ANY (1) ERRORS, MISTAKES, OR INACCURACIES OF CONTENT AND MATERIALS, (2) PERSONAL INJURY OR PROPERTY DAMAGE, OF ANY NATURE WHATSOEVER, RESULTING FROM YOUR ACCESS TO AND USE OF THE SERVICES, (3) ANY UNAUTHORIZED ACCESS TO OR USE OF OUR SECURE SERVERS AND/OR ANY AND ALL PERSONAL INFORMATION AND/OR FINANCIAL INFORMATION STORED THEREIN, (4) ANY INTERRUPTION OR CESSATION OF TRANSMISSION TO OR FROM THE SERVICES, (5) ANY BUGS, VIRUSES, TROJAN HORSES, OR THE LIKE WHICH MAY BE TRANSMITTED TO OR THROUGH THE SERVICES BY ANY THIRD PARTY, AND/OR (6) ANY ERRORS OR OMISSIONS IN ANY CONTENT AND MATERIALS OR FOR ANY LOSS OR DAMAGE OF ANY KIND INCURRED AS A RESULT OF THE USE OF ANY CONTENT POSTED, TRANSMITTED, OR OTHERWISE MADE AVAILABLE VIA THE SERVICES. WE DO NOT WARRANT, ENDORSE, GUARANTEE, OR ASSUME RESPONSIBILITY FOR ANY PRODUCT OR SERVICE ADVERTISED OR OFFERED BY A THIRD PARTY THROUGH THE SERVICES, ANY HYPERLINKED WEBSITE, OR ANY WEBSITE OR MOBILE APPLICATION FEATURED IN ANY BANNER OR OTHER ADVERTISING, AND WE WILL NOT BE A PARTY TO OR IN ANY WAY BE RESPONSIBLE FOR MONITORING ANY TRANSACTION BETWEEN YOU AND ANY THIRD-PARTY PROVIDERS OF PRODUCTS OR SERVICES. AS WITH THE PURCHASE OF A PRODUCT OR SERVICE THROUGH ANY MEDIUM OR IN ANY ENVIRONMENT, YOU SHOULD USE YOUR BEST JUDGMENT AND EXERCISE CAUTION WHERE APPROPRIATE."),
      ],
    },
    {
      heading: '14. Limitations of liability',
      blocks: [
        p('IN NO EVENT WILL WE OR OUR DIRECTORS, EMPLOYEES, OR AGENTS BE LIABLE TO YOU OR ANY THIRD PARTY FOR ANY DIRECT, INDIRECT, CONSEQUENTIAL, EXEMPLARY, INCIDENTAL, SPECIAL, OR PUNITIVE DAMAGES, INCLUDING LOST PROFIT, LOST REVENUE, LOSS OF DATA, OR OTHER DAMAGES ARISING FROM YOUR USE OF THE SERVICES, EVEN IF WE HAVE BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES. CERTAIN US STATE LAWS AND INTERNATIONAL LAWS DO NOT ALLOW LIMITATIONS ON IMPLIED WARRANTIES OR THE EXCLUSION OR LIMITATION OF CERTAIN DAMAGES. IF THESE LAWS APPLY TO YOU, SOME OR ALL OF THE ABOVE DISCLAIMERS OR LIMITATIONS MAY NOT APPLY TO YOU, AND YOU MAY HAVE ADDITIONAL RIGHTS.'),
      ],
    },
    {
      heading: '15. Indemnification',
      blocks: [
        p("You agree to defend, indemnify, and hold us harmless, including our subsidiaries, affiliates, and all of our respective officers, agents, partners, and employees, from and against any loss, damage, liability, claim, or demand, including reasonable attorneys' fees and expenses, made by any third party due to or arising out of: (1) use of the Services; (2) breach of these Legal Terms; (3) any breach of your representations and warranties set forth in these Legal Terms; (4) your violation of the rights of a third party, including but not limited to intellectual property rights; or (5) any overt harmful act toward any other user of the Services with whom you connected via the Services. Notwithstanding the foregoing, we reserve the right, at your expense, to assume the exclusive defense and control of any matter for which you are required to indemnify us, and you agree to cooperate, at your expense, with our defense of such claims. We will use reasonable efforts to notify you of any such claim, action, or proceeding which is subject to this indemnification upon becoming aware of it."),
      ],
    },
    {
      heading: '16. User data',
      blocks: [
        p('We will maintain certain data that you transmit to the Services for the purpose of managing the performance of the Services, as well as data relating to your use of the Services. Although we perform regular routine backups of data, you are solely responsible for all data that you transmit or that relates to any activity you have undertaken using the Services. You agree that we shall have no liability to you for any loss or corruption of any such data, and you hereby waive any right of action against us arising from any such loss or corruption of such data.'),
      ],
    },
    {
      heading: '17. Electronic communications, transactions, and signatures',
      blocks: [
        p('Visiting the Services, sending us emails, and completing online forms constitute electronic communications. You consent to receive electronic communications, and you agree that all agreements, notices, disclosures, and other communications we provide to you electronically, via email and on the Services, satisfy any legal requirement that such communication be in writing. YOU HEREBY AGREE TO THE USE OF ELECTRONIC SIGNATURES, CONTRACTS, ORDERS, AND OTHER RECORDS, AND TO ELECTRONIC DELIVERY OF NOTICES, POLICIES, AND RECORDS OF TRANSACTIONS INITIATED OR COMPLETED BY US OR VIA THE SERVICES. You hereby waive any rights or requirements under any statutes, regulations, rules, ordinances, or other laws in any jurisdiction which require an original signature or delivery or retention of non-electronic records, or to payments or the granting of credits by any means other than electronic means.'),
      ],
    },
    {
      heading: '18. Miscellaneous',
      blocks: [
        p('These Legal Terms and any policies or operating rules posted by us on the Services or in respect to the Services constitute the entire agreement and understanding between you and us. Our failure to exercise or enforce any right or provision of these Legal Terms shall not operate as a waiver of such right or provision. These Legal Terms operate to the fullest extent permissible by law. We may assign any or all of our rights and obligations to others at any time. We shall not be responsible or liable for any loss, damage, delay, or failure to act caused by any cause beyond our reasonable control. If any provision or part of a provision of these Legal Terms is determined to be unlawful, void, or unenforceable, that provision or part of the provision is deemed severable from these Legal Terms and does not affect the validity and enforceability of any remaining provisions. There is no joint venture, partnership, employment or agency relationship created between you and us as a result of these Legal Terms or use of the Services. You agree that these Legal Terms will not be construed against us by virtue of having drafted them. You hereby waive any and all defenses you may have based on the electronic form of these Legal Terms and the lack of signing by the parties hereto to execute these Legal Terms.'),
      ],
    },
    {
      heading: '19. Contact us',
      blocks: [
        p('In order to resolve a complaint regarding the Services or to receive further information regarding use of the Services, please contact us at:'),
        p(`${CONTACT_ADDRESS}\n${CONTACT_EMAIL}`),
      ],
    },
  ],
};

export const LEGAL_DOCS = {
  privacy: PRIVACY_POLICY,
  terms: TERMS_OF_SERVICE,
};
