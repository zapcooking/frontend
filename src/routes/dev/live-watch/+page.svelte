<script lang="ts">
  /**
   * Viewer gate tool for the Go live play relay. TEMPORARY (see +page.ts).
   *
   * Open as  /dev/live-watch?id=<session id>
   * A session id is public, so it travels in the query string. The page
   * joins through POST /api/live/<id>/join and shows what the connection
   * is doing. It never prints or logs SDP.
   *
   * "Watch" joins as a guest. "Watch as member" signs the join with a
   * NIP-07 signer when one is present, which is how the member bypass of
   * the guest cap is exercised.
   */
  import { onDestroy, onMount } from 'svelte';

  let id = '';
  let ready = false;
  let hasSigner = false;

  let videoEl: HTMLVideoElement;
  let pc: RTCPeerConnection | null = null;
  let framesTimer: ReturnType<typeof setInterval> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let want = false;
  let asMember = false;
  let retries = 0;

  let phase = 'idle';
  let connection = '-';
  let sessionStatus = '-';
  let detail = '';
  let lines: string[] = [];

  const MAX_RETRIES = 60;

  function log(message: string) {
    const stamp = new Date().toISOString().slice(11, 19);
    lines = [`${stamp} ${message}`, ...lines].slice(0, 40);
  }

  onMount(() => {
    id = new URLSearchParams(location.search).get('id') ?? '';
    ready = /^[0-9a-f]{32}$/.test(id);
    hasSigner = typeof (window as any).nostr?.signEvent === 'function';
    log(ready ? 'session id read from the link' : 'link is missing a valid ?id=');
    if (ready) void refreshStatus();
  });

  onDestroy(() => stop(false));

  function gathered(conn: RTCPeerConnection): Promise<void> {
    if (conn.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      const check = () => conn.iceGatheringState === 'complete' && resolve();
      conn.addEventListener('icegatheringstatechange', check);
      setTimeout(resolve, 2500);
    });
  }

  async function memberHeader(url: string, sdp: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sdp));
    const payload = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join(
      ''
    );
    const event = await (window as any).nostr.signEvent({
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['u', url],
        ['method', 'POST'],
        ['payload', payload]
      ],
      content: ''
    });
    return 'Nostr ' + btoa(JSON.stringify(event));
  }

  function scheduleRetry(reason: string) {
    if (!want || retryTimer) return;
    if (retries >= MAX_RETRIES) {
      phase = 'gave up';
      log(`stopped retrying after ${MAX_RETRIES} attempts`);
      return;
    }
    retries++;
    phase = 'waiting';
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (want) void join(reason);
    }, 2000);
  }

  async function watch(member: boolean) {
    want = true;
    asMember = member;
    retries = 0;
    await join(member ? 'watch as member' : 'watch');
  }

  async function join(reason: string) {
    if (!ready) return;
    phase = 'joining';
    detail = '';
    try {
      pc?.close();
      const conn = new RTCPeerConnection({ bundlePolicy: 'max-bundle' });
      pc = conn;
      conn.addEventListener('connectionstatechange', () => {
        connection = conn.connectionState;
        log(`connection: ${conn.connectionState}`);
      });
      conn.addTransceiver('video', { direction: 'recvonly' });
      conn.addTransceiver('audio', { direction: 'recvonly' });
      const media = new MediaStream();
      conn.ontrack = (e) => {
        media.addTrack(e.track);
        videoEl.srcObject = media;
      };
      await conn.setLocalDescription(await conn.createOffer());
      await gathered(conn);
      const sdp = conn.localDescription!.sdp;

      const url = `${location.origin}/api/live/${id}/join`;
      const headers: Record<string, string> = { 'Content-Type': 'application/sdp' };
      if (asMember) headers.Authorization = await memberHeader(url, sdp);

      const started = performance.now();
      const res = await fetch(url, { method: 'POST', headers, body: sdp });
      const ms = Math.round(performance.now() - started);
      const visible = ['location', 'etag', 'link'].filter((h) => res.headers.get(h));

      if (res.status !== 201) {
        const body = await res.json().catch(() => ({}));
        detail = `${res.status} ${body.error ?? ''}`;
        log(`join (${reason}) refused: ${detail}${body.retry ? ', will retry' : ''} in ${ms} ms`);
        conn.close();
        if (body.retry) scheduleRetry('retry');
        else {
          phase = body.error === 'full' ? 'full' : body.error === 'ended' ? 'ended' : 'refused';
          want = false;
        }
        void refreshStatus();
        return;
      }
      await conn.setRemoteDescription({ type: 'answer', sdp: await res.text() });
      phase = asMember ? 'watching (member)' : 'watching (guest)';
      retries = 0;
      log(
        `join (${reason}) 201 in ${ms} ms; Cloudflare headers visible to this page: ${visible.length ? visible.join(',') : 'none'}`
      );
      videoEl.play().catch(() => log('autoplay blocked; tap Sound on'));
      watchFrames();
      void refreshStatus();
    } catch (err) {
      detail = (err as Error)?.name ?? 'error';
      log(`join error: ${detail}`);
      scheduleRetry('retry after error');
    }
  }

  // The connection stays "connected" when a broadcast goes away, so frame
  // flow is the signal: stalled for 4 seconds means rejoin.
  function watchFrames() {
    if (framesTimer) clearInterval(framesTimer);
    let lastFrames = -1;
    let lastChange = performance.now();
    let sawFrame = false;
    const startedAt = performance.now();
    framesTimer = setInterval(async () => {
      if (!pc) return;
      const report = await pc.getStats();
      report.forEach((s: any) => {
        if (s.type !== 'inbound-rtp' || s.kind !== 'video') return;
        const frames = s.framesDecoded ?? 0;
        const now = performance.now();
        if (frames !== lastFrames) {
          lastChange = now;
          if (!sawFrame && frames > 0) {
            sawFrame = true;
            log(`first frame after ${Math.round(now - startedAt)} ms`);
          }
        } else if (sawFrame && want && now - lastChange > 4000) {
          log('video stalled for 4 s; rejoining');
          if (framesTimer) clearInterval(framesTimer);
          framesTimer = null;
          scheduleRetry('stalled');
        }
        lastFrames = frames;
        const codec = s.codecId ? (report.get(s.codecId) as any)?.mimeType : '?';
        detail = `${codec} ${s.frameWidth ?? '?'}x${s.frameHeight ?? '?'} ${Math.round(s.framesPerSecond ?? 0)} fps, ${frames} frames`;
      });
    }, 1000);
  }

  async function refreshStatus() {
    try {
      const res = await fetch(`/api/live/${id}`);
      sessionStatus = res.ok ? (await res.json()).status : `http ${res.status}`;
    } catch {
      sessionStatus = 'unreachable';
    }
  }

  function soundOn() {
    videoEl.muted = false;
    videoEl.play().then(
      () => log('sound on'),
      () => log('sound on refused')
    );
  }

  function stop(announce = true) {
    want = false;
    if (framesTimer) clearInterval(framesTimer);
    framesTimer = null;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    pc?.close();
    pc = null;
    if (announce) {
      phase = 'stopped';
      connection = '-';
      log('stopped');
    }
  }
