/**
 * Library — the shared, curated collection of tracks anyone can play.
 *
 * One curator uploads; everybody listens. Reads are open to the world, writes
 * are restricted to an admin allow-list enforced by row level security in the
 * database, not by anything in this file. Nothing here can grant itself
 * permission: the key below is the public anon key, which is designed to be
 * published, and every write it attempts is checked server-side against
 * `wave_admins`. If you are not on that list the insert simply fails.
 *
 * No SDK. This project has no build step and no dependencies, and the whole of
 * Supabase that we need — PostgREST, Storage and GoTrue — is plain HTTP. Adding
 * a bundler to save a few lines of fetch would be a bad trade.
 */

const URL_BASE = 'https://icacxjylkwpqouznrlau.supabase.co';
const ANON_KEY = 'sb_publishable_PESoBakp-ixj6h4AIIBVeA_Km40WftA';
const BUCKET = 'wave-library';
const SESSION_KEY = 'wave.session';

const j = (r) => r.json();

export class Library {
  constructor() {
    this.session = null;
    this.admin = false;
    this._restore();
  }

  // ---- session ------------------------------------------------------------

  _restore() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) this.session = JSON.parse(raw);
    } catch (e) { /* private mode; signed out is a fine default */ }
  }

  _store(s) {
    this.session = s;
    try {
      if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else localStorage.removeItem(SESSION_KEY);
    } catch (e) { /* nothing to do */ }
  }

  get signedIn() { return !!(this.session && this.session.access_token); }
  get email() { return this.session && this.session.user && this.session.user.email; }

  _headers(extra) {
    const h = Object.assign({ apikey: ANON_KEY }, extra || {});
    h.Authorization = 'Bearer ' + (this.signedIn ? this.session.access_token : ANON_KEY);
    return h;
  }

  /**
   * A magic link rather than a password: nothing to store, nothing to leak, and
   * no password field on a page that is otherwise entirely public.
   */
  async sendMagicLink(email) {
    const redirect = location.origin + location.pathname + '?admin';
    const res = await fetch(URL_BASE + '/auth/v1/otp', {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      // Anyone may create an account; an account grants nothing on its own.
      // Authorisation is the server-side allow-list, checked by every policy.
      body: JSON.stringify({ email, create_user: true, options: { email_redirect_to: redirect } }),
    });
    if (!res.ok) throw new Error((await j(res).catch(() => ({}))).msg || 'could not send the link');
    return true;
  }

  /** GoTrue returns the session in the URL fragment; take it and tidy up. */
  captureSessionFromUrl() {
    if (!location.hash || location.hash.indexOf('access_token') < 0) return false;
    const p = new URLSearchParams(location.hash.slice(1));
    const access_token = p.get('access_token');
    if (!access_token) return false;
    this._store({
      access_token,
      refresh_token: p.get('refresh_token'),
      expires_at: Date.now() + (parseInt(p.get('expires_in'), 10) || 3600) * 1000,
      user: null,
    });
    history.replaceState(null, '', location.pathname + '?admin');
    return true;
  }

  /**
   * Take a sign-in link that landed somewhere useless.
   *
   * Supabase validates `email_redirect_to` against an allow-list and silently
   * falls back to the project's Site URL when it does not match — which on a
   * default project is http://localhost:3000, a page that does not exist. The
   * emailed token is perfectly valid; only the address it was pointed at is
   * wrong. So rather than making a dashboard setting a prerequisite for signing
   * in at all, accept the link itself.
   *
   * Two shapes arrive: one that already carries the session in its fragment,
   * and one that still has to be redeemed.
   */
  async useLink(raw) {
    const text = String(raw || '').trim();
    if (!text) throw new Error('paste the link first');

    // Shape 1: the redirect already happened, tokens are in the fragment.
    const frag = text.indexOf('#');
    if (frag >= 0) {
      const p = new URLSearchParams(text.slice(frag + 1));
      const access_token = p.get('access_token');
      if (access_token) {
        this._store({
          access_token,
          refresh_token: p.get('refresh_token'),
          expires_at: Date.now() + (parseInt(p.get('expires_in'), 10) || 3600) * 1000,
          user: null,
        });
        return true;
      }
    }

    // Shape 2: an unredeemed /auth/v1/verify link. Redeem it over the API
    // instead of following it, so the broken redirect is never involved.
    let token = null, type = 'magiclink';
    try {
      const u = new URL(text);
      token = u.searchParams.get('token_hash') || u.searchParams.get('token');
      type = u.searchParams.get('type') || 'magiclink';
    } catch (e) {
      token = /^[A-Za-z0-9_-]{16,}$/.test(text) ? text : null;   // a bare token
    }
    if (!token) throw new Error('that does not look like a sign-in link');

    const res = await fetch(URL_BASE + '/auth/v1/verify', {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, token_hash: token }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error('link rejected — it may have expired. ' + t.slice(0, 90));
    }
    const s = await j(res);
    if (!s.access_token) throw new Error('no session came back');
    this._store({
      access_token: s.access_token,
      refresh_token: s.refresh_token,
      expires_at: Date.now() + (s.expires_in || 3600) * 1000,
      user: s.user || null,
    });
    return true;
  }

  async refreshIdentity() {
    if (!this.signedIn) { this.admin = false; return false; }
    try {
      const who = await fetch(URL_BASE + '/auth/v1/user', { headers: this._headers() });
      if (who.ok) {
        const user = await j(who);
        this._store(Object.assign({}, this.session, { user }));
      } else {
        // Any refusal means this session is not usable — not just 401. A
        // malformed or forged token can come back 400 or 403, and treating only
        // 401 as failure left the app reporting "signed in" for a token the
        // server had plainly rejected, with a blank email where the address
        // should have been.
        this._store(null); this.admin = false; return false;
      }
      const res = await fetch(URL_BASE + '/rest/v1/rpc/wave_is_admin', {
        method: 'POST',
        headers: this._headers({ 'Content-Type': 'application/json' }),
        body: '{}',
      });
      this.admin = res.ok ? (await j(res)) === true : false;
    } catch (e) {
      this.admin = false;
    }
    return this.admin;
  }

  signOut() { this._store(null); this.admin = false; }

  // ---- reading ------------------------------------------------------------

  /** Everything published, newest first. Open to the world, no session needed. */
  async list() {
    const url = URL_BASE + '/rest/v1/wave_tracks'
      + '?select=slug,title,artist,licence,source_url,path,duration,mood,key_name,bpm,colour,key_sure,bpm_sure'
      + '&published=eq.true&order=created_at.desc&limit=200';
    const res = await fetch(url, { headers: this._headers() });
    if (!res.ok) throw new Error('library unavailable (' + res.status + ')');
    return j(res);
  }

  /** Public bucket, so the audio is a plain URL with no signing round-trip. */
  audioUrl(path) {
    return URL_BASE + '/storage/v1/object/public/' + BUCKET + '/' + path;
  }

  // ---- writing (admins only; the database enforces it) --------------------

  async upload(file, slug, meta) {
    if (!this.signedIn) throw new Error('sign in first');
    const ext = (file.name.match(/\.([a-z0-9]+)$/i) || [, 'mp3'])[1].toLowerCase();
    const path = slug + '.' + ext;

    const up = await fetch(
      URL_BASE + '/storage/v1/object/' + BUCKET + '/' + encodeURIComponent(path),
      {
        method: 'POST',
        headers: this._headers({ 'Content-Type': file.type || 'audio/mpeg', 'x-upsert': 'true' }),
        body: file,
      },
    );
    if (!up.ok) {
      const t = await up.text().catch(() => '');
      throw new Error('upload failed (' + up.status + ') ' + t.slice(0, 160));
    }

    const row = Object.assign({ slug, path, bytes: file.size }, meta);
    const ins = await fetch(URL_BASE + '/rest/v1/wave_tracks?on_conflict=slug', {
      method: 'POST',
      headers: this._headers({
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation',
      }),
      body: JSON.stringify(row),
    });
    if (!ins.ok) {
      const t = await ins.text().catch(() => '');
      throw new Error('could not save the track (' + ins.status + ') ' + t.slice(0, 160));
    }
    return (await j(ins))[0];
  }

  async remove(slug) {
    const res = await fetch(URL_BASE + '/rest/v1/wave_tracks?slug=eq.' + encodeURIComponent(slug), {
      method: 'DELETE', headers: this._headers(),
    });
    if (!res.ok) throw new Error('could not remove that track (' + res.status + ')');
    return true;
  }
}

/** Titles become storage paths, so they have to survive being a filename. */
export function slugify(s) {
  return (s || '')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || ('track-' + Date.now().toString(36));
}
