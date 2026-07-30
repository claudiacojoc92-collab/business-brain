/**
 * Public legal pages served inside the Business Brain app (no auth): /privacy, /terms, /data-deletion.
 * Content is maintained here so it ships with the app. Styled with the Business Brain design tokens.
 * Operator: BLACKLINE SOLUTIONS S.R.L. (Romania). Contact: privacy@ / contact@getbusinessbrain.com.
 */
import React from 'react';
import { Link } from 'react-router-dom';

const page: React.CSSProperties = { minHeight: '100vh', background: 'var(--paper,#f7f4ee)', color: 'var(--ink,#26221c)', fontFamily: 'var(--sans, system-ui)' };
const inner: React.CSSProperties = { maxWidth: 720, margin: '0 auto', padding: '28px 20px 56px' };
const headerRow: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: 720, margin: '0 auto', padding: '16px 20px', borderBottom: '1px solid var(--line,#e2dccf)' };
const brand: React.CSSProperties = { fontFamily: 'var(--serif,Georgia)', fontSize: '1.05rem', fontWeight: 600, color: 'var(--ink)', textDecoration: 'none' };
const navLink: React.CSSProperties = { color: 'var(--ink-3,#8a8275)', textDecoration: 'none', fontSize: '0.85rem', marginLeft: 16 };
const h1: React.CSSProperties = { fontFamily: 'var(--serif,Georgia)', fontSize: '2rem', fontWeight: 500, letterSpacing: '-0.01em', margin: '8px 0 2px' };
const updated: React.CSSProperties = { color: 'var(--ink-3,#8a8275)', fontSize: '0.82rem', margin: '0 0 20px' };
const h2: React.CSSProperties = { fontFamily: 'var(--serif,Georgia)', fontSize: '1.2rem', fontWeight: 600, margin: '30px 0 8px', color: 'var(--ink)' };
const h3: React.CSSProperties = { fontSize: '0.92rem', fontWeight: 600, margin: '16px 0 4px', color: 'var(--ink-2,#4a443b)' };
const pStyle: React.CSSProperties = { fontSize: '0.95rem', lineHeight: 1.65, color: 'var(--ink-2,#4a443b)', margin: '0 0 12px' };
const liStyle: React.CSSProperties = { ...pStyle, margin: '0 0 10px' };
const aStyle: React.CSSProperties = { color: 'var(--gold,#b07d33)' };
const code: React.CSSProperties = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.82em', background: 'var(--paper-2,#f1ece3)', border: '1px solid var(--line,#e2dccf)', borderRadius: 5, padding: '1px 5px' };

const P = (props: { children: React.ReactNode }) => <p style={pStyle}>{props.children}</p>;
const H2 = (props: { children: React.ReactNode }) => <h2 style={h2}>{props.children}</h2>;
const H3 = (props: { children: React.ReactNode }) => <h3 style={h3}>{props.children}</h3>;
const A = (props: { to: string; children: React.ReactNode }) => <Link to={props.to} style={aStyle}>{props.children}</Link>;
const Mail = (props: { addr: string; subject?: string }) => (
  <a style={aStyle} href={`mailto:${props.addr}${props.subject ? `?subject=${encodeURIComponent(props.subject)}` : ''}`}>{props.addr}</a>
);
const C = (props: { children: React.ReactNode }) => <code style={code}>{props.children}</code>;

function LegalLayout(props: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div style={page}>
      <header style={headerRow}>
        <Link to="/" style={brand}>Business Brain</Link>
        <nav aria-label="Legal">
          <Link to="/privacy" style={navLink}>Privacy</Link>
          <Link to="/terms" style={navLink}>Terms</Link>
          <Link to="/data-deletion" style={navLink}>Data Deletion</Link>
        </nav>
      </header>
      <main style={inner}>
        <h1 style={h1}>{props.title}</h1>
        <p style={updated}>Business Brain · Last updated: {props.updated}</p>
        {props.children}
      </main>
      <footer style={{ borderTop: '1px solid var(--line,#e2dccf)', padding: '24px 20px', color: 'var(--ink-3,#8a8275)', fontSize: '0.8rem' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <p style={{ margin: '0 0 10px' }}><strong>Business Brain</strong> is developed and operated by <strong>BLACKLINE SOLUTIONS S.R.L.</strong>, a company registered in Romania.</p>
          <nav aria-label="Footer" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', margin: '0 0 10px' }}>
            <Link to="/privacy" style={aStyle}>Privacy Policy</Link>
            <Link to="/terms" style={aStyle}>Terms of Service</Link>
            <Link to="/data-deletion" style={aStyle}>Data Deletion</Link>
          </nav>
          <p style={{ margin: 0 }}>BLACKLINE SOLUTIONS S.R.L. · Romania · Romanian Tax Identification Number: 45154743 · © 2026</p>
        </div>
      </footer>
    </div>
  );
}

/**
 * Compact footer links for embedding at the bottom of in-app screens. Uses plain anchors (not
 * react-router <Link>) so it can render on any surface without a Router context; the nginx SPA
 * fallback serves these routes, and React Router renders the page on load.
 */
export function LegalFooter() {
  const s: React.CSSProperties = { textAlign: 'center', padding: '22px 16px', color: 'var(--ink-3,#8a8275)', fontSize: '0.8rem' };
  const l: React.CSSProperties = { color: 'var(--ink-3,#8a8275)', textDecoration: 'none', margin: '0 8px' };
  return (
    <div style={s}>
      <a href="/privacy" style={l}>Privacy</a>·
      <a href="/terms" style={l}>Terms</a>·
      <a href="/data-deletion" style={l}>Data Deletion</a>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy" updated="30 July 2026">
      <P>This Privacy Policy explains how <strong>BLACKLINE SOLUTIONS S.R.L.</strong> (“we”, “us”, “our”), a company registered in Romania and the operator of <strong>Business Brain</strong> (“the service”), handles information in connection with the Business Brain product. It applies to the product as offered, including when you connect a third-party account such as Instagram.</P>

      <H2>1. Who we are</H2>
      <P>The data controller is BLACKLINE SOLUTIONS S.R.L., registered in Romania (Romanian Tax Identification Number 45154743). You can reach us about privacy at <Mail addr="privacy@getbusinessbrain.com" />.</P>

      <H2>2. Information we collect</H2>
      <H3>Account and authentication data</H3>
      <P>When you create an account, we process the email address you use to sign in and the minimal records needed to operate your account and sessions.</P>
      <H3>Business data you connect</H3>
      <P>The product lets you voluntarily connect business sources so Business Brain can analyse them for you. This information is processed to produce your own analysis and is associated with your account. You choose what to connect, and you can disconnect at any time.</P>

      <H2>3. Instagram and Meta platform data</H2>
      <P>When you connect your Instagram professional (Business or Creator) account, and only with your explicit consent, the integration accesses your account on a <strong>read-only</strong> basis to produce an analysis of your own business. Under <C>instagram_business_basic</C> it reads your Instagram <strong>profile and account metadata</strong> (username, account type, follower count and media count) and your <strong>owned media</strong> — including each item’s media type, timestamp, permalink, <strong>caption</strong>, and engagement counts (likes and comments). Under <C>instagram_business_manage_insights</C> it reads <strong>account-level and per-media insights</strong> such as reach. If you additionally connect a Facebook Page, it reads the list of Pages you manage (<C>pages_show_list</C>), the selected Page’s audience data such as fan and follower counts (<C>pages_read_engagement</C>), and the linked Instagram account’s basic profile (<C>instagram_basic</C>).</P>
      <P>The integration does <strong>not</strong> post, publish, comment, send messages, or modify anything on your accounts. This information is used only to produce your own Business Brain analysis, and is processed by the providers described in “Service providers” below. You can disconnect at any time; see <A to="/data-deletion">Data Deletion</A>.</P>

      <H2>4. Why we process information</H2>
      <P>We process information to provide and operate the product, authenticate you and maintain your session, analyse the business data you connect and present that analysis to you, respond to enquiries, and keep the service secure. We rely on the legal bases of your consent, performance of our agreement with you, and our legitimate interests in operating and securing the service.</P>

      <H2>5. Data retention</H2>
      <P>We keep information for as long as your account is active or as needed to provide the service, and then for any period required to meet legal obligations. You can delete connected data at any time by disconnecting a source or deleting your account; see <A to="/data-deletion">Data Deletion</A>. On deletion we remove the associated data and revoke stored credentials.</P>

      <H2>6. Service providers</H2>
      <P>We rely on a small number of third-party providers that process data on our behalf, under our instructions and under confidentiality obligations. They may use the data only to provide their service to us; we do not sell your data or share it for advertising. For the Business Brain product, and for the Instagram data described above (your profile and account metadata, owned media, captions, and permitted insights), our providers are:</P>
      <ul style={{ margin: '0 0 12px', paddingLeft: 20 }}>
        <li style={liStyle}><strong>Railway (Railway Corp., United States)</strong> — cloud hosting and database infrastructure. Railway stores and processes the data we hold to operate the service: your account and session records, your <strong>encrypted</strong> access credentials, and the information imported from connected sources — for Instagram, your profile and account metadata, owned media (media type, timestamp, permalink), <strong>captions</strong>, engagement counts, and account-level and per-media insights — together with the Business Brain analysis generated from it.</li>
        <li style={liStyle}><strong>Anthropic (Anthropic, PBC, United States)</strong> — AI model processing used to generate your analysis. When you run a Business Brain, the imported Instagram content and metrics (owned-media metadata, <strong>captions</strong>, and insight-derived measures such as reach, likes and comments) are sent to Anthropic’s API to produce your business-language analysis. Your access credentials/tokens are <strong>never</strong> sent to Anthropic. Anthropic processes this input to return the result and, under its commercial terms, retains it only transiently for trust-and-safety purposes and does <strong>not</strong> use it to train its models.</li>
      </ul>
      <P>Both providers may process this data in the <strong>United States</strong>; see “International transfers” below.</P>

      <H2>7. Security</H2>
      <P>We take reasonable measures to protect information. Access credentials for connected services are encrypted at rest and are never displayed to you or shared. Access to systems is limited to what is necessary to operate the service. No method of transmission or storage is completely secure.</P>

      <H2>8. Your rights</H2>
      <P>Subject to applicable law (including the EU/Romanian GDPR), you may request access to your personal data, correction, deletion, restriction of or objection to processing, and portability, and you may withdraw consent at any time. To exercise these rights, email <Mail addr="privacy@getbusinessbrain.com" />. You also have the right to lodge a complaint with the Romanian supervisory authority (ANSPDCP).</P>

      <H2>9. Data export and deletion</H2>
      <P>You can disconnect a connected source in the product, which deletes the stored credential and revokes our access at the provider, or request deletion of your data by email. See <A to="/data-deletion">Data Deletion</A> for full instructions. We aim to complete deletion requests within 30 days and confirm by email.</P>

      <H2>10. International transfers</H2>
      <P>As an EU/Romanian data controller, we may transfer personal data to service providers located outside the European Economic Area — in particular to <strong>Railway (United States)</strong> and <strong>Anthropic (United States)</strong>, as described in “Service providers” above. Where we do, we rely on appropriate safeguards recognised under the EU/Romanian GDPR — in particular the European Commission’s <strong>Standard Contractual Clauses</strong> — together with the encryption and access-limitation measures described in “Security”. You can request more detail at <Mail addr="privacy@getbusinessbrain.com" />.</P>

      <H2>11. Children</H2>
      <P>The service is intended for founders and businesses and is not directed to children. We do not knowingly collect personal data from children.</P>

      <H2>12. Changes to this policy</H2>
      <P>We may update this policy from time to time; the “last updated” date above reflects the current version.</P>

      <H2>13. Contact</H2>
      <P>For privacy requests or questions, contact BLACKLINE SOLUTIONS S.R.L. at <Mail addr="privacy@getbusinessbrain.com" />.</P>
    </LegalLayout>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export function DataDeletionPage() {
  return (
    <LegalLayout title="Data Deletion Instructions" updated="30 July 2026">
      <P>You can delete the data that Business Brain holds about you — including any connected Meta (Facebook and Instagram) account — at any time, using either method below. Business Brain is operated by <strong>BLACKLINE SOLUTIONS S.R.L.</strong>, Romania.</P>

      <H2>How to delete your data</H2>
      <ol style={{ margin: '0 0 12px', paddingLeft: 20 }}>
        <li style={liStyle}><strong>Disconnect in the app.</strong> Open Business Brain and disconnect the relevant source or account, or delete your account. Disconnecting Instagram <strong>immediately deletes the stored Instagram access credential and revokes Business Brain’s access to your Instagram data at Meta</strong>, and stops any further import.</li>
        <li style={liStyle}><strong>Email us.</strong> Send a message to <Mail addr="privacy@getbusinessbrain.com" subject="Delete my data" /> with the subject “Delete my data”. We will delete the <strong>stored imported data and the Business Brain versions generated from it</strong>, and revoke the stored credential, within <strong>30 days</strong>, and confirm by email.</li>
      </ol>

      <H2>What gets deleted</H2>
      <P>For a connected service we store an encrypted access credential and the read-only information the granted permissions allow us to read, as described in our <A to="/privacy">Privacy Policy</A>. For a connected <strong>Instagram</strong> account this is your <strong>username and account metadata</strong> (account type, follower count, media count), your <strong>owned media</strong> (media type, timestamp, permalink), the <strong>captions</strong> of that media, <strong>account-level insights</strong>, and <strong>per-media insights such as reach, likes and comments</strong> — together with the <strong>Business Brain versions generated from that data</strong>. If you also connect a Facebook Page, it additionally covers your list of Pages and a Page’s fan/follower counts. Deleting removes the associated data and the generated Business Brain versions, and revokes the credential. We do not sell or share this data with anyone.</P>

      <H2>Contact</H2>
      <P>BLACKLINE SOLUTIONS S.R.L. — <Mail addr="privacy@getbusinessbrain.com" /></P>
    </LegalLayout>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export function TermsPage() {
  return (
    <LegalLayout title="Terms of Service" updated="30 July 2026">
      <P>These Terms govern your use of <strong>Business Brain</strong> (“the service”), operated by <strong>BLACKLINE SOLUTIONS S.R.L.</strong>, a company registered in Romania (“we”, “us”, “our”). By using the service you agree to these Terms. If you do not agree, do not use the service.</P>

      <H2>1. The service</H2>
      <P>Business Brain is a software product that helps founders build a grounded understanding of their business from evidence they choose to connect. Features may change, be limited, or be offered on a limited or invitation basis.</P>

      <H2>2. Accounts and your responsibilities</H2>
      <P>You are responsible for the accuracy of the information you provide, for maintaining the security of your sign-in, and for activity under your account. You may only connect accounts, sources, and data that you own or are authorized to manage, and you are responsible for complying with the terms of any third-party platform you connect.</P>

      <H2>3. Acceptable use</H2>
      <P>You agree not to misuse the service: no unlawful use, no attempts to disrupt or gain unauthorized access to the service or its systems, no uploading of content you have no right to provide, and no use that infringes the rights of others.</P>

      <H2>4. Connected third-party services</H2>
      <P>You may connect third-party services. We access only the information the permissions you grant allow, and only to provide the service to you. Your use of a third-party service remains subject to that provider’s own terms. You can disconnect at any time.</P>

      <H2>5. Your data and content</H2>
      <P>As between you and us, you retain ownership of the business data and content you connect. We do not claim ownership of it.</P>

      <H2>6. Licence to process your data</H2>
      <P>You grant us a limited, non-exclusive licence to access, store, and process the data you connect solely to operate the service and to produce the analysis presented to you. This licence exists only for as long as needed to provide the service and ends when you delete the data or your account, subject to any retention required by law.</P>

      <H2>7. Confidentiality</H2>
      <P>We treat the business data you connect as confidential and use it to provide the service to you, as described in our <A to="/privacy">Privacy Policy</A>. We do not sell it or share it for advertising.</P>

      <H2>8. Service availability</H2>
      <P>The service is provided on an “as available” basis. We do not guarantee that it will be uninterrupted, error-free, or available at any particular time, and we may modify or discontinue features.</P>

      <H2>9. Disclaimers and limitation of liability</H2>
      <P>The service is provided “as is” and “as available”, without warranties of any kind to the maximum extent permitted by law. Business Brain supports founders’ understanding and does not replace professional, legal, financial, or business advice; decisions you make remain your own. To the maximum extent permitted by law, we are not liable for indirect, incidental, or consequential damages arising from your use of the service. Nothing in these Terms limits liability that cannot be limited under applicable law.</P>

      <H2>10. Termination and data deletion</H2>
      <P>You may stop using the service and delete your account at any time. We may suspend or terminate access if these Terms are breached or to protect the service. On termination, you may request deletion of your data as described in our <A to="/data-deletion">Data Deletion</A> instructions.</P>

      <H2>11. Changes to these Terms</H2>
      <P>We may update these Terms from time to time; the “last updated” date above reflects the current version. Continued use after changes take effect constitutes acceptance.</P>

      <H2>12. Governing law</H2>
      <P>These Terms are governed by the laws of Romania, without regard to conflict-of-laws rules. The courts of Romania have jurisdiction, subject to any mandatory consumer protections available to you.</P>

      <H2>13. Contact</H2>
      <P>BLACKLINE SOLUTIONS S.R.L. — <Mail addr="contact@getbusinessbrain.com" /></P>
    </LegalLayout>
  );
}
