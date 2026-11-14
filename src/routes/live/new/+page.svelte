<script lang="ts">
  /**
   * Go live — the host page.
   *
   * Reached from "Go live" in the create menu (pick a recipe or just a
   * title) or on a recipe page (that recipe attached). Shown only to
   * allowlisted hosts; the server enforces the list, this page only
   * decides what to show.
   *
   * The page never holds a Cloudflare URL. It posts an SDP offer to
   * /api/live/<id>/publish and gets an SDP answer back.
   *
   * Things this page must do because nothing else will:
   *  - The browser is NOT told when its broadcast is ended elsewhere (an
   *    admin, the 90-minute limit, End from another device). So it polls
   *    the session, and on "ended" stops the camera and says so.
   *  - A phone's connection does not always recover from a network drop
   *    by itself. ReconnectPolicy republishes with backoff and the page
   *    shows "Reconnecting…", never an error that needs a tap.
   *  - It keeps the screen awake while live.
   */
  import { onDestroy, onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { ndk, userPublickey } from '$lib/nostr';
  import { signNip98AuthHeader } from '$lib/nip98';
  import { requireAuth } from '$lib/auth/requireAuth';
  import { isLiveHost } from '$lib/live/config';
  import { setBottomDockClaim } from '$lib/stores/bottomDock';
  import {
    createLiveSession,
    endLiveSession,
    endLiveSessionSigned,
    publishOffer,
    readLiveStatus,
    type CreateOutcome,
    type HostSession,
    type SignRequest
  } from '$lib/live/host/hostApi';
  import { ReconnectPolicy, type StopReason } from '$lib/live/host/reconnect';
  import {
    cameraAttempts,
    classifyMediaError,
    clearStoredSession,
    detectPlatform,
    hasConfirmedAge,
    isConstraintFailure,
    loadStoredSession,
    mediaHelp,
    readRecipeHandoff,
    rememberAgeConfirmed,
    setMicrophoneEnabled,
    storeSession,
    type HostPlatform,
    type MediaHelp
  } from '$lib/live/host/hostDevice';
  import RecipePickerModal from '../../../components/RecipePickerModal.svelte';
  import Modal from '../../../components/Modal.svelte';

  const DOCK_OWNER = 'live-host';
  const STATUS_POLL_MS = 5000;
  const DEFAULT_TITLE = 'Live cook-along';

  type Phase =
    | 'loading' // working out who this is
    | 'signed_out'
    | 'not_allowed'
    | 'confirm_age'
    | 'preview' // camera on, not live yet
    | 'starting' // creating the session and publishing
    | 'live'
    | 'reconnecting'
    | 'resume' // a session from before a reload is still open
    | 'ended';

  let phase: Phase = 'loading';
  let platform: HostPlatform = 'other';
  let videoEl: HTMLVideoElement;

  // What is being broadcast.
  let title = DEFAULT_TITLE;
  let recipeA: string | null = null;
  let recipeTitle: string | null = null;
  let pickerOpen = false;

  // Camera.
  let stream: MediaStream | null = null;
  let facing: 'environment' | 'user' = 'environment';
  let mediaProblem: MediaHelp | null = null;
  let flipping = false;

  // Session and connection.
  let session: HostSession | null = null;
  let pc: RTCPeerConnection | null = null;
  let policy: ReconnectPolicy | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let wakeLock: { release(): Promise<void> } | null = null;
  let startedAt = 0;
  let elapsed = '0:00';
  let clockTimer: ReturnType<typeof setInterval> | null = null;

  // Messages. `notice` is a soft, non-blocking line; `endedMessage` is final.
  let notice = '';
  let endedMessage = '';
  let ageDialogOpen = false;
  let ending = false;
  /** Publish attempts made before the first success, for the badge. */
  let startAttempts = 0;

  const storage = () => (typeof sessionStorage !== 'undefined' ? sessionStorage : undefined);
  const durable = () => (typeof localStorage !== 'undefined' ? localStorage : undefined);

  const sign: SignRequest = (opts) => signNip98AuthHeader($ndk, opts);

  $: setBottomDockClaim(DOCK_OWNER, phase !== 'loading');
  $: isLive = phase === 'live' || phase === 'reconnecting';
  $: canStart = phase === 'preview' && !!stream && title.trim().length > 0;

  onMount(async () => {
    platform = detectPlatform(navigator.userAgent, navigator.maxTouchPoints);

    const handoff = readRecipeHandoff($page.url.searchParams);
    if (handoff) {
      recipeA = handoff.recipeA;
      recipeTitle = handoff.title;
      title = handoff.title;
    }

    if (!(await requireAuth({ kind: 'post', reason: 'Sign in to go live' }))) {
      phase = 'signed_out';
      return;
    }
    if (!isLiveHost($userPublickey)) {
      phase = 'not_allowed';
      return;
    }

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('online', onOnline);

    // A session left open by a reload of this tab?
    const stored = loadStoredSession(storage(), $userPublickey);
    if (stored) {
      const status = await readLiveStatus(stored.id);
      if (status === 'created' || status === 'live') {
        session = { id: stored.id, token: stored.token };
        title = stored.title || title;
        policy = makePolicy();
        policy.seedAttempts(stored.attempts);
        phase = 'resume';
        return;
      }
      clearStoredSession(storage());
    }

    if (!hasConfirmedAge($userPublickey, durable())) {
      phase = 'confirm_age';
      ageDialogOpen = true;
      return;
    }
    await enterPreview();
  });

  onDestroy(() => {
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('online', onOnline);
    }
    setBottomDockClaim(DOCK_OWNER, false);
    teardown(false);
  });

  // ── 18+ confirmation ───────────────────────────────────────────────
  async function confirmAge() {
    rememberAgeConfirmed($userPublickey, durable());
    ageDialogOpen = false;
    await enterPreview();
  }

  function declineAge() {
    ageDialogOpen = false;
    leave();
  }

  // ── Camera ─────────────────────────────────────────────────────────
  async function openCamera(
    which: 'environment' | 'user',
    withAudio: boolean
  ): Promise<MediaStream> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw Object.assign(new Error('no capture'), { name: 'TypeError' });
    }
    // Require the camera asked for; only if the device has no such camera,
    // ask for it as a preference. (A preference alone opened the front
    // camera first on an iPhone.)
    const attempts = cameraAttempts(which);
    for (let i = 0; i < attempts.length; i++) {
      try {
        return await navigator.mediaDevices.getUserMedia({ video: attempts[i], audio: withAudio });
      } catch (err) {
        if (i === attempts.length - 1 || !isConstraintFailure(err)) throw err;
      }
    }
    throw Object.assign(new Error('no camera'), { name: 'NotFoundError' });
  }

  async function enterPreview() {
    phase = 'preview';
    mediaProblem = null;
    try {
      stream = await openCamera(facing, true);
      attachPreview();
    } catch (err) {
      stream = null;
      mediaProblem = mediaHelp(classifyMediaError(err), platform);
    }
  }

  /**
   * When the system pauses the camera (a locked iPhone does this), the
   * video track is marked muted and viewers get a black picture. The
   * microphone is NOT paused with it, so tie the two together here: no
   * picture, no sound. This does not depend on the page being told it is
   * hidden, which a locked phone that is capturing may not be.
   */
  const followed = new WeakSet<MediaStreamTrack>();
  function followCamera() {
    const track = stream?.getVideoTracks()[0];
    if (!track || followed.has(track)) return;
    followed.add(track);
    track.addEventListener('mute', () => {
      if (stream?.getVideoTracks()[0] === track) setMicrophoneEnabled(stream, false);
    });
    track.addEventListener('unmute', () => {
      if (stream?.getVideoTracks()[0] === track && document.visibilityState === 'visible') {
        setMicrophoneEnabled(stream, true);
      }
    });
  }

  /** Called every time the page adopts a camera: first open, flip, revive, resume. */
  function attachPreview() {
    followCamera();
    if (videoEl && stream) {
      videoEl.srcObject = stream;
      videoEl.play().catch(() => undefined);
    }
  }

  async function flip() {
    if (!stream || flipping) return;
    flipping = true;
    const next = facing === 'environment' ? 'user' : 'environment';
    const old = stream.getVideoTracks()[0];
    try {
      // iOS ends the first camera when a second opens: stop, then open.
      old?.stop();
      const fresh = (await openCamera(next, false)).getVideoTracks()[0];
      if (old) stream.removeTrack(old);
      stream.addTrack(fresh);
      const sender = pc
        ?.getSenders()
        .find((s) => s.track === old || s.track?.kind === 'video' || s.track === null);
      await sender?.replaceTrack(fresh);
      facing = next;
      attachPreview();
    } catch {
      // Could not switch: get the previous camera back so the picture returns.
      try {
        const back = (await openCamera(facing, false)).getVideoTracks()[0];
        if (old) stream.removeTrack(old);
        stream.addTrack(back);
        const sender = pc?.getSenders().find((s) => s.track?.kind === 'video' || s.track === null);
        await sender?.replaceTrack(back);
        attachPreview();
      } catch (err) {
        mediaProblem = mediaHelp(classifyMediaError(err), platform);
      }
    } finally {
      flipping = false;
    }
  }

  /** After the tab was hidden or the phone locked, the camera may be dead. Bring it back. */
  async function reviveCamera() {
    if (!stream) return;
    const video = stream.getVideoTracks()[0];
    if (video && video.readyState === 'live' && !video.muted) return;
    try {
      const fresh = (await openCamera(facing, false)).getVideoTracks()[0];
      if (video) {
        video.stop();
        stream.removeTrack(video);
      }
      stream.addTrack(fresh);
      const sender = pc?.getSenders().find((s) => s.track?.kind === 'video' || s.track === null);
      await sender?.replaceTrack(fresh);
      attachPreview();
      // The camera is back and the host is looking at the page.
      setMicrophoneEnabled(stream, true);
    } catch {
      /* Stay as we are; the next visibility change tries again. */
    }
  }

  // ── Going live ─────────────────────────────────────────────────────
  function makePolicy(): ReconnectPolicy {
    return new ReconnectPolicy({
      republish: () => void publish(),
      stop: (reason) => void stopFor(reason),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>)
    });
  }

  const createMessages: Record<Exclude<CreateOutcome, { ok: true }>['reason'], string> = {
    already_active: 'You already have a live stream open.',
    not_allowed: 'Go live is not available for this account yet.',
    membership_required: 'Go live is for Cook+ members.',
    membership_unavailable:
      "We couldn't check your membership just now. Please try again in a moment.",
    live_off: 'Go live is switched off right now. Please try again later.',
    rate_limited: 'You have started several live streams in the last hour. Please try again later.',
    sign_failed: 'The request was not signed. Approve it in your signer and try again.',
    auth_failed: 'Your signature was not accepted. Check the clock on this device and try again.',
    bad_request: 'That title or recipe was not accepted. Change it and try again.',
    unavailable: "We couldn't start the live stream. Check your connection and try again."
  };

  async function goLive() {
    if (!canStart || !stream) return;
    phase = 'starting';
    notice = '';

    let outcome = await createLiveSession({ title: title.trim(), recipeA }, sign);
    if (!outcome.ok && outcome.reason === 'already_active' && outcome.id) {
      // Open in another tab or on another device, where its token lives.
      // End that one by signature and start this one.
      notice = 'Closing your earlier live stream…';
      if (await endLiveSessionSigned(outcome.id, sign)) {
        outcome = await createLiveSession({ title: title.trim(), recipeA }, sign);
      }
    }
    if (phase !== 'starting') {
      // The host tapped End while the session was being created. Close the
      // one that was just made so nothing is left open on the server.
      if (outcome.ok) await endLiveSession(outcome.session);
      return;
    }
    if (!outcome.ok) {
      phase = 'preview';
      notice = createMessages[outcome.reason];
      return;
    }

    session = outcome.session;
    startAttempts = 0;
    policy = makePolicy();
    remember();
    notice = '';
    startedAt = Date.now();
    await publish();
    startPolling();
    startClock();
    await holdWakeLock();
  }

  async function resume() {
    if (!session) return;
    phase = 'starting';
    mediaProblem = null;
    try {
      stream = stream ?? (await openCamera(facing, true));
      attachPreview();
    } catch (err) {
      mediaProblem = mediaHelp(classifyMediaError(err), platform);
      phase = 'resume';
      return;
    }
    startedAt = Date.now();
    await publish();
    startPolling();
    startClock();
    await holdWakeLock();
  }

  function remember() {
    if (!session) return;
    storeSession(storage(), {
      ...session,
      pubkey: $userPublickey,
      title: title.trim(),
      attempts: policy?.attemptsUsed ?? 0
    });
  }

  function gathered(conn: RTCPeerConnection): Promise<void> {
    if (conn.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        conn.removeEventListener('icegatheringstatechange', check);
        resolve();
      };
      const check = () => conn.iceGatheringState === 'complete' && done();
      conn.addEventListener('icegatheringstatechange', check);
      setTimeout(done, 2000);
    });
  }

  /** One publish attempt: a new connection, a new offer, relayed by our server. */
  async function publish() {
    if (!session || !stream || !policy || phase === 'ended') return;
    policy.publishStarted();
    if (phase === 'starting') startAttempts++;
    remember();
    if (phase !== 'starting') phase = 'reconnecting';

    pc?.close();
    const conn = new RTCPeerConnection({ bundlePolicy: 'max-bundle' });
    pc = conn;
    conn.addEventListener('connectionstatechange', () => {
      if (pc !== conn || !policy) return; // an older connection
      if (conn.connectionState === 'connected') {
        policy.connected();
        phase = 'live';
      } else if (conn.connectionState === 'disconnected') {
        policy.disconnected();
        phase = 'reconnecting';
      } else if (conn.connectionState === 'failed') {
        policy.failed();
        phase = 'reconnecting';
      }
    });

    let offerSdp: string;
    try {
      for (const track of stream.getTracks()) conn.addTransceiver(track, { direction: 'sendonly' });
      await conn.setLocalDescription(await conn.createOffer());
      await gathered(conn);
      offerSdp = conn.localDescription?.sdp ?? '';
    } catch {
      policy.publishFailed('retry');
      return;
    }

    const result = await publishOffer(session, offerSdp);
    if (pc !== conn) return; // superseded while waiting
    if (!result.ok) {
      policy.publishFailed(result.failure);
      return;
    }
    try {
      await conn.setRemoteDescription({ type: 'answer', sdp: result.answerSdp });
      policy.publishSucceeded();
    } catch {
      policy.publishFailed('retry');
    }
  }

  // ── Staying live ───────────────────────────────────────────────────
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(async () => {
      if (!session || phase === 'ended') return;
      const status = await readLiveStatus(session.id);
      // Ended elsewhere: an admin, the time limit, or End on another device.
      if (status === 'ended' || status === 'gone')
        await finish('This live stream has ended', false);
    }, STATUS_POLL_MS);
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  function startClock() {
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = setInterval(() => {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      elapsed = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }, 1000);
  }

  async function holdWakeLock() {
    try {
      const lock = (
        navigator as unknown as {
          wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> };
        }
      ).wakeLock;
      wakeLock = lock ? await lock.request('screen') : null;
    } catch {
      wakeLock = null; // Low power mode, or not supported: carry on without it.
    }
  }

  async function onVisibility() {
    if (!isLive && phase !== 'starting') return;
    if (document.visibilityState !== 'visible') {
      // Screen locked, or another app in front. iOS stops the camera but
      // not the microphone, so viewers would see black and still hear the
      // host. Send silence until the host is back.
      setMicrophoneEnabled(stream, false);
      return;
    }
    setMicrophoneEnabled(stream, true);
    if (!isLive) return;
    // The lock is released whenever the page is hidden.
    await holdWakeLock();
    await reviveCamera();
    if (pc && pc.connectionState !== 'connected' && pc.connectionState !== 'connecting')
      policy?.failed();
  }

  let linkCopied = false;
  /** The public watch page for this session, for the host to share. */
  async function copyWatchLink() {
    if (!session) return;
    const url = `${location.origin}/live/s/${session.id}`;
    try {
      await navigator.clipboard.writeText(url);
      linkCopied = true;
      setTimeout(() => (linkCopied = false), 2500);
    } catch {
      // No clipboard access (some in-app browsers): show the link instead.
      notice = url;
    }
  }

  function onPageHide() {
    setMicrophoneEnabled(stream, false);
  }

  function onOnline() {
    policy?.online();
  }

  // ── Ending ─────────────────────────────────────────────────────────
  const stopMessages: Record<StopReason, string> = {
    ended: 'This live stream has ended',
    auth: 'This live stream has ended',
    off: 'This live stream has ended. Go live is switched off right now.',
    limit: "This live stream has ended. The connection couldn't be kept up."
  };

  /** The reconnect policy gave up, or the server said stop. */
  async function stopFor(reason: StopReason) {
    // If we stopped ourselves (attempt limit), close the session server-side too.
    await finish(stopMessages[reason], reason === 'limit');
  }

  /** The host tapped End. */
  async function end() {
    if (ending) return;
    ending = true;
    await finish('This live stream has ended', true);
    ending = false;
  }

  async function finish(message: string, tellServer: boolean) {
    if (phase === 'ended') return;
    phase = 'ended';
    endedMessage = message;
    const closing = session;
    teardown(true);
    if (tellServer && closing) await endLiveSession(closing);
  }

  /** Stop everything local: timers, connection, camera, wake lock. */
  function teardown(forget: boolean) {
    policy?.shutdown();
    policy = null;
    stopPolling();
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = null;
    pc?.close();
    pc = null;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    if (videoEl) videoEl.srcObject = null;
    void wakeLock?.release().catch(() => undefined);
    wakeLock = null;
    if (forget) {
      clearStoredSession(storage());
      session = null;
    }
  }

  async function endStored() {
    if (!session) return;
    await endLiveSession(session);
    clearStoredSession(storage());
    session = null;
    policy = null;
    if (!hasConfirmedAge($userPublickey, durable())) {
      phase = 'confirm_age';
      ageDialogOpen = true;
      return;
    }
    await enterPreview();
  }

  function leave() {
    if (typeof history !== 'undefined' && history.length > 1) history.back();
    else void goto('/');
  }

  function onPick(event: CustomEvent<{ a: string; title: string }>) {
    recipeA = event.detail.a;
    recipeTitle = event.detail.title;
    title = event.detail.title.slice(0, 120) || DEFAULT_TITLE;
    pickerOpen = false;
  }

  function clearRecipe() {
    recipeA = null;
    recipeTitle = null;
    title = DEFAULT_TITLE;
  }