</script>

<svelte:head>
  <title>Play relay gate</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<main>
  <h1>Play relay gate</h1>
  <p class="note">Temporary test page for preview deployments. Not part of the product.</p>

  <!-- svelte-ignore a11y-media-has-caption -->
  <video bind:this={videoEl} autoplay muted playsinline></video>

  <dl>
    <dt>Step</dt>
    <dd>{phase}</dd>
    <dt>Connection</dt>
    <dd>{connection}</dd>
    <dt>Session status (our API)</dt>
    <dd>{sessionStatus}</dd>
    <dt>Receiving</dt>
    <dd>{detail || '-'}</dd>
  </dl>

  <div class="buttons">
    <button on:click={() => watch(false)} disabled={!ready}>Watch</button>
    <button on:click={() => watch(true)} disabled={!ready || !hasSigner}>Watch as member</button>
    <button on:click={soundOn} disabled={!pc}>Sound on</button>
    <button on:click={refreshStatus} disabled={!ready}>Check status</button>
    <button on:click={() => stop()} disabled={!pc && !want}>Stop</button>
  </div>
  {#if !hasSigner}
    <p class="note">
      No signer extension found in this browser, so "Watch as member" is unavailable here.
    </p>
  {/if}

  <pre>{lines.join('\n')}</pre>
</main>

<style>
  main {
    max-width: 34rem;
    margin: 0 auto;
    padding: 1rem;
    color: var(--color-text-primary);
  }
  h1 {
    font-size: 1.25rem;
    font-weight: 700;
  }
  .note {
    font-size: 0.85rem;
    color: var(--color-caption);
    margin: 0.5rem 0;
  }
  video {
    width: 100%;
    max-height: 50vh;
    background: #000;
    border-radius: 0.5rem;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.25rem 0.75rem;
    margin: 0.75rem 0;
    font-size: 0.9rem;
  }
  dt {
    color: var(--color-caption);
  }
  dd {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  button {
    padding: 0.7rem 1rem;
    border-radius: 0.5rem;
    background: var(--color-input-bg);
    border: 1px solid var(--color-input-border);
    font-weight: 600;
  }
  button:disabled {
    opacity: 0.45;
  }
  pre {
    margin-top: 0.75rem;
    font-size: 0.72rem;
    white-space: pre-wrap;
    color: var(--color-caption);
  }
</style>
