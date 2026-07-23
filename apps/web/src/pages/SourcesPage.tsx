import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getInstagramStatus, getInstagramConnectUrl, readInstagram, disconnectInstagram,
  getMetaStatus, getMetaConnectUrl, listMetaPages, readMetaPage, disconnectMeta,
  type InstagramRead, type MetaPagesList, type MetaPageRead,
} from '../api/client';

/**
 * Sources → Social accounts. The REAL, authenticated connect flows for App Review — no dev routes, no
 * mock data. Two clearly separated integrations:
 *   • Connect Instagram (Instagram Login): the founder's own account content + insights.
 *   • Connect Facebook Page (Facebook Login): Page selection, Page content/engagement, linked-IG discovery.
 * Every screen shows the real data, the exact Graph endpoints executed, and the permission status so a
 * reviewer can verify each permission without guessing.
 */
const wrap: React.CSSProperties = { minHeight: '100vh', background: 'var(--paper)', color: 'var(--ink)', padding: '40px 20px' };
const inner: React.CSSProperties = { maxWidth: 760, margin: '0 auto' };
const serif: React.CSSProperties = { fontFamily: 'var(--serif)' };
const muted: React.CSSProperties = { color: 'var(--ink-3)', fontSize: '0.82rem' };
const kicker: React.CSSProperties = { fontSize: '0.7rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--gold, var(--ink-3))', fontWeight: 600, margin: '20px 0 8px' };
const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--line-2)', borderRadius: 12, padding: '18px 20px', marginBottom: 14, boxShadow: 'var(--shadow-soft)' };
const btn: React.CSSProperties = { fontFamily: 'var(--sans)', fontWeight: 500, background: 'var(--ink)', color: 'var(--paper)', border: 'none', borderRadius: 10, padding: '10px 18px', cursor: 'pointer', marginRight: 10, marginBottom: 8, fontSize: '0.9rem' };
const btnGhost: React.CSSProperties = { ...btn, background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line-2)' };
const codeChip: React.CSSProperties = { fontFamily: 'var(--sans)', fontSize: '0.72rem', color: 'var(--ink-3)', background: 'var(--paper-2, rgba(0,0,0,0.04))', border: '1px solid var(--line)', borderRadius: 6, padding: '2px 7px', margin: '0 6px 6px 0', display: 'inline-block' };
const statBox: React.CSSProperties = { display: 'inline-block', marginRight: 22, marginBottom: 6 };
const num: React.CSSProperties = { ...serif, fontSize: '1.4rem', color: 'var(--ink)' };
const n = (v: number | null | undefined) => (typeof v === 'number' ? v.toLocaleString() : '—');

function Pill({ connected }: { connected: boolean | null }) {
  const label = connected == null ? '…' : connected ? 'Connected' : 'Not connected';
  const color = connected ? 'var(--ink-2)' : 'var(--gold, var(--ink-3))';
  return <span style={{ ...muted, color, border: '1px solid var(--line-2)', borderRadius: 20, padding: '2px 10px' }}>{label}</span>;
}
function PermStatus({ perms, connected }: { perms: string[]; connected: boolean }) {
  return (
    <>
      <div style={kicker}>Permission status</div>
      <div style={{ marginBottom: 14 }}>
        {perms.map((p) => (
          <span key={p} style={codeChip}>{connected ? '✓ ' : '• '}{p}</span>
        ))}
      </div>
    </>
  );
}
function Endpoints({ list }: { list: string[] }) {
  if (!list?.length) return null;
  return (
    <>
      <div style={kicker}>Graph endpoints executed (App Review proof)</div>
      <div style={{ marginBottom: 12 }}>{list.map((e, i) => <span key={i} style={codeChip}>{e}</span>)}</div>
    </>
  );
}

export function SourcesPage() {
  const params = new URLSearchParams(window.location.search);
  const justConnected = params.get('connected');       // 'instagram' | 'facebook' after OAuth callback
  const oauthError = params.get('error');

  return (
    <div style={wrap}>
      <div style={inner}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <div style={muted}><Link to="/dashboard" style={{ color: 'var(--ink-3)' }}>← Dashboard</Link></div>
        </div>
        <div style={kicker}>Sources</div>
        <h1 style={{ ...serif, fontSize: '1.7rem', fontWeight: 500, letterSpacing: '-0.01em', margin: '0 0 6px' }}>Social accounts</h1>
        <p style={{ ...muted, fontSize: '0.9rem', color: 'var(--ink-2)', margin: '0 0 8px', lineHeight: 1.5 }}>
          Connect your professional accounts so Business Brain can read your real content and performance. Instagram and Facebook are separate connections.
        </p>
        {oauthError && <div style={{ ...card, borderColor: 'var(--gold, #b8863b)', color: 'var(--ink-2)' }}>Connection error: {oauthError}</div>}

        <InstagramCard autoRead={justConnected === 'instagram'} />
        <FacebookCard autoConnected={justConnected === 'facebook'} />
      </div>
    </div>
  );
}

