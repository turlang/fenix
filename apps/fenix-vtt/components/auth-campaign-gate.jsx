'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createFenixApiClient } from '../lib/fenix-api-client.js';
import { FenixSessionProvider } from './session-provider.jsx';
import { VttShell } from './vtt-shell.jsx';

function readInviteToken() {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash.replace(/^#/, '');
  const params = new URLSearchParams(hash);
  return params.get('invite');
}

function message(error) {
  return error?.code ? `${error.code}: ${error.message}` : error?.message || 'Falha inesperada.';
}

export function AuthCampaignGate() {
  const client = useMemo(() => createFenixApiClient(), []);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [bootstrapRequired, setBootstrapRequired] = useState(false);
  const [user, setUser] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [inviteToken, setInviteToken] = useState(null);
  const [inviteInfo, setInviteInfo] = useState(null);
  const [mode, setMode] = useState('login');

  const refreshAccount = useCallback(async () => {
    const me = await client.me();
    setUser(me.user);
    setCampaigns(me.campaigns ?? []);
    return me;
  }, [client]);

  useEffect(() => {
    let active = true;
    const token = readInviteToken();
    setInviteToken(token);
    Promise.allSettled([
      client.authStatus(),
      token ? client.inspectInvite(token) : Promise.resolve(null)
    ]).then(async ([authResult, inviteResult]) => {
      if (!active) return;
      if (authResult.status === 'fulfilled') setBootstrapRequired(Boolean(authResult.value.bootstrapRequired));
      if (inviteResult.status === 'fulfilled' && inviteResult.value) setInviteInfo(inviteResult.value.invite);
      if (authResult.status === 'fulfilled' && !authResult.value.bootstrapRequired) {
        try {
          await refreshAccount();
        } catch {
          setUser(null);
        }
      }
      setLoading(false);
    }).catch((cause) => {
      if (active) {
        setError(message(cause));
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [client, refreshAccount]);

  async function withBusy(operation) {
    setBusy(true);
    setError(null);
    try {
      return await operation();
    } catch (cause) {
      setError(message(cause));
      throw cause;
    } finally {
      setBusy(false);
    }
  }

  async function handleBootstrap(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await withBusy(() => client.bootstrap({
        displayName: form.get('displayName'),
        email: form.get('email'),
        password: form.get('password')
      }));
      setBootstrapRequired(false);
      await refreshAccount();
    } catch {
      // estado de erro já atualizado
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await withBusy(() => client.login({ email: form.get('email'), password: form.get('password') }));
      await refreshAccount();
    } catch {
      // estado de erro já atualizado
    }
  }

  async function handleInviteRegistration(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const result = await withBusy(() => client.registerInvite({
        token: inviteToken,
        displayName: form.get('displayName'),
        email: form.get('email'),
        password: form.get('password')
      }));
      setUser(result.user);
      setCampaigns([result.campaign]);
      setSelectedCampaign(result.campaign);
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      setInviteToken(null);
      setInviteInfo(null);
    } catch {
      // estado de erro já atualizado
    }
  }

  async function acceptInvite() {
    try {
      const result = await withBusy(() => client.acceptInvite(inviteToken));
      const me = await refreshAccount();
      const accepted = me.campaigns.find((campaign) => campaign.id === result.campaign.id) ?? result.campaign;
      setSelectedCampaign(accepted);
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      setInviteToken(null);
      setInviteInfo(null);
    } catch {
      // estado de erro já atualizado
    }
  }

  async function handleCreateCampaign(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const result = await withBusy(() => client.createCampaign({ title: form.get('title') }));
      setCampaigns((current) => [...current, result.campaign]);
      setSelectedCampaign(result.campaign);
    } catch {
      // estado de erro já atualizado
    }
  }

  async function logout() {
    try {
      await withBusy(() => client.logout());
    } finally {
      setUser(null);
      setCampaigns([]);
      setSelectedCampaign(null);
      setMode('login');
    }
  }

  if (loading) {
    return <main className="entry-shell"><div className="entry-card"><span className="brand-mark">F</span><p>Carregando Fênix…</p></div></main>;
  }

  if (selectedCampaign && user) {
    return (
      <FenixSessionProvider campaign={selectedCampaign} currentUser={user}>
        <VttShell onExitCampaign={() => setSelectedCampaign(null)} onLogout={logout} />
      </FenixSessionProvider>
    );
  }

  if (bootstrapRequired) {
    return (
      <EntryLayout title="Ativar primeiro Mestre" subtitle="O primeiro cadastro se torna proprietário inicial do Fênix.">
        <form className="entry-form" onSubmit={handleBootstrap}>
          <label>Nome<input name="displayName" minLength={2} maxLength={100} required /></label>
          <label>E-mail<input name="email" type="email" required /></label>
          <label>Senha<input name="password" type="password" minLength={10} maxLength={200} required /></label>
          <button className="primary-button" disabled={busy}>{busy ? 'Criando…' : 'Criar conta do Mestre'}</button>
        </form>
        <ErrorNotice error={error} />
      </EntryLayout>
    );
  }

  if (!user) {
    const registerInvite = Boolean(inviteInfo && mode === 'register');
    return (
      <EntryLayout
        title={inviteInfo ? `Convite · ${inviteInfo.campaignTitle}` : 'Entrar no Fênix'}
        subtitle={inviteInfo ? `Personagem reservado: ${inviteInfo.actorId}` : 'Sua identidade passa a controlar permissões, campanhas e tokens.'}
      >
        {inviteInfo ? (
          <div className="entry-tabs">
            <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Já tenho conta</button>
            <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Criar conta</button>
          </div>
        ) : null}
        {registerInvite ? (
          <form className="entry-form" onSubmit={handleInviteRegistration}>
            <label>Nome<input name="displayName" required minLength={2} /></label>
            <label>E-mail<input name="email" type="email" required /></label>
            <label>Senha<input name="password" type="password" minLength={10} required /></label>
            <button className="primary-button" disabled={busy}>{busy ? 'Entrando…' : 'Criar conta e aceitar convite'}</button>
          </form>
        ) : (
          <form className="entry-form" onSubmit={handleLogin}>
            <label>E-mail<input name="email" type="email" required /></label>
            <label>Senha<input name="password" type="password" required /></label>
            <button className="primary-button" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
          </form>
        )}
        <ErrorNotice error={error} />
      </EntryLayout>
    );
  }

  return (
    <EntryLayout title={`Olá, ${user.displayName}`} subtitle="Escolha uma campanha persistente ou crie uma nova mesa.">
      {inviteInfo ? (
        <div className="invite-banner">
          <div><span className="eyebrow">Convite pendente</span><strong>{inviteInfo.campaignTitle}</strong><small>{inviteInfo.actorId}</small></div>
          <button type="button" className="primary-button" disabled={busy} onClick={acceptInvite}>Aceitar convite</button>
        </div>
      ) : null}
      <div className="campaign-grid">
        {campaigns.map((campaign) => (
          <button key={campaign.id} type="button" className="campaign-card" onClick={() => setSelectedCampaign(campaign)}>
            <span className="eyebrow">{campaign.membership?.role === 'gm' ? 'Mestre' : 'Jogador'}</span>
            <strong>{campaign.title}</strong>
            <small>{campaign.activeSession ? 'Sessão recuperável' : 'Sem sessão ativa'}</small>
          </button>
        ))}
      </div>
      <form className="entry-form compact" onSubmit={handleCreateCampaign}>
        <label>Nova campanha<input name="title" placeholder="Ex.: Ecos de Amn" minLength={3} required /></label>
        <button className="ghost-button" disabled={busy}>Criar campanha</button>
      </form>
      <button type="button" className="entry-logout" onClick={logout}>Sair da conta</button>
      <ErrorNotice error={error} />
    </EntryLayout>
  );
}

function EntryLayout({ title, subtitle, children }) {
  return (
    <main className="entry-shell">
      <section className="entry-card">
        <div className="entry-brand"><span className="brand-mark">F</span><span className="eyebrow">Projeto Fênix</span></div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
        {children}
      </section>
    </main>
  );
}

function ErrorNotice({ error }) {
  return error ? <div className="engine-error" role="alert"><span>{error}</span></div> : null;
}