</script>

<svelte:head>
  <title>Go live - zap.cooking</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="live-host">
  {#if phase === 'loading'}
    <p class="muted">Getting ready…</p>
  {:else if phase === 'signed_out'}
    <h1>Go live</h1>
    <p class="muted">Sign in to go live.</p>
  {:else if phase === 'not_allowed'}
    <h1>Go live</h1>
    <p class="muted">Go live is not available for this account yet.</p>
  {:else if phase === 'ended'}
    <div class="ended" role="status">
      <h1>{endedMessage}</h1>
      <button class="btn" on:click={leave}>Done</button>
    </div>
  {:else}
    <!-- Kept in the page (the video element must exist when the camera
         arrives) but collapsed while there is no picture to show, so the
         instructions are not pushed below an empty black box. -->
    <div class="stage" class:collapsed={!!mediaProblem && !stream}>
      <!-- svelte-ignore a11y-media-has-caption -->
      <video bind:this={videoEl} autoplay muted playsinline class:mirrored={facing === 'user'}
      ></video>

      {#if isLive}
        <div
          class="badge"
          class:reconnecting={phase === 'reconnecting'}
          role="status"
          aria-live="polite"
        >
          {#if phase === 'reconnecting'}
            Reconnecting…
          {:else}
            <span class="dot" aria-hidden="true"></span> Live · {elapsed}
          {/if}
        </div>
      {:else if phase === 'starting'}
        <div class="badge" role="status" aria-live="polite">
          {startAttempts > 1 ? 'Still connecting…' : 'Starting…'}
        </div>
      {/if}
    </div>

    {#if mediaProblem}
      <div class="help" role="alert">
        <h2>{mediaProblem.title}</h2>
        {#if mediaProblem.steps.length > 0}
          <ol>
            {#each mediaProblem.steps as step}
              <li>{step}</li>
            {/each}
          </ol>
        {/if}
        {#if phase === 'preview'}
          <button class="btn" on:click={enterPreview}>Try again</button>
        {/if}
      </div>
    {/if}

    {#if phase === 'resume'}
      <div class="panel">
        <h1>You have a live stream open</h1>
        <p class="muted">{title}</p>
        <div class="actions">
          <button class="btn primary" on:click={resume}>Resume</button>
          <button class="btn" on:click={endStored}>End</button>
        </div>
      </div>
    {:else if phase === 'preview' || phase === 'confirm_age'}
      <div class="panel">
        {#if recipeA}
          <p class="recipe">
            <span class="muted">Recipe</span>
            <strong>{recipeTitle}</strong>
            <button class="link" on:click={clearRecipe}>Remove</button>
          </p>
        {:else}
          <label class="field">
            <span class="muted">Title</span>
            <input type="text" bind:value={title} maxlength="120" autocomplete="off" />
          </label>
          <button class="link" on:click={() => (pickerOpen = true)}>Pick one of my recipes</button>
        {/if}

        {#if notice}<p class="notice" role="status">{notice}</p>{/if}

        <div class="actions">
          <button
            class="btn"
            on:click={flip}
            disabled={!stream || flipping}
            aria-label="Flip camera">Flip</button
          >
          <button class="btn primary" on:click={goLive} disabled={!canStart}>Go live</button>
        </div>
        <p class="muted small">Live streams end by themselves after 90 minutes.</p>
      </div>
    {:else}
      <div class="panel">
        <p class="live-title">{title}</p>
        <p class="muted small">
          Locking your phone or leaving this page pauses the picture and mutes your microphone.
        </p>
        {#if notice}<p class="notice" role="status">{notice}</p>{/if}
        <div class="actions">
          <button
            class="btn"
            on:click={flip}
            disabled={!stream || flipping}
            aria-label="Flip camera">Flip</button
          >
          <button class="btn" on:click={copyWatchLink} disabled={!session}
            >{linkCopied ? 'Link copied' : 'Copy watch link'}</button
          >
          <!-- Never disabled while starting: if the first publish cannot get
               through, End is the only way out short of closing the tab. -->
          <button class="btn danger" on:click={end} disabled={ending}>End</button>
        </div>
      </div>
    {/if}
  {/if}
</div>

<Modal bind:open={ageDialogOpen} locked noHeader compact autoHeight>
  <div class="age">
    <h2>Before you go live</h2>
    <p>Hosts must be 18 or older. By continuing you confirm that you are 18 or older.</p>
    <p class="muted small">You will only be asked this once on this device.</p>
    <div class="actions">
      <button class="btn" on:click={declineAge}>Cancel</button>
      <button class="btn primary" on:click={confirmAge}>I'm 18 or older</button>
    </div>
  </div>
</Modal>

<RecipePickerModal
  bind:open={pickerOpen}
  on:select={onPick}
  on:close={() => (pickerOpen = false)}
/>

<style>
  .live-host {
    max-width: 40rem;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    color: var(--color-text-primary);
  }
  h1 {
    font-size: 1.375rem;
    font-weight: 700;
    line-height: 1.3;
  }
  h2 {
    font-size: 1.0625rem;
    font-weight: 700;
  }
  .muted {
    color: var(--color-caption);
  }
  .small {
    font-size: 0.8125rem;
  }
  .stage {
    position: relative;
    background: #000;
    border-radius: 0.75rem;
    overflow: hidden;
    aspect-ratio: 16 / 9;
  }
  @media (orientation: portrait) and (max-width: 640px) {
    .stage {
      aspect-ratio: 3 / 4;
      /* Leave room for the title, the buttons and the bottom nav. */
      max-height: 50vh;
    }
  }
  .stage.collapsed {
    display: none;
  }
  video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  video.mirrored {
    transform: scaleX(-1);
  }
  .badge {
    position: absolute;
    top: 0.75rem;
    left: 0.75rem;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.65rem;
    border-radius: 9999px;
    background: rgba(0, 0, 0, 0.65);
    color: #fff;
    font-size: 0.8125rem;
    font-weight: 600;
  }
  .badge.reconnecting {
    background: rgba(180, 83, 9, 0.9);
  }
  .dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 9999px;
    background: #ef4444;
  }
  .panel,
  .help,
  .ended {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .help {
    padding: 1rem;
    border-radius: 0.75rem;
    background: var(--color-input-bg);
    border: 1px solid var(--color-input-border);
  }
  .help ol {
    list-style: decimal;
    padding-left: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    font-size: 0.9375rem;
  }
  .ended {
    align-items: flex-start;
    padding: 2rem 0;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.875rem;
  }
  .field input {
    padding: 0.65rem 0.75rem;
    border-radius: 0.5rem;
    background: var(--color-input-bg);
    border: 1px solid var(--color-input-border);
    color: var(--color-text-primary);
    font-size: 1rem;
  }
  .recipe {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.5rem;
  }
  .live-title {
    font-weight: 600;
  }
  .notice {
    font-size: 0.9375rem;
    padding: 0.6rem 0.75rem;
    border-radius: 0.5rem;
    background: var(--color-input-bg);
    border: 1px solid var(--color-input-border);
  }
  .actions {
    display: flex;
    gap: 0.75rem;
  }
  .btn {
    min-height: 3rem;
    padding: 0 1.25rem;
    border-radius: 9999px;
    font-weight: 600;
    background: var(--color-input-bg);
    border: 1px solid var(--color-input-border);
    color: var(--color-text-primary);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn.primary {
    flex: 1;
    border: 0;
    background: #dc2626;
    color: #fff;
  }
  .btn.danger {
    flex: 1;
    border: 0;
    background: var(--color-text-primary);
    color: var(--color-bg-primary);
  }
  .link {
    align-self: flex-start;
    color: var(--color-primary);
    font-size: 0.9375rem;
    font-weight: 500;
  }
  .age {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.5rem;
    color: var(--color-text-primary);
  }
</style>
