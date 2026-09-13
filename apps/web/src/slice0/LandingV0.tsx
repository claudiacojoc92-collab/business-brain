import { useEffect } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useSession } from './session';

/**
 * Business Brain — Public Landing V0.
 *
 * A real production public surface with PROVISIONAL copy (expected to change after founder validation).
 * Three jobs only: help a founder judge relevance, provide a credible surface for direct recruitment, and
 * give a curious visitor an honest first impression. It is NOT traction proof, final positioning, an
 * investor deck, or an SEO project. Frozen BB visual identity (Nocturne / warm charcoal, clay as the one
 * accent, Hanken). Semantic DOM, real h1, sequential headings, core copy as text — never image-only.
 *
 * The two product panels below are FAITHFUL previews of the real Strategy and Today UI grammar with
 * representative content — they are not presented as live screenshots of a specific account.
 */
const JSONLD = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Business Brain',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  description:
    'Business Brain learns a founder-led business, helps the founder commit to one marketing bet, and keeps that decision in front of the work until it changes for a reason.',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  publisher: { '@type': 'Organization', name: 'Business Brain', url: 'https://app.getbusinessbrain.com' },
};

export function LandingV0() {
  const { account, isLoading } = useSession();

  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'Business Brain — decide what your marketing should do next';
    const meta = document.querySelector('meta[name="description"]') ?? (() => {
      const m = document.createElement('meta');
      m.setAttribute('name', 'description');
      document.head.appendChild(m);
      return m;
    })();
    const prevDesc = meta.getAttribute('content');
    meta.setAttribute('content', 'Business Brain learns your business, helps you commit to one marketing bet, and turns that decision into the next thing worth doing. No website required.');
    return () => { document.title = prevTitle; if (prevDesc) meta.setAttribute('content', prevDesc); };
  }, []);

  if (isLoading) return <div className="s0-loading">Loading…</div>;
  if (account) return <Navigate to="/home" replace />;

  return (
    <div className="s0-lp">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSONLD) }} />

      <header className="s0-lp-head">
        <span className="s0-brand">Business <span className="s0-brand-mark">Brain</span></span>
        <Link to="/signin" className="s0-btn s0-lp-navcta">Start with your business</Link>
      </header>

      <main className="s0-lp-main">
        <section className="s0-lp-hero">
          <p className="s0-eyebrow">Business Brain</p>
          <h1 className="s0-lp-h1">Decide what your marketing should do next. Then actually do that.</h1>
          <p className="s0-lp-lede">
            Business Brain learns your business, helps you commit to one marketing bet, and keeps that
            decision in front of the work — until it changes for a reason. Marketing starts with a decision.
          </p>
          <Link to="/signin" className="s0-btn s0-lp-cta">Start with your business →</Link>
          <p className="s0-lp-nowebsite">No website? If you market through Instagram or can describe your
            business in your own words, you can still start.</p>
        </section>

        <section className="s0-lp-sec">
          <h2 className="s0-lp-h2">Who it’s for</h2>
          <p>Founder-led businesses already trying to market themselves — where the founder is carrying the
            strategic marketing decisions without a dedicated strategist. If you’re operating a real business
            and marketing keeps eating your attention, this is for you. It is not a “generate me posts” tool,
            and it’s not for an idea with no business behind it yet.</p>
        </section>

        <section className="s0-lp-sec">
          <h2 className="s0-lp-h2">The problem</h2>
          <p>You’re doing marketing, but the direction keeps changing. A new idea, a bad week, one customer
            comment — and the plan resets. The last decision, and the reason behind it, don’t get held
            anywhere, so you keep restarting instead of compounding.</p>
        </section>

        <section className="s0-lp-sec">
          <h2 className="s0-lp-h2">How it works</h2>
          <ol className="s0-lp-steps">
            <li><span className="s0-lp-step-k">Business</span><p>Business Brain gets to know your business and
              shows you what it understands — and what it doesn’t yet.</p></li>
            <li><span className="s0-lp-step-k">Strategy</span><p>It helps you make one marketing choice and
              name the trade-off — the bet you’re making, and what you’re setting aside.</p></li>
            <li><span className="s0-lp-step-k">Today</span><p>It turns that decision into the next thing worth
              doing, so the strategy stays in front of the work.</p></li>
            <li><span className="s0-lp-step-k">Create</span><p>When a move is worth turning into an asset,
              Business Brain can make it — grounded in the decision, not invented to fill space.</p></li>
          </ol>
        </section>

        <section className="s0-lp-sec">
          <h2 className="s0-lp-h2">Why it’s different</h2>
          <p>Most tools start by asking what you want to post. Business Brain starts by understanding what your
            business is trying to win — and keeps that decision in front of every move.</p>
        </section>

        <section className="s0-lp-sec">
          <h2 className="s0-lp-h2">See it</h2>
          <div className="s0-lp-shots">
            <figure className="s0-lp-shot">
              <div className="s0-lp-shot-ui">
                <div className="s0-lp-prov">Because we’re holding <span className="em">win trust with proof of client outcomes</span></div>
                <div className="s0-lp-k">The bet</div>
                <p className="s0-lp-move">Win consulting clients by publishing concrete client outcomes.</p>
                <p className="s0-lp-line"><span>Choosing</span> warm referral outreach <span>over</span> cold inbound content</p>
                <p className="s0-lp-line"><span>Not now</span> broad follower growth — it doesn’t move retainers in 6 months</p>
                <p className="s0-lp-line"><span>Reconsider if</span> 15 conversations produce no interest</p>
              </div>
              <figcaption>Strategy — the bet, the trade-off, and what would make you rethink it.</figcaption>
            </figure>
            <figure className="s0-lp-shot">
              <div className="s0-lp-shot-ui">
                <div className="s0-lp-prov">Because we’re holding <span className="em">win trust with proof of client outcomes</span></div>
                <div className="s0-lp-k">Do this now</div>
                <p className="s0-lp-move">Write up a recent client outcome as a short proof piece.</p>
                <p className="s0-lp-line"><span>Why now</span> proof is the bet — this is the first move that executes it</p>
                <p className="s0-lp-line"><span>Done when</span> one proof piece is drafted</p>
              </div>
              <figcaption>Today — the next move, with a clear line back to the strategy.</figcaption>
            </figure>
          </div>
        </section>

        <section className="s0-lp-sec">
          <h2 className="s0-lp-h2">What it doesn’t do yet</h2>
          <p>So you know exactly what you’re getting: Business Brain does not publish or schedule for you, does
            not learn from your results yet, has no trend engine, and does not replace a marketing team. It’s a
            marketing decision system for founders — not a business operating system, and not Sales, Finance,
            Product, or Ops.</p>
        </section>

        <section className="s0-lp-final">
          <h2 className="s0-lp-h2">Start with your business</h2>
          <p>Point Business Brain at your website, or just tell it about your business. It will show you what it
            understands, then help you decide what to do next.</p>
          <Link to="/signin" className="s0-btn s0-lp-cta">Start with your business →</Link>
        </section>
      </main>

      <footer className="s0-lp-foot">
        <span>Business Brain</span>
        <nav className="s0-lp-footnav" aria-label="Legal">
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
          <Link to="/contact">Contact</Link>
        </nav>
      </footer>
    </div>
  );
}