// ═══════════════════════ Instagram (Instagram Login) ═══════════════════════════
function InstagramCard({ autoRead }: { autoRead: boolean }) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [data, setData] = useState<InstagramRead | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try { setConnected(Boolean((await getInstagramStatus()).connected)); } catch { setConnected(false); }
  }, []);
  const read = useCallback(async () => {
    setBusy(true); setErr(null);
    try { const j = await readInstagram(); setData(j); if (!j.ok) setErr(j.error ?? 'read failed'); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  }, []);

  useEffect(() => { void (async () => { await refreshStatus(); if (autoRead) await read(); })(); }, [refreshStatus, read, autoRead]);

  const connect = async () => {
    const { authUrl, error } = await getInstagramConnectUrl();
    if (authUrl) window.location.href = authUrl; else setErr(error ?? 'could not start connection');
  };
  const disconnect = async () => { await disconnectInstagram(); setData(null); setConnected(false); };

  return (
    <div style={{ ...card, padding: '20px 22px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ ...serif, fontSize: '1.2rem' }}>Instagram</div><Pill connected={connected} />
      </div>
      <div style={{ ...muted, marginBottom: 14 }}>Instagram Login — your professional account’s content &amp; insights.</div>
      <div>
        <button style={btnGhost} onClick={() => void connect()}>{connected ? 'Reconnect Instagram' : 'Connect Instagram'}</button>
        {connected && <button style={btn} onClick={() => void read()} disabled={busy}>{busy ? 'Reading…' : 'Read Instagram data'}</button>}
        {connected && <button style={btnGhost} onClick={() => void disconnect()}>Disconnect</button>}
      </div>
      {err && <div style={{ ...muted, color: 'var(--gold, #b8863b)', margin: '10px 0' }}>error: {err}</div>}

      {data?.account && (
        <div style={{ marginTop: 8 }}>
          <div style={kicker}>Account · instagram_business_basic</div>
          <div style={card}>
            <div style={{ ...serif, fontSize: '1.2rem', marginBottom: 10 }}>@{data.account.username} <span style={muted}>· {data.account.accountType ?? 'business'}</span></div>
            <span style={statBox}><span style={num}>{n(data.account.followersCount)}</span><div style={muted}>followers</div></span>
            <span style={statBox}><span style={num}>{n(data.account.followsCount)}</span><div style={muted}>following</div></span>
            <span style={statBox}><span style={num}>{n(data.account.mediaCount)}</span><div style={muted}>media</div></span>
          </div>
          <div style={kicker}>Account insights · instagram_business_manage_insights</div>
          <div style={card}><span style={statBox}><span style={num}>{n(data.accountInsights?.reach)}</span><div style={muted}>reach (last day)</div></span></div>
          {data.recentMedia.length > 0 && <>
            <div style={kicker}>Recent posts {data.recentMedia[0]?.insights ? '· with per-post insights' : ''}</div>
            {data.recentMedia.map((m) => (
              <div key={m.id} style={card}>
                <div style={{ ...serif, fontSize: '0.98rem', marginBottom: 4 }}>{m.caption ? m.caption.slice(0, 100) : <span style={muted}>({m.mediaType.toLowerCase()}, no caption)</span>}</div>
                <div style={muted}>{m.mediaType} · {m.timestamp?.slice(0, 10)}</div>
                {m.insights && <div style={{ marginTop: 8 }}>
                  <span style={statBox}><span style={num}>{n(m.insights.reach)}</span><div style={muted}>reach</div></span>
                  <span style={statBox}><span style={num}>{n(m.insights.likes)}</span><div style={muted}>likes</div></span>
                  <span style={statBox}><span style={num}>{n(m.insights.comments)}</span><div style={muted}>comments</div></span>
                </div>}
              </div>
            ))}
          </>}
          <Endpoints list={data.endpointsCalled} />
          {data.notes.length > 0 && <div style={muted}>notes: {data.notes.join(' · ')}</div>}
        </div>
      )}
      <PermStatus perms={['instagram_business_basic', 'instagram_business_manage_insights']} connected={Boolean(connected)} />
    </div>
  );
}

// ═══════════════════════ Facebook Page (Facebook Login) ════════════════════════
function FacebookCard({ autoConnected }: { autoConnected: boolean }) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [pages, setPages] = useState<MetaPagesList | null>(null);
  const [selected, setSelected] = useState<MetaPageRead | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try { setConnected(Boolean((await getMetaStatus()).connected)); } catch { setConnected(false); }
  }, []);
  const loadPages = useCallback(async () => {
    setBusy(true); setErr(null);
    try { const j = await listMetaPages(); setPages(j); if (!j.ok) setErr(j.error ?? 'could not list pages'); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  }, []);

  useEffect(() => { void (async () => { await refreshStatus(); if (autoConnected) await loadPages(); })(); }, [refreshStatus, loadPages, autoConnected]);

  const connect = async () => {
    const { authUrl, error } = await getMetaConnectUrl();
    if (authUrl) window.location.href = authUrl; else setErr(error ?? 'could not start connection');
  };
  const usePage = async (pageId: string) => {
    setBusy(true); setErr(null);
    try { const j = await readMetaPage(pageId); setSelected(j); if (!j.ok) setErr(j.error ?? 'could not read page'); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };
  const disconnect = async () => { await disconnectMeta(); setPages(null); setSelected(null); setConnected(false); };

  return (
    <div style={{ ...card, padding: '20px 22px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ ...serif, fontSize: '1.2rem' }}>Facebook Page</div><Pill connected={connected} />
      </div>
      <div style={{ ...muted, marginBottom: 14 }}>Facebook Login — select a Page, read its content &amp; engagement, and discover its linked Instagram account.</div>
      <div>
        <button style={btnGhost} onClick={() => void connect()}>{connected ? 'Reconnect Meta' : 'Connect Facebook Page'}</button>
        {connected && <button style={btn} onClick={() => void loadPages()} disabled={busy}>{busy ? 'Loading…' : 'Load my Pages'}</button>}
        {connected && <button style={btnGhost} onClick={() => void disconnect()}>Disconnect</button>}
      </div>
      {err && <div style={{ ...muted, color: 'var(--gold, #b8863b)', margin: '10px 0' }}>error: {err}</div>}

      {pages?.pages && pages.pages.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={kicker}>Your Pages · pages_show_list</div>
          {pages.pages.map((p) => (
            <div key={p.id} style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ ...serif, fontSize: '1rem' }}>{p.name}</div>
                <div style={muted}>{p.hasInstagram ? 'has a linked Instagram account' : 'no linked Instagram'} · id {p.id}</div>
              </div>
              <button style={btn} onClick={() => void usePage(p.id)} disabled={busy}>Use this Page</button>
            </div>
          ))}
          <Endpoints list={pages.endpointsCalled} />
        </div>
      )}
      {pages?.pages && pages.pages.length === 0 && <div style={{ ...muted, marginTop: 8 }}>No Pages found on this account.</div>}

      {selected?.page && (
        <div style={{ marginTop: 8 }}>
          <div style={kicker}>Selected Page · pages_read_engagement</div>
          <div style={card}>
            <div style={{ ...serif, fontSize: '1.2rem', marginBottom: 4 }}>{selected.page.name} <span style={muted}>· {selected.page.category ?? 'Page'}</span></div>
            <span style={statBox}><span style={num}>{n(selected.page.fanCount)}</span><div style={muted}>likes (fans)</div></span>
            <span style={statBox}><span style={num}>{n(selected.page.followersCount)}</span><div style={muted}>followers</div></span>
          </div>
          <div style={kicker}>Page content · pages_read_engagement</div>
          {selected.posts.length > 0 ? selected.posts.map((p) => (
            <div key={p.id} style={card}>
              <div style={{ ...serif, fontSize: '0.98rem', marginBottom: 4 }}>{p.message ? p.message.slice(0, 120) : <span style={muted}>(no text)</span>}</div>
              <div style={muted}>{p.createdTime?.slice(0, 10)}</div>
              <div style={{ marginTop: 8 }}>
                <span style={statBox}><span style={num}>{n(p.likes)}</span><div style={muted}>likes</div></span>
                <span style={statBox}><span style={num}>{n(p.comments)}</span><div style={muted}>comments</div></span>
              </div>
            </div>
          )) : <div style={{ ...muted, marginBottom: 12 }}>No recent posts on this Page.</div>}
          <div style={kicker}>Linked Instagram · instagram_basic</div>
          <div style={card}>
            {selected.instagram
              ? <><div style={{ ...serif, fontSize: '1.1rem', marginBottom: 8 }}>@{selected.instagram.username}</div>
                  <span style={statBox}><span style={num}>{n(selected.instagram.followers)}</span><div style={muted}>followers</div></span>
                  <span style={statBox}><span style={num}>{n(selected.instagram.mediaCount)}</span><div style={muted}>media</div></span></>
              : <div style={muted}>No Instagram professional account is linked to this Page.</div>}
          </div>
          <Endpoints list={selected.endpointsCalled} />
          {selected.notes.length > 0 && <div style={muted}>notes: {selected.notes.join(' · ')}</div>}
        </div>
      )}
      <PermStatus perms={['pages_show_list', 'pages_read_engagement', 'instagram_basic']} connected={Boolean(connected)} />
    </div>
  );
}
