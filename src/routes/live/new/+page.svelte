<script lang="ts">
  /**
   * Go live — the host page.
   *
   * Reached from "Go live" in the create menu (pick a recipe or just a
   * title) or on a recipe page (that recipe attached). Hosting is for
   * active members (Cook+) who are not blocked; the server decides. This
   * page shows the membership page link to a CONFIRMED non-member before
   * the camera opens. An unknown membership answer goes ahead and lets the
   * server decide (an outage is "try again", never "not a member").
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
   *  - With the "Live now" note switch on (the default), it posts a kind 1
   *    note from the host when the broadcast first connects, records the
   *    note's id on the session, and shows the comments (replies to the
   *    note). Off: no note, no comments, no zap total.
   */
  import { onDestroy, onMount, tick } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { ndk, userPublickey } from '$lib/nostr';
  import { signNip98AuthHeader } from '$lib/nip98';
  import { requireAuth } from '$lib/auth/requireAuth';
  import { goLiveAccess, LIVE_ACCESS_NOTE_MAX, LIVE_MEMBERSHIP_PATH } from '$lib/live/config';
  import { getMembership } from '$lib/stores/membershipStatus';
  import { setBottomDockClaim } from '$lib/stores/bottomDock';
  import {
    createLiveSession,
    endedStatsLine,
    endLiveSession,
    endLiveSessionSigned,
    endLiveSessionWithStats,
    acceptLiveTerms,
    fetchHostingStatus,
    fetchLiveStats,
    publishOffer,
    readLiveStatus,
    readWatchingNow,
    recordLiveNote,
    requestHostingAccess,
    type OwnAccessRequest,
    type CreateOutcome,
    type HostSession,
    type LiveStats,
    type SignRequest
  } from '$lib/live/host/hostApi';
  import { LIVE_WATCHING_POLL_MS } from '$lib/live/config';
  import { watchingCount, watchingLabel } from '$lib/streams/goLive';
  import { ReconnectPolicy, type StopReason } from '$lib/live/host/reconnect';
  import {
    cameraAttempts,
    classifyMediaError,
    clearStoredSession,
    detectPlatform,
    isConstraintFailure,
    liveDurationLine,
    loadStoredSession,
    mediaHelp,
    readRecipeHandoff,
    audioSwitches,
    storeSession,
    type HostPlatform,
    type MediaHelp
  } from '$lib/live/host/hostDevice';
  import { LIVE_DEFAULT_TITLE, liveStreamName } from '$lib/live/streamName';
  import { fetchSession, sessionToStreamItem } from '$lib/streams/goLive';
  import { fetchRecipeEvent, recipeCardOf } from '$lib/streams/recipeCard';
  import { createStreamPool } from '$lib/streams/relayPage';
  import { DISCOVERY_RELAYS } from '$lib/streams/relays';
  import { liveNoteTemplate } from '$lib/live/liveNote';
  import { addClientTagToEvent } from '$lib/nip89';
  import { NDKEvent, NDKRelaySet } from '@nostr-dev-kit/ndk';
  import type { SimplePool } from 'nostr-tools/pool';
  import type { StreamItem } from '$lib/streams/types';
  import StreamChat from '../../../components/streams/StreamChat.svelte';
  import RecipePanel from '../../../components/streams/RecipePanel.svelte';
  import type { NDKEvent as NDKEventType } from '@nostr-dev-kit/ndk';
  import CameraRotateIcon from 'phosphor-svelte/lib/CameraRotate';
  import MonitorArrowUpIcon from 'phosphor-svelte/lib/MonitorArrowUp';
  import MicrophoneIcon from 'phosphor-svelte/lib/Microphone';
  import MicrophoneSlashIcon from 'phosphor-svelte/lib/MicrophoneSlash';
  import {
    canShareScreen,
    classifyShareError,
    displayMediaAttempts,
    mixAudio,
    shareHint,
    shareProblemMessage,
    type AudioMix
  } from '$lib/live/host/screenShare';
  import LiveShareButton from '../../../components/streams/LiveShareButton.svelte';
  import { getSiteOrigin } from '$lib/utils/share';
  import XIcon from 'phosphor-svelte/lib/X';
  import RecipePickerModal from '../../../components/RecipePickerModal.svelte';
  import Modal from '../../../components/Modal.svelte';

  const DOCK_OWNER = 'live-host';
  const STATUS_POLL_MS = 5000;
  const DEFAULT_TITLE = LIVE_DEFAULT_TITLE;
  /** The "locking your phone" hint is shown until dismissed, once per device. */
  const LOCK_HINT_KEY = 'zc.live.lockHintDismissed';

  type Phase =
    | 'loading' // working out who this is
    | 'signed_out'
    | 'membership_required' // a confirmed non-member: link to the membership page
    | 'blocked' // blocked from hosting by the admin
    | 'rollout' // a member, not on the approved list yet: "Request access"
    | 'preview' // camera on, not live yet
    | 'starting' // creating the session and publishing
    | 'live'
    | 'reconnecting'
    | 'resume' // a session from before a reload is still open
    | 'ended';

  let phase: Phase = 'loading';
  let platform: HostPlatform = 'other';
  let videoEl: HTMLVideoElement;
  let stageEl: HTMLElement;

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

  // Screen sharing (desktop). While sharing, `stream` holds the screen's
  // video track and the audio that is sent (the microphone, or the
  // microphone mixed with the tab's audio); the camera is closed.
  let shareSupported = false;
  let sharing = false;
  let shareBusy = false;
  let screenTrack: MediaStreamTrack | null = null;
  /** The shared tab's or system's audio, when the browser gave it. */
  let screenAudio: MediaStreamTrack | null = null;
  /** The microphone, held here while `stream` carries the mix instead. */
  let micTrack: MediaStreamTrack | null = null;
  let audioMix: AudioMix | null = null;
  /** "Share one window or tab…", or the stronger whole-screen line. */
  let shareLine = '';
  /** The camera did not come back after sharing: offer to try again. */
  let cameraLost = false;

  // Sound. Two separate switches:
  //  - micMuted: the host's own Mute button. Kept across camera and screen
  //    switches and reconnects; only the host changes it.
  //  - soundOn: the page's automatic rule (off while a phone is locked or
  //    the page is hidden in camera mode, and when leaving the page).
  // A muted microphone still sends silent audio packets, so viewers stay
  // connected (their stall rule counts audio packets).
  let micMuted = false;
  let soundOn = true;

  /** Apply both switches to the tracks. While sharing with tab audio, Mute silences only the microphone. */
  function applyAudio() {
    if (!stream) return;
    const sent = stream.getAudioTracks()[0];
    const on = audioSwitches({ mixing: !!micTrack, micMuted, soundOn });
    if (micTrack) micTrack.enabled = on.mic;
    if (sent) sent.enabled = on.sent;
  }

  function setSound(on: boolean) {
    soundOn = on;
    applyAudio();
  }

  function toggleMute() {
    micMuted = !micMuted;
    applyAudio();
  }

  // Session and connection.
  let session: HostSession | null = null;
  let pc: RTCPeerConnection | null = null;
  let policy: ReconnectPolicy | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let wakeLock: { release(): Promise<void> } | null = null;
  let startedAt = 0;
  /** Whether this page ever had a connected broadcast (for the ended screen). */
  let everLive = false;
  /** "You were live for …" on the ended screen. */
  let liveLine: string | null = null;
  /** "Peak N watching · N joins · N sats" on the ended screen. */
  let statsLine: string | null = null;
  /** "N watching" while live (anonymous heartbeat count; 0 or unknown shows nothing). */
  let watching: number | null = null;
  let watchingTimer: ReturnType<typeof setInterval> | null = null;
  let elapsed = '0:00';
  let clockTimer: ReturnType<typeof setInterval> | null = null;

  // Messages. `notice` is a soft, non-blocking line; `endedMessage` is final.
  let notice = '';
  let endedMessage = '';
  // The hosting agreement ("I'm 18+, agree and go live"), recorded on the
  // server per account and terms version. Asked when the host taps Go live.
  let termsDialogOpen = false;
  /** Agreed to the current version: true / false, or null = not known (create decides). */
  let termsAccepted: boolean | null = null;
  /** The version the dialog asks about (from hosting status or a terms_required reply). */
  let termsVersion: string | null = null;
  let termsBusy = false;
  let termsError = '';
  let ending = false;
  /** Publish attempts made before the first success, for the badge. */
  let startAttempts = 0;

  const storage = () => (typeof sessionStorage !== 'undefined' ? sessionStorage : undefined);

  const sign: SignRequest = (opts) => signNip98AuthHeader($ndk, opts);

  $: setBottomDockClaim(DOCK_OWNER, phase !== 'loading');
  $: isLive = phase === 'live' || phase === 'reconnecting';
  $: canStart = phase === 'preview' && !!stream && title.trim().length > 0;

  // ── "Live now" note and comments ───────────────────────────────────
  /** The switch on the preview screen. Off: no note, so no comments. */
  let postNote = true;
  /** The posted note's id, once it exists (also read back on resume). */
  let noteId: string | null = null;
  let notePosting = false;
  /** The recipe's photo for the note, fetched when a recipe is attached. */
  let recipeImage: string | null = null;
  /** The attached recipe, for the host's own recipe panel while live. */
  let recipeEvent: NDKEventType | null = null;
  /** Phones: which panel shows under the video while live. */
  let hostTab: 'chat' | 'recipe' = 'chat';
  let hostWide = false;
  const HOST_WIDE_QUERY = '(min-width: 1100px)';
  let recipeImageFor: string | null = null;
  let chatPool: SimplePool | null = null;
  /** Verified zaps on the note, as the chat counts them. */
  let zapSats = 0;
  let zapCount = 0;
  let chatItem: StreamItem | null = null;

  $: if (recipeA && recipeA !== recipeImageFor) void loadRecipeImage(recipeA);
  async function loadRecipeImage(a: string) {
    recipeImageFor = a;
    recipeImage = null;
    recipeEvent = null;
    const event = await fetchRecipeEvent($ndk, a);
    if (recipeImageFor === a) {
      recipeImage = recipeCardOf(event)?.image ?? null;
      recipeEvent = event;
    }
  }

  $: chatItem =
    session && noteId
      ? sessionToStreamItem(
          {
            id: session.id,
            status: phase === 'ended' ? 'ended' : 'live',
            title,
            recipe_a: recipeA,
            host_pubkey: $userPublickey,
            created_at: Math.floor(startedAt / 1000),
            started_at: Math.floor(startedAt / 1000),
            ended_at: null,
            note_id: noteId
          },
          recipeTitle ? { title: recipeTitle, image: recipeImage } : null,
          ownName
        )
      : null;
  $: if (chatItem && !chatPool) chatPool = createStreamPool();

  /**
   * Post the "Live now" note and record it on the session. Runs once, when
   * the broadcast first connects, so a start that never gets through
   * leaves no note behind. A failure never stops the stream.
   */
  /**
   * The note signed for a session, kept until its id is recorded. A retry
   * (the next connect after a failure) re-publishes and re-records THIS
   * event, never a new one: a lost reply after the server stored the id
   * would otherwise leave duplicate Live now posts.
   */
  let signedNote: { sessionId: string; event: NDKEvent } | null = null;
  const NOTE_RETRY_MS = 15000;
  const NOTE_MAX_TRIES = 5;
  let noteTries = 0;
  let noteRetryTimer: ReturnType<typeof setTimeout> | null = null;

  async function postLiveNote() {
    if (!postNote || noteId || notePosting || !session) return;
    notePosting = true;
    noteTries++;
    const forSession = session;
    try {
      let event = signedNote?.sessionId === forSession.id ? signedNote.event : null;
      if (!event) {
        const template = liveNoteTemplate({
          name: streamName,
          watchUrl: `${location.origin}/live/s/${forSession.id}`,
          image: recipeImage,
          recipeA
        });
        event = new NDKEvent($ndk, template as never);
        addClientTagToEvent(event);
        await event.sign();
        signedNote = { sessionId: forSession.id, event };
      }
      const urls = [...new Set([...$ndk.pool.relays.keys(), ...DISCOVERY_RELAYS])];
      await Promise.race([
        event.publish(NDKRelaySet.fromRelayUrls(urls, $ndk, true)),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000))
      ]);
      if (session?.id !== forSession.id) return;
      if (await recordLiveNote(forSession, event.id)) {
        noteId = event.id;
      } else {
        // Not confirmed: the server may still hold an id (a lost reply, or
        // one recorded earlier). Take what the session says.
        const read = await fetchSession(forSession.id);
        if (session?.id !== forSession.id) return;
        if (!read?.note_id) throw new Error('not recorded');
        noteId = read.note_id;
      }
      signedNote = null;
      if (notice.startsWith('The Live now note')) notice = '';
    } catch {
      if (session?.id === forSession.id) {
        if (noteTries < NOTE_MAX_TRIES) {
          // Same signed note, a little later (and again on reconnect).
          notice = 'Posting your Live now note again shortly…';
          if (noteRetryTimer) clearTimeout(noteRetryTimer);
          noteRetryTimer = setTimeout(() => {
            noteRetryTimer = null;
            if (isLive) void postLiveNote();
          }, NOTE_RETRY_MS);
        } else {
          notice = "The Live now note wasn't posted, so this stream has no comments.";
        }
      }
    } finally {
      notePosting = false;
    }
  }

  /** The host's own name, for "<name> is cooking <recipe>". */
  let ownName: string | null = null;
  $: streamName = liveStreamName({
    title,
    hasRecipe: !!recipeA,
    recipeTitle,
    hostName: ownName
  });

  let lockHintDismissed = true;
  function readLockHint() {
    try {
      lockHintDismissed = localStorage.getItem(LOCK_HINT_KEY) === '1';
    } catch {
      lockHintDismissed = false;
    }
  }
  function dismissLockHint() {
    lockHintDismissed = true;
    try {
      localStorage.setItem(LOCK_HINT_KEY, '1');
    } catch {
      /* not remembered: it stays hidden for this visit */
    }
  }

  async function loadOwnName(pubkey: string) {
    try {
      const profile = await $ndk.getUser({ pubkey }).fetchProfile();
      const name = (profile?.displayName || profile?.name || '').toString().trim();
      ownName = name || null;
    } catch {
      /* "Cooking <recipe>" without it */
    }
  }

  // ── Staged rollout: "Request access" ──
  // form: may ask (optional note) · sent: a request is pending ·
  // declined: asked before and declined, may ask again from `retryAt`.
  let accessView: 'form' | 'sent' | 'declined' = 'form';
  let accessNote = '';
  let accessRetryAt: number | null = null;
  let accessSending = false;
  let accessError = '';

  function showOwnRequest(request: OwnAccessRequest) {
    if (request.status === 'pending') accessView = 'sent';
    else if (request.status === 'declined' && request.retry_at !== null) {
      accessView = 'declined';
      accessRetryAt = request.retry_at;
    } else accessView = 'form';
  }

  async function requestAccess() {
    if (accessSending) return;
    accessSending = true;
    accessError = '';
    const outcome = await requestHostingAccess(accessNote.trim(), sign);
    accessSending = false;
    if (outcome.kind === 'approved') {
      location.reload(); // approved meanwhile: start over as a host
    } else if (outcome.kind === 'sent' || outcome.kind === 'already_pending') {
      accessView = 'sent';
    } else if (outcome.kind === 'declined_recently') {
      accessView = 'declined';
      accessRetryAt = outcome.retryAt;
    } else if (outcome.kind === 'membership_required') {
      phase = 'membership_required';
    } else {
      accessError =
        outcome.kind === 'sign_failed'
          ? 'The request was not signed. Approve it in your signer and try again.'
          : "The request couldn't be sent. Please try again in a moment.";
    }
  }
  const retryDate = (s: number | null) =>
    s ? new Date(s * 1000).toLocaleDateString(undefined, { dateStyle: 'long' }) : 'soon';

  onMount(() => {
    const mq = window.matchMedia(HOST_WIDE_QUERY);
    const onChange = () => (hostWide = mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  });

  onMount(async () => {
    platform = detectPlatform(navigator.userAgent, navigator.maxTouchPoints);
    shareSupported = canShareScreen({
      platform,
      hasGetDisplayMedia: typeof navigator.mediaDevices?.getDisplayMedia === 'function',
      finePointer: window.matchMedia('(any-pointer: fine)').matches
    });

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
    const pk = $userPublickey.toLowerCase();
    const startHosting = () => {
      readLockHint();
      void loadOwnName($userPublickey);
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('pagehide', onPageHide);
      window.addEventListener('online', onOnline);
    };

    // A session left open by a reload of this tab? Recover it BEFORE the
    // membership and approval checks below, which are for starting a NEW
    // stream: a host whose approval was removed, or whose membership
    // lapsed, while a session was open must still get Resume and End.
    // (Publish still refuses a blocked host.)
    const stored = loadStoredSession(storage(), $userPublickey);
    if (stored) {
      const status = await readLiveStatus(stored.id);
      if (status === 'created' || status === 'live') {
        startHosting();
        session = { id: stored.id, token: stored.token };
        title = stored.title || title;
        policy = makePolicy();
        policy.seedAttempts(stored.attempts);
        phase = 'resume';
        return;
      }
      clearStoredSession(storage());
    }

    // Only a confirmed "not a member" stops here. Unknown goes ahead: the
    // server decides at create, and an outage there says "try again".
    const membership = await getMembership([pk]).catch(
      () => ({}) as Awaited<ReturnType<typeof getMembership>>
    );
    if (goLiveAccess(membership[pk]) === 'non_member') {
      phase = 'membership_required';
      return;
    }
    // Staged rollout: a member who is not approved yet can ask for access.
    // Unanswered goes ahead; the create route decides.
    const hosting = await fetchHostingStatus(sign);
    if (hosting.known && !hosting.approved) {
      showOwnRequest(hosting.request);
      phase = 'rollout';
      return;
    }
    if (hosting.known && hosting.terms) {
      termsAccepted = hosting.terms.accepted;
      termsVersion = hosting.terms.version;
    }
    startHosting();
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
    chatPool?.destroy();
    chatPool = null;
  });

  // ── Hosting agreement (18+ and the Terms) ─────────────────────────
  function askForTerms() {
    termsError = '';
    termsDialogOpen = true;
  }

  /** "I'm 18+, agree and go live": record it, then go live. */
  async function agreeToTerms() {
    if (termsBusy) return;
    if (!termsVersion) {
      // Not known yet: let the create route say which version it wants.
      termsDialogOpen = false;
      termsAccepted = null;
      await goLive();
      return;
    }
    termsBusy = true;
    termsError = '';
    const outcome = await acceptLiveTerms(termsVersion, sign);
    termsBusy = false;
    if (outcome.kind === 'accepted') {
      termsAccepted = true;
      termsDialogOpen = false;
      await goLive();
      return;
    }
    if (outcome.kind === 'changed') {
      termsVersion = outcome.version;
      termsError = 'The Terms were just updated. Please review them, then try again.';
      return;
    }
    if (outcome.kind === 'membership_required') {
      termsDialogOpen = false;
      teardown(true);
      phase = 'membership_required';
      return;
    }
    termsError =
      outcome.kind === 'sign_failed'
        ? 'The request was not signed. Approve it in your signer and try again.'
        : "We couldn't save that just now. Check your connection and try again.";
  }

  /** "Not now": close the dialog and stay on the preview. */
  function notNow() {
    termsDialogOpen = false;
    termsError = '';
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
    // A shared screen is not a camera: a still window can read as muted,
    // and that must not silence the host.
    if (!track || track === screenTrack || followed.has(track)) return;
    followed.add(track);
    track.addEventListener('mute', () => {
      if (stream?.getVideoTracks()[0] === track) setSound(false);
    });
    track.addEventListener('unmute', () => {
      if (stream?.getVideoTracks()[0] === track && document.visibilityState === 'visible') {
        setSound(true);
      }
    });
  }

  /** Called every time the page adopts a camera: first open, flip, revive, resume. */
  function attachPreview() {
    followCamera();
    applyAudio();
    if (videoEl && stream) {
      videoEl.srcObject = stream;
      videoEl.play().catch(() => undefined);
    }
  }

  async function flip() {
    if (!stream || flipping || sharing) return;
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
    // While sharing, the video track is the screen, not a camera.
    if (!stream || sharing) return;
    const video = stream.getVideoTracks()[0];
    if (video && video.readyState === 'live' && !video.muted) return;
    try {
      const fresh = (await openCamera(facing, false)).getVideoTracks()[0];
      if (!stream) {
        fresh.stop();
        return;
      }
      if (video) {
        video.stop();
        stream.removeTrack(video);
      }
      stream.addTrack(fresh);
      const sender = pc?.getSenders().find((s) => s.track?.kind === 'video' || s.track === null);
      await sender?.replaceTrack(fresh);
      cameraLost = false;
      attachPreview();
      // The camera is back and the host is looking at the page.
      setSound(true);
    } catch {
      /* Stay as we are; the next visibility change tries again. */
    }
  }

  // ── Sharing the screen ─────────────────────────────────────────────
  /** The sender for one kind of track. A sendonly transceiver's receiver still has that kind. */
  function senderFor(kind: 'audio' | 'video'): RTCRtpSender | undefined {
    return pc?.getTransceivers().find((t) => t.receiver.track?.kind === kind)?.sender;
  }

  /**
   * Put `next` in place of the stream's track of that kind: in `stream`
   * (what a republish sends) and on the live connection (replaceTrack, no
   * renegotiation). Returns the track it replaced, still running.
   */
  async function swapTrack(
    kind: 'audio' | 'video',
    next: MediaStreamTrack
  ): Promise<MediaStreamTrack | null> {
    if (!stream) return null;
    const old = (kind === 'video' ? stream.getVideoTracks() : stream.getAudioTracks())[0] ?? null;
    if (old) stream.removeTrack(old);
    stream.addTrack(next);
    await senderFor(kind)?.replaceTrack(next);
    return old;
  }

  let shareError = '';

  async function startShare() {
    if (!stream || sharing || shareBusy) return;
    shareBusy = true;
    shareError = '';
    // The first getDisplayMedia call must happen inside the click itself
    // (Safari refuses one made after an await), so nothing is awaited first.
    let display: MediaStream | null = null;
    const attempts = displayMediaAttempts();
    for (let i = 0; i < attempts.length && !display; i++) {
      try {
        display = await navigator.mediaDevices.getDisplayMedia(attempts[i]);
      } catch (err) {
        const problem = classifyShareError(err);
        if (problem === 'retry' && i < attempts.length - 1) continue;
        shareError = shareProblemMessage(problem) ?? '';
        shareBusy = false;
        return;
      }
    }
    const video = display?.getVideoTracks()[0];
    if (!display || !video || !stream || phase === 'ended') {
      display?.getTracks().forEach((t) => t.stop());
      shareBusy = false;
      return;
    }
    // Keep text sharp: a screen is mostly recipes and pages, not motion.
    try {
      video.contentHint = 'detail';
    } catch {
      /* not supported */
    }
    screenTrack = video;
    const camera = await swapTrack('video', video);
    camera?.stop(); // camera light off while the screen is on air

    // Tab or system audio, when the browser offered it and the host
    // ticked it: mixed with the microphone into the one audio track.
    const tabAudio = display.getAudioTracks()[0] ?? null;
    const mic = stream.getAudioTracks()[0] ?? null;
    if (tabAudio && mic) {
      const mix = mixAudio([mic, tabAudio]);
      if (mix) {
        micTrack = mic;
        screenAudio = tabAudio;
        audioMix = mix;
        await swapTrack('audio', mix.track);
      } else {
        tabAudio.stop();
      }
    } else {
      tabAudio?.stop();
    }

    sharing = true;
    shareLine = shareHint(video.getSettings().displaySurface);
    // Stopped from the browser's own "Stop sharing" control: back to the camera.
    video.addEventListener('ended', () => {
      if (screenTrack === video) void stopShare();
    });
    // The host is expected to be on another tab or window now: keep the
    // microphone on (see onVisibility).
    setSound(true);
    attachPreview();
    shareBusy = false;
  }

  /** Back to the camera, from the button or the browser's own control. */
  async function stopShare() {
    if (!sharing || !stream) return;
    shareBusy = true;
    sharing = false;
    const screen = screenTrack;

    // Sound: the microphone alone again.
    if (audioMix && micTrack) {
      await swapTrack('audio', micTrack);
      audioMix.close();
    }
    audioMix = null;
    micTrack = null;
    screenAudio?.stop();
    screenAudio = null;

    // Picture: open the camera first, then drop the screen, so viewers
    // never see a gap.
    try {
      const cam = (await openCamera(facing, false)).getVideoTracks()[0];
      if (!stream) {
        cam.stop();
      } else {
        await swapTrack('video', cam);
        cameraLost = false;
      }
    } catch {
      cameraLost = true;
    }
    screen?.stop();
    screenTrack = null;
    shareLine = '';
    if (stream) {
      attachPreview();
      // The camera rule again: a hidden page sends no sound.
      setSound(document.visibilityState === 'visible');
    }
    shareBusy = false;
  }

  /** Release whatever sharing holds (the screen itself is in `stream`). */
  function releaseShare() {
    audioMix?.close();
    audioMix = null;
    micTrack?.stop();
    micTrack = null;
    screenAudio?.stop();
    screenAudio = null;
    screenTrack?.stop();
    screenTrack = null;
    sharing = false;
    shareBusy = false;
    shareLine = '';
    shareError = '';
    cameraLost = false;
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
    blocked: 'This account cannot go live.',
    not_approved: 'Live hosting is rolling out.',
    terms_required: 'Please agree to the Terms of Service to go live.',
    membership_required: 'Go live is for Cook+ members.',
    live_full:
      'Too many cooks are live right now. Please try again in a few minutes.',
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
    if (termsAccepted === false) {
      askForTerms();
      return;
    }
    phase = 'starting';
    notice = '';
    // The Go live button sits below the video; bring the video (and the
    // End button on it) fully back into view now that the form is gone.
    void tick().then(() => stageEl?.scrollIntoView({ block: 'start' }));

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
      if (outcome.reason === 'terms_required') {
        // Not agreed to the current terms (or they changed): ask, then retry.
        phase = 'preview';
        termsAccepted = false;
        if (outcome.version) termsVersion = outcome.version;
        askForTerms();
        return;
      }
      if (
        outcome.reason === 'blocked' ||
        outcome.reason === 'membership_required' ||
        outcome.reason === 'not_approved'
      ) {
        // Nothing this account can do from here: close the camera and say so.
        teardown(true);
        phase = outcome.reason === 'not_approved' ? 'rollout' : outcome.reason;
        return;
      }
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
    // The note (if any) was posted before the reload: show its comments,
    // never post a second one.
    postNote = false;
    void fetchSession(session.id).then((read) => {
      if (!read || session?.id !== read.id) return;
      if (read.note_id) noteId = read.note_id;
      // The recipe is not kept across a reload on this page: take it back
      // from the session, for the name and the host's recipe panel.
      if (read.recipe_a && !recipeA) {
        recipeA = read.recipe_a;
        recipeTitle = read.title;
      }
    });
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
        everLive = true;
        policy.connected();
        phase = 'live';
        void postLiveNote();
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
    void readCount();
    watchingTimer = setInterval(() => {
      if (!document.hidden) void readCount();
    }, LIVE_WATCHING_POLL_MS);
  }

  /** "N watching": the same number the Live cards show. */
  async function readCount() {
    const id = session?.id;
    if (!id) return;
    const n = await readWatchingNow(id);
    // A failed read (null) keeps the last count: no blinking chip.
    if (n !== null && session?.id === id && phase !== 'ended') watching = watchingCount(n);
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    if (watchingTimer) clearInterval(watchingTimer);
    watchingTimer = null;
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
      // Not while sharing the screen: then the host is EXPECTED to be on
      // another tab or window, talking over it.
      if (!sharing) setSound(false);
      return;
    }
    setSound(true);
    if (!isLive) return;
    void readCount(); // back from the shared tab: a fresh count now

    // The lock is released whenever the page is hidden.
    await holdWakeLock();
    await reviveCamera();
    if (pc && pc.connectionState !== 'connected' && pc.connectionState !== 'connecting')
      policy?.failed();
  }

  /** The public watch page for this session, for the host to share. */
  $: watchUrl = session ? `${getSiteOrigin()}/live/s/${session.id}` : '';

  function onPageHide() {
    setSound(false);
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
    // Captured before teardown clears them: the ended screen's sats are
    // the note's zap total as the chat counted it.
    const sats = noteId ? zapSats : 0;
    const wasLive = everLive;
    statsLine = null;
    // This page's own clock first; the server's start time (which also
    // covers a stream resumed after a reload) replaces it when it arrives.
    liveLine = everLive && startedAt ? liveDurationLine((Date.now() - startedAt) / 1000) : null;
    teardown(true);
    let stats: LiveStats | null = null;
    if (tellServer && closing) stats = (await endLiveSessionWithStats(closing)).stats;
    // Ended elsewhere (time limit, admin, another device): the host token
    // is dead by now, so the counts are asked for with a signature.
    if (!stats && closing && wasLive) stats = await fetchLiveStats(closing.id, sign);
    if (stats && wasLive) statsLine = endedStatsLine(stats, sats);
    if (closing) {
      const read = await fetchSession(closing.id);
      if (read?.started_at) {
        const end = read.ended_at ?? Math.floor(Date.now() / 1000);
        liveLine = liveDurationLine(end - read.started_at);
      }
    }
  }

  /** Stop everything local: timers, connection, camera, wake lock. */
  function teardown(forget: boolean) {
    if (noteRetryTimer) clearTimeout(noteRetryTimer);
    noteRetryTimer = null;
    policy?.shutdown();
    policy = null;
    stopPolling();
    watching = null;
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = null;
    pc?.close();
    pc = null;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    releaseShare();
    micMuted = false;
    soundOn = true;
    if (videoEl) videoEl.srcObject = null;
    void wakeLock?.release().catch(() => undefined);
    wakeLock = null;
    if (forget) {
      clearStoredSession(storage());
      session = null;
      noteId = null;
      signedNote = null;
      noteTries = 0;
      zapSats = 0;
      zapCount = 0;
    }
  }

  async function endStored() {
    if (!session) return;
    await endLiveSession(session);
    clearStoredSession(storage());
    session = null;
    policy = null;
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

<div class="live-host" class:with-chat={!!chatItem && phase !== 'ended'}>
  {#if phase === 'loading'}
    <p class="muted">Getting ready…</p>
  {:else if phase === 'signed_out'}
    <h1>Go live</h1>
    <p class="muted">Sign in to go live.</p>
  {:else if phase === 'membership_required'}
    <h1>Go live</h1>
    <p class="muted">Going live is part of Cook+. Become a member to cook live with the community.</p>
    <a class="btn primary member-link" href={LIVE_MEMBERSHIP_PATH}>See Cook+</a>
  {:else if phase === 'rollout'}
    <h1>Live hosting is rolling out</h1>
    {#if accessView === 'sent'}
      <p class="muted" role="status">
        Request sent. We'll let you know when Go live is ready for you.
      </p>
    {:else if accessView === 'declined'}
      <p class="muted" role="status">
        Your last request wasn't approved. You can ask again from {retryDate(accessRetryAt)}.
      </p>
    {:else}
      <p class="muted">
        We're opening Go live to Cook+ members a few cooks at a time. Ask for access and we'll let
        you know when it's ready for you.
      </p>
      <label class="access-note">
        <span class="muted">What would you cook, and how often? (optional)</span>
        <textarea bind:value={accessNote} rows="3" maxlength={LIVE_ACCESS_NOTE_MAX} class="input"
        ></textarea>
      </label>
      <button
        class="btn primary member-link"
        on:click={requestAccess}
        disabled={accessSending}
      >
        {accessSending ? 'Sending…' : 'Request access'}
      </button>
      {#if accessError}<p class="muted" role="alert">{accessError}</p>{/if}
    {/if}
  {:else if phase === 'blocked'}
    <h1>Go live</h1>
    <p class="muted">This account cannot go live.</p>
  {:else if phase === 'ended'}
    <div class="ended" role="status">
      <h1>{endedMessage}</h1>
      {#if liveLine}<p class="muted">{liveLine}</p>{/if}
      {#if statsLine}<p class="muted stats">{statsLine}</p>{/if}
      <button class="btn done" on:click={leave}>Done</button>
    </div>
  {:else}
    <!-- Kept in the page (the video element must exist when the camera
         arrives) but collapsed while there is no picture to show, so the
         instructions are not pushed below an empty black box. -->
    <div
      bind:this={stageEl}
      class="stage"
      class:collapsed={!!mediaProblem && !stream}
      class:on-air={isLive || phase === 'starting'}
      class:sharing
    >
      <!-- svelte-ignore a11y-media-has-caption -->
      <video
        bind:this={videoEl}
        autoplay
        muted
        playsinline
        class:mirrored={facing === 'user' && !sharing}
      ></video>

      {#if sharing}
        <div class="share-banner" role="status">
          <MonitorArrowUpIcon size={18} weight="bold" />
          <span class="share-text">
            <strong>You're sharing your screen</strong>
            <span>{shareLine}</span>
          </span>
        </div>
      {/if}

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
          {#if micMuted}
            <span class="mic-off">· Mic off</span>
          {/if}
        </div>
      {:else if phase === 'starting'}
        <div class="badge" role="status" aria-live="polite">
          {startAttempts > 1 ? 'Still connecting…' : 'Starting…'}
        </div>
      {/if}

      {#if stream && phase !== 'resume'}
        <!-- Controls sit on the video, on a translucent bar along the bottom. -->
        <div class="overlay-bar">
          {#if !sharing}
            <button
              class="icon-btn"
              on:click={flip}
              disabled={!stream || flipping}
              aria-label="Flip camera"
              title="Flip camera"
            >
              <CameraRotateIcon size={20} weight="bold" />
            </button>
          {/if}
          <button
            class="icon-btn"
            class:muted-mic={micMuted}
            on:click={toggleMute}
            aria-pressed={micMuted}
            aria-label={micMuted ? 'Unmute microphone' : 'Mute microphone'}
            title={micMuted ? 'Unmute microphone' : 'Mute microphone'}
          >
            {#if micMuted}
              <MicrophoneSlashIcon size={20} weight="bold" />
            {:else}
              <MicrophoneIcon size={20} weight="bold" />
            {/if}
          </button>
          {#if shareSupported}
            <!-- Desktop only. Swaps the picture on the same connection:
                 viewers stay connected. -->
            <button
              class="share-btn"
              class:active={sharing}
              on:click={sharing ? stopShare : startShare}
              disabled={shareBusy}
              aria-pressed={sharing}
              title={sharing
                ? 'Go back to your camera'
                : 'Share one window or tab, not your whole screen'}
            >
              <MonitorArrowUpIcon size={18} weight="bold" />
              {sharing ? 'Stop sharing' : 'Share screen'}
            </button>
          {/if}
          {#if isLive || phase === 'starting'}
            {#if session}
              <!-- Phones: the share sheet. Desktop: Copy link / Share on Nostr. -->
              <LiveShareButton url={watchUrl} title={title} variant="icon" tone="glass" up />
            {/if}
            <span class="spacer"></span>
            <!-- Never disabled while starting: if the first publish cannot get
                 through, End is the only way out short of closing the tab. -->
            <button class="end-btn" on:click={end} disabled={ending}>End</button>
          {/if}
        </div>
      {/if}
      {#if isLive && !lockHintDismissed && !sharing}
        <!-- Shown until dismissed, once per device. -->
        <p class="hint">
          <span>Locking your phone or leaving this page pauses your picture and sound.</span>
          <button class="hint-close" on:click={dismissLockHint} aria-label="Dismiss tip">
            <XIcon size={12} weight="bold" />
          </button>
        </p>
      {/if}
    </div>

    {#if shareError}
      <p class="notice" role="alert">{shareError}</p>
    {/if}
    {#if cameraLost && !sharing}
      <div class="notice camera-lost" role="alert">
        <span>Your camera didn't come back after sharing. Viewers can still hear you.</span>
        <button class="btn" on:click={reviveCamera}>Turn the camera back on</button>
      </div>
    {/if}

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
        <p class="muted">{streamName}</p>
        <div class="actions">
          <button class="btn primary" on:click={resume}>Resume</button>
          <button class="btn" on:click={endStored}>End</button>
        </div>
      </div>
    {:else if phase === 'preview'}
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

        <label class="switch-row">
          <input type="checkbox" role="switch" bind:checked={postNote} />
          <span class="switch-text">
            <strong>Post a “Live now” note</strong>
            <span class="muted small">
              {#if postNote}
                Posts “{streamName}” from your account with the watch link. Viewers comment by
                replying to it.
              {:else}
                No note: this stream will have no comments and no zap total.
              {/if}
            </span>
          </span>
        </label>

        {#if notice}<p class="notice" role="status">{notice}</p>{/if}

        <button class="btn primary" on:click={goLive} disabled={!canStart}>Go live</button>
        <p class="muted small">Live streams end by themselves after 90 minutes.</p>
      </div>
    {:else}
      <div class="panel live-panel">
        <p class="live-title" title={streamName}>{streamName}</p>
        {#if watching}
          <p class="watching" role="status">{watchingLabel(watching)}</p>
        {/if}
        {#if zapCount > 0}
          <p class="zaps" title={`${zapSats.toLocaleString()} sats across ${zapCount} zaps`}>
            ⚡ {zapSats.toLocaleString()} sats · {zapCount}
            {zapCount === 1 ? 'zap' : 'zaps'}
          </p>
        {/if}
        {#if notice}<p class="notice" role="status">{notice}</p>{/if}
        {#if !noteId && notePosting}
          <p class="muted small" role="status">Posting your Live now note…</p>
        {/if}
      </div>
      {#if !hostWide && chatItem && chatPool && noteId && recipeA}
        <div class="tabs" role="tablist" aria-label="Live panels">
          <button
            type="button"
            role="tab"
            aria-selected={hostTab === 'chat'}
            class:active={hostTab === 'chat'}
            on:click={() => (hostTab = 'chat')}>Chat</button
          >
          <button
            type="button"
            role="tab"
            aria-selected={hostTab === 'recipe'}
            class:active={hostTab === 'recipe'}
            on:click={() => (hostTab = 'recipe')}>Recipe</button
          >
        </div>
      {/if}
      {#if recipeA && (phase === 'live' || phase === 'reconnecting') && (hostWide || !(chatItem && noteId) || hostTab === 'recipe')}
        <section class="host-recipe" aria-label="Recipe">
          <RecipePanel recipe={recipeEvent} loading={!recipeEvent} />
        </section>
      {/if}
      {#if chatItem && chatPool && noteId && (hostWide || !recipeA || hostTab === 'chat')}
        <!-- The stream's comments: replies to the Live now note. -->
        <section class="host-chat" aria-label="Live chat">
          {#key noteId}
            <StreamChat
              item={chatItem}
              pool={chatPool}
              target={noteId}
              on:zaps={(e) => {
                zapSats = Math.max(zapSats, e.detail.sats);
                zapCount = Math.max(zapCount, e.detail.count);
              }}
            />
          {/key}
        </section>
      {/if}
    {/if}
  {/if}
</div>

<Modal bind:open={termsDialogOpen} locked noHeader compact autoHeight>
  <div class="age">
    <h2>Before you go live</h2>
    <p>
      You must be 18 or older to host. Live streams follow our
      <a href="/terms" target="_blank" rel="noopener noreferrer" class="link">Terms of Service</a>,
      including the Live Stream Conduct rules.
    </p>
    {#if termsError}
      <p class="small" role="alert">{termsError}</p>
    {/if}
    <div class="actions">
      <button class="btn" on:click={notNow} disabled={termsBusy}>Not now</button>
      <button class="btn primary" on:click={agreeToTerms} disabled={termsBusy}>
        {termsBusy ? 'Saving…' : "I'm 18+, agree and go live"}
      </button>
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
    width: 100%;
    max-width: 56rem;
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
  /*
   * The stage. Its width is always the full column (width: 100%), and its
   * height is set explicitly rather than derived from an aspect ratio: an
   * aspect ratio capped by max-height made Safari shrink the WIDTH to keep
   * the ratio, which left the video left-aligned with a gap on the right.
   * The video inside is `contain`, so the host sees exactly the frame
   * viewers get, on black.
   */
  .stage {
    position: relative;
    width: 100%;
    scroll-margin-top: var(--header-h, 4rem);
    background: #000;
    border-radius: 0.75rem;
    overflow: hidden;
    /* Desktop: as tall as the window allows, leaving room for the panel. */
    height: min(calc(100dvh - var(--header-h, 4rem) - 13rem), 42rem);
    min-height: 16rem;
  }
  .stage.on-air {
    height: min(calc(100dvh - var(--header-h, 4rem) - 6rem), 48rem);
  }
  @media (max-width: 640px) {
    /* Phones: edge to edge (cancel the page's 1rem side padding) and most
       of the height. The bottom nav (4rem plus the home bar) stays below. */
    .live-host {
      width: calc(100% + 2rem);
      max-width: none;
      margin: -0.75rem -1rem 0;
      gap: 0.75rem;
    }
    .stage {
      border-radius: 0;
      height: calc(
        100dvh - var(--header-h, 4rem) - 4rem - env(safe-area-inset-bottom, 0px) - 22rem
      );
      min-height: 14rem;
    }
    .stage.on-air {
      height: calc(
        100dvh - var(--header-h, 4rem) - 4rem - env(safe-area-inset-bottom, 0px) - 3.5rem
      );
    }
    .panel,
    .help,
    .ended {
      padding: 0 1rem;
    }
  }
  @media (orientation: landscape) and (max-height: 500px) {
    /* A phone on its side: edge to edge, the full height between the
       header and the bottom nav; the title scrolls below it. */
    .live-host {
      width: calc(100% + 2rem);
      max-width: none;
      margin: -0.75rem -1rem 0;
    }
    .stage,
    .stage.on-air {
      height: calc(100dvh - var(--header-h, 4rem) - 4rem - env(safe-area-inset-bottom, 0px));
      min-height: 11rem;
      border-radius: 0;
    }
    .panel,
    .help,
    .ended {
      padding: 0 max(1rem, env(safe-area-inset-left, 0px));
    }
  }
  .stage.collapsed {
    display: none;
  }
  video {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }
  video.mirrored {
    transform: scaleX(-1);
  }
  .badge {
    position: absolute;
    top: 0.75rem;
    left: max(0.75rem, env(safe-area-inset-left, 0px));
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
  .overlay-bar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 1.5rem max(0.75rem, env(safe-area-inset-right, 0px)) 0.75rem
      max(0.75rem, env(safe-area-inset-left, 0px));
    background: linear-gradient(to top, rgba(0, 0, 0, 0.6), rgba(0, 0, 0, 0));
  }
  .spacer {
    flex: 1;
  }
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.75rem;
    height: 2.75rem;
    border-radius: 9999px;
    color: #fff;
    background: rgba(255, 255, 255, 0.18);
    border: 1px solid rgba(255, 255, 255, 0.25);
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
  }
  .icon-btn:disabled {
    opacity: 0.5;
  }
  /* Muted: hard to miss. */
  .icon-btn.muted-mic {
    background: #fff;
    color: #dc2626;
    border-color: #fff;
  }
  .mic-off {
    color: #fca5a5;
  }
  .share-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    min-height: 2.75rem;
    padding: 0 1rem;
    border-radius: 9999px;
    color: #fff;
    font-weight: 600;
    font-size: 0.875rem;
    background: rgba(255, 255, 255, 0.18);
    border: 1px solid rgba(255, 255, 255, 0.25);
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
  }
  .share-btn.active {
    background: #fff;
    color: #111;
    border-color: #fff;
  }
  .share-btn:disabled {
    opacity: 0.6;
  }
  /* "You're sharing your screen": across the top of the picture, the
     Live badge moves down under it. */
  .share-banner {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.55rem 0.9rem;
    background: #1d4ed8;
    color: #fff;
    font-size: 0.8125rem;
    line-height: 1.3;
  }
  .share-text {
    display: flex;
    flex-wrap: wrap;
    column-gap: 0.6rem;
  }
  .share-text span {
    opacity: 0.9;
  }
  .stage.sharing .badge {
    top: 3.25rem;
  }
  .camera-lost {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
  }
  .end-btn {
    min-height: 2.75rem;
    padding: 0 1.4rem;
    border-radius: 9999px;
    background: #dc2626;
    color: #fff;
    font-weight: 700;
    letter-spacing: 0.01em;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
  }
  .end-btn:disabled {
    opacity: 0.6;
  }
  .live-panel {
    gap: 0.5rem;
  }
  .watching {
    font-size: 0.875rem;
    font-weight: 600;
  }
  .zaps {
    font-size: 0.875rem;
    font-weight: 600;
    color: #f59e0b;
  }
  .switch-row {
    display: flex;
    align-items: flex-start;
    gap: 0.65rem;
    padding: 0.65rem 0.75rem;
    border-radius: 0.75rem;
    background: var(--color-input-bg);
    border: 1px solid var(--color-input-border);
    cursor: pointer;
  }
  .switch-row input {
    margin-top: 0.2rem;
    width: 1.1rem;
    height: 1.1rem;
    accent-color: #dc2626;
    /* The forms plugin paints a checked box with currentColor. */
    color: #dc2626;
    flex-shrink: 0;
  }
  .switch-text {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    font-size: 0.9375rem;
  }
  .host-chat {
    height: 26rem;
    min-height: 18rem;
  }
  .tabs {
    display: flex;
    gap: 0.25rem;
    padding: 0.25rem;
    border-radius: 9999px;
    background: var(--color-input-bg);
    border: 1px solid var(--color-input-border);
    align-self: flex-start;
    margin: 0 1rem;
  }
  .tabs button {
    padding: 0.35rem 1rem;
    border-radius: 9999px;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-caption);
  }
  .tabs button.active {
    background: var(--color-text-primary);
    color: var(--color-bg-primary);
  }
  @media (max-width: 640px) {
    .host-recipe {
      padding: 0 0.75rem;
    }
  }
  @media (max-width: 640px) {
    .host-chat {
      padding: 0 0.75rem;
    }
  }
  /* Wide screens: the comments sit beside the video, as tall as the stage. */
  @media (min-width: 1100px) {
    .live-host.with-chat {
      max-width: 90rem;
      display: grid;
      grid-template-columns: minmax(0, 1fr) 23rem;
      column-gap: 1rem;
      align-items: start;
    }
    .live-host.with-chat > :not(.host-chat) {
      grid-column: 1;
    }
    .live-host.with-chat .host-chat {
      grid-column: 2;
      grid-row: 1 / span 4;
      height: min(calc(100dvh - var(--header-h, 4rem) - 6rem), 48rem);
    }
  }
  .hint {
    position: absolute;
    top: 3.1rem;
    left: max(0.75rem, env(safe-area-inset-left, 0px));
    right: max(0.75rem, env(safe-area-inset-right, 0px));
    max-width: 22rem;
    display: flex;
    align-items: flex-start;
    gap: 0.4rem;
    padding: 0.35rem 0.4rem 0.35rem 0.65rem;
    border-radius: 0.6rem;
    background: rgba(0, 0, 0, 0.55);
    color: rgba(255, 255, 255, 0.9);
    font-size: 0.6875rem;
    line-height: 1.35;
  }
  .hint-close {
    flex-shrink: 0;
    padding: 0.2rem;
    border-radius: 9999px;
    color: #fff;
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
  /* Centered, with ordinary page padding on every width. Declared with the
     padding here (not in the phone rule above) so nothing overrides it. */
  .live-host .ended {
    align-items: center;
    text-align: center;
    gap: 0.5rem;
    padding: 3rem 1rem;
  }
  .ended .done {
    margin-top: 1rem;
    min-width: 9rem;
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
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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
    border: 0;
    background: #dc2626;
    color: #fff;
  }
  .access-note {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    max-width: 32rem;
  }
  .member-link {
    display: inline-flex;
    align-items: center;
    align-self: flex-start;
    text-decoration: none;
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
