<script lang="ts">
  /**
   * Phone-gate tool for the Go live publish relay. TEMPORARY (see +page.ts).
   *
   * Open as  /dev/live-publish#id=<session id>&t=<host token>
   * The fragment is never sent to the server; it is read once and then
   * removed from the address bar. The page publishes the camera through
   * POST /api/live/<id>/publish and shows what the connection is doing.
   * It never prints or logs SDP.
   */
  import { onDestroy, onMount } from 'svelte';

  let id = '';
  let token = '';
  let ready = false;

  let videoEl: HTMLVideoElement;
  let stream: MediaStream | null = null;
  let pc: RTCPeerConnection | null = null;
  let facing: 'environment' | 'user' = 'environment';
  let statsTimer: ReturnType<typeof setInterval> | null = null;
  let wakeLock: { release(): Promise<void> } | null = null;

  let phase = 'idle';
  let connection = '-';
  let sessionStatus = '-';
  let detail = '';
  let lines: string[] = [];

  function log(message: string) {
    const stamp = new Date().toISOString().slice(11, 19);
    lines = [`${stamp} ${message}`, ...lines].slice(0, 40);
  }

  onMount(() => {
    const params = new URLSearchParams(location.hash.slice(1));
    id = params.get('id') ?? '';
    token = params.get('t') ?? '';
    history.replaceState(null, '', location.pathname);
    ready = /^[0-9a-f]{32}$/.test(id) && /^[0-9a-f]{64}$/.test(token);
    log(
      ready ? 'session id and host token read from the link' : 'link is missing a valid id or token'
    );
    document.addEventListener('visibilitychange', onVisibility);
  });

  onDestroy(() => {
    if (typeof document !== 'undefined')
      document.removeEventListener('visibilitychange', onVisibility);
    stopLocal();
  });

  function onVisibility() {
    log(`page ${document.visibilityState}`);
    if (document.visibilityState === 'visible' && pc) void holdWakeLock();
  }

  async function holdWakeLock() {
    try {
      wakeLock = (await (navigator as any).wakeLock?.request('screen')) ?? null;
      log(wakeLock ? 'screen wake lock held' : 'screen wake lock not supported');
    } catch {
      log('screen wake lock refused');
    }
  }

  async function camera() {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true
    });
    videoEl.srcObject = stream;
    const settings = stream.getVideoTracks()[0]?.getSettings();
    log(`camera: ${settings?.facingMode ?? facing} ${settings?.width}x${settings?.height}`);
  }

  function gathered(conn: RTCPeerConnection): Promise<void> {
    if (conn.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      const check = () => conn.iceGatheringState === 'complete' && resolve();
      conn.addEventListener('icegatheringstatechange', check);
      setTimeout(resolve, 2500);
    });
  }

  async function publish() {
    if (!ready) return;
    phase = 'starting';
    detail = '';
    try {
      if (!stream) await camera();
      pc?.close();
      const conn = new RTCPeerConnection({ bundlePolicy: 'max-bundle' });
      pc = conn;
      conn.addEventListener('connectionstatechange', () => {
        connection = conn.connectionState;
        log(`connection: ${conn.connectionState}`);
      });
      for (const track of stream!.getTracks())
        conn.addTransceiver(track, { direction: 'sendonly' });
      await conn.setLocalDescription(await conn.createOffer());
      await gathered(conn);

      const started = performance.now();
      const res = await fetch(`/api/live/${id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp', Authorization: `Bearer ${token}` },
        body: conn.localDescription!.sdp
      });
      const ms = Math.round(performance.now() - started);
      const visible = ['location', 'etag', 'link'].filter((h) => res.headers.get(h));
      if (res.status !== 201) {
        const body = await res.json().catch(() => ({}));
        phase = 'failed';
        detail = `${res.status} ${body.error ?? ''}${body.retry ? ' (try again)' : ''}`;
        log(`publish refused: ${detail} in ${ms} ms`);
        return;
      }
      await conn.setRemoteDescription({ type: 'answer', sdp: await res.text() });
      phase = 'published';
      log(
        `publish 201 in ${ms} ms; Cloudflare headers visible to this page: ${visible.length ? visible.join(',') : 'none'}`
      );
      await holdWakeLock();
      startStats();
      void refreshStatus();
    } catch (err) {
      phase = 'failed';
      detail = (err as Error)?.name ?? 'error';
      log(`publish error: ${detail}`);
    }
  }

  function startStats() {
    if (statsTimer) clearInterval(statsTimer);
    let last: { bytes: number; at: number } | null = null;
    statsTimer = setInterval(async () => {
      if (!pc) return;
      const report = await pc.getStats();
      report.forEach((s: any) => {
        if (s.type !== 'outbound-rtp' || s.kind !== 'video') return;
        const codec = s.codecId ? (report.get(s.codecId) as any)?.mimeType : '?';
        const kbps = last
          ? Math.round(((s.bytesSent - last.bytes) * 8) / (s.timestamp - last.at))
          : 0;
        last = { bytes: s.bytesSent, at: s.timestamp };
        detail = `${codec} ${s.frameWidth}x${s.frameHeight} ${Math.round(s.framesPerSecond ?? 0)} fps ${kbps} kbps`;
      });
    }, 2000);
  }

  async function refreshStatus() {
    try {
      const res = await fetch(`/api/live/${id}`);
      sessionStatus = res.ok ? (await res.json()).status : `http ${res.status}`;
    } catch {
      sessionStatus = 'unreachable';
    }
  }

  async function flip() {
    if (!stream) return;
    facing = facing === 'environment' ? 'user' : 'environment';
    const old = stream.getVideoTracks()[0];
    old?.stop();
    if (old) stream.removeTrack(old);
    try {
      const next = (
        await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }
        })
      ).getVideoTracks()[0];
      stream.addTrack(next);
      const sender = pc?.getSenders().find((s) => s.track === null || s.track?.kind === 'video');
      await sender?.replaceTrack(next);
      videoEl.srcObject = stream;
      const settings = next.getSettings();
      log(`flipped to ${settings.facingMode ?? facing} ${settings.width}x${settings.height}`);
    } catch (err) {
      log(`flip failed: ${(err as Error)?.name ?? 'error'}`);
    }
  }

  function stopLocal() {
    if (statsTimer) clearInterval(statsTimer);
    statsTimer = null;
    pc?.close();
    pc = null;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    void wakeLock?.release().catch(() => undefined);
    wakeLock = null;
  }

  async function end() {
    try {
      const res = await fetch(`/api/live/${id}/end`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      log(`end: ${res.status}`);
    } catch {
      log('end: request failed');
    }
    stopLocal();
    phase = 'ended';
    connection = '-';
    void refreshStatus();
  }
</script>

<svelte:head>
  <title>Publish relay gate</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<main>
  <h1>Publish relay gate</h1>
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
    <dt>Sending</dt>
    <dd>{detail || '-'}</dd>
  </dl>

  <div class="buttons">
    <button on:click={publish} disabled={!ready}
      >{phase === 'published' ? 'Go live again (reconnect)' : 'Go live'}</button
    >
    <button on:click={flip} disabled={!stream}>Flip camera</button>
    <button on:click={refreshStatus} disabled={!ready}>Check status</button>
    <button on:click={end} disabled={!ready}>End</button>
  </div>

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
    margin-bottom: 0.75rem;
  }
  video {
    width: 100%;
    max-height: 45vh;
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
