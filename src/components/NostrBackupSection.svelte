<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { ndk, userPublickey } from '$lib/nostr';
	import { hasEncryptionSupport } from '$lib/encryptionService';
	import {
		backupFollows,
		listFollowsBackups,
		restoreFollowsFromBackup,
		backupMuteList,
		listMuteListBackups,
		restoreMuteListFromBackup,
		checkBackupRelayStatus,
		BACKUP_D_TAGS,
		type BackupType,
		type FollowsBackupData,
		type MuteBackupData,
		type BackupInfo,
		type RelayBackupStatus
	} from '$lib/nostrBackup';
	import {
		backupProfile,
		restoreProfileFromBackup,
		listProfileBackups,
		type ProfileBackupData
	} from '$lib/profileBackup';
	import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircle';
	import XCircleIcon from 'phosphor-svelte/lib/XCircle';
	import WarningIcon from 'phosphor-svelte/lib/Warning';
	import CloudArrowUpIcon from 'phosphor-svelte/lib/CloudArrowUp';
	import CloudArrowDownIcon from 'phosphor-svelte/lib/CloudArrowDown';
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDown';
	import ArrowClockwiseIcon from 'phosphor-svelte/lib/ArrowClockwise';
	import ClockCounterClockwiseIcon from 'phosphor-svelte/lib/ClockCounterClockwise';
	import WalletIcon from 'phosphor-svelte/lib/Wallet';
	import { activeWallet } from '$lib/wallet/walletStore';
	import { checkRelayBackups as checkSparkRelayBackups } from '$lib/spark';
	import { checkRelayBackups as checkNwcRelayBackups } from '$lib/wallet/nwcBackup';

	// ── State ──

	interface BackupStatus {
		exists: boolean;
		timestamp: number | null;
		relayStatuses: RelayBackupStatus[];
		loading: boolean;
		error: string | null;
		backupCount: number;
		itemCount?: number;
	}

	let statuses: Record<BackupType, BackupStatus> = {
		follows: { exists: false, timestamp: null, relayStatuses: [], loading: false, error: null, backupCount: 0 },
		mute: { exists: false, timestamp: null, relayStatuses: [], loading: false, error: null, backupCount: 0 },
		profile: { exists: false, timestamp: null, relayStatuses: [], loading: false, error: null, backupCount: 0 }
	};

	let backingUp: Record<BackupType, boolean> = { follows: false, mute: false, profile: false };
	let restoring: Record<BackupType, boolean> = { follows: false, mute: false, profile: false };
	let messages: Record<BackupType, { text: string; type: 'success' | 'error' } | null> = {
		follows: null,
		mute: null,
		profile: null
	};
	let expandedType: BackupType | null = null;
	let versionsExpanded: Record<BackupType, boolean> = { follows: false, mute: false, profile: false };

	// Wallet backup state (view-only) — check both types independently
	interface WalletBackupInfo {
		loading: boolean;
		exists: boolean;
		timestamp: number | null;
		relayStatuses: RelayBackupStatus[];
		error: string | null;
	}
	const emptyWalletStatus: WalletBackupInfo = { loading: false, exists: false, timestamp: null, relayStatuses: [], error: null };
	let sparkBackupStatus: WalletBackupInfo = { ...emptyWalletStatus };
	let nwcBackupStatus: WalletBackupInfo = { ...emptyWalletStatus };
	let walletRelaysExpanded: Record<string, boolean> = { spark: false, nwc: false };

	// Cached backup lists for version picker
	let followsBackups: BackupInfo<FollowsBackupData>[] = [];
	let muteBackups: BackupInfo<MuteBackupData>[] = [];
	let profileBackups: Array<{ timestamp: number; eventId: string; createdAt: number; data?: ProfileBackupData }> = [];

	$: canEncrypt = browser ? hasEncryptionSupport() : false;

	// ── Lifecycle ──

	onMount(async () => {
		if (!browser || !$userPublickey) return;
		await checkAllStatuses();
	});

	// ── Status Checks ──

	async function checkAllStatuses() {
		await Promise.all([checkFollowsStatus(), checkMuteStatus(), checkProfileStatus(), checkWalletStatus()]);
	}

	async function checkFollowsStatus() {
		statuses.follows.loading = true;
		statuses.follows.error = null;
		statuses = statuses;

		try {
			followsBackups = await listFollowsBackups($ndk, $userPublickey);
			const newest = followsBackups.length > 0 && followsBackups[0].data ? followsBackups[0].data : null;

			const relayStatuses = await checkBackupRelayStatus(
				$ndk,
				$userPublickey,
				BACKUP_D_TAGS.follows as unknown as string[]
			);

			statuses.follows = {
				exists: followsBackups.length > 0,
				timestamp: newest?.timestamp || null,
				relayStatuses,
				loading: false,
				error: null,
				backupCount: followsBackups.length,
				itemCount: newest?.follows.length
			};
		} catch (e: any) {
			statuses.follows.loading = false;
			statuses.follows.error = e.message || 'Failed to check follows backup';
		}
		statuses = statuses;
	}

	async function checkMuteStatus() {
		statuses.mute.loading = true;
		statuses.mute.error = null;
		statuses = statuses;

		try {
			muteBackups = await listMuteListBackups($ndk, $userPublickey);
			const newest = muteBackups.length > 0 && muteBackups[0].data ? muteBackups[0].data : null;

			const relayStatuses = await checkBackupRelayStatus(
				$ndk,
				$userPublickey,
				BACKUP_D_TAGS.mute as unknown as string[]
			);

			const itemCount = newest
				? newest.muteList.pubkeys.length +
					newest.muteList.words.length +
					newest.muteList.tags.length +
					newest.muteList.threads.length
				: undefined;

			statuses.mute = {
				exists: muteBackups.length > 0,
				timestamp: newest?.timestamp || null,
				relayStatuses,
				loading: false,
				error: null,
				backupCount: muteBackups.length,
				itemCount
			};
		} catch (e: any) {
			statuses.mute.loading = false;
			statuses.mute.error = e.message || 'Failed to check mute list backup';
		}
		statuses = statuses;
	}

	async function checkProfileStatus() {
		statuses.profile.loading = true;
		statuses.profile.error = null;
		statuses = statuses;

		try {
			profileBackups = await listProfileBackups($ndk, $userPublickey);

			const relayStatuses = await checkBackupRelayStatus(
				$ndk,
				$userPublickey,
				BACKUP_D_TAGS.profile as unknown as string[]
			);

			statuses.profile = {
				exists: profileBackups.length > 0,
				timestamp: profileBackups.length > 0 ? profileBackups[0].timestamp : null,
				relayStatuses,
				loading: false,
				error: null,
				backupCount: profileBackups.length
			};
		} catch (e: any) {
			statuses.profile.loading = false;
			statuses.profile.error = e.message || 'Failed to check profile backup';
		}
		statuses = statuses;
	}

	async function checkWalletStatus() {
		await Promise.all([checkSparkBackupStatus(), checkNwcBackupStatus()]);
	}

	async function checkSingleWalletBackup(
		checkFn: (pubkey: string) => Promise<RelayBackupStatus[]>
	): Promise<WalletBackupInfo> {
		try {
			const relayStatuses = await checkFn($userPublickey);
			const hasBackup = relayStatuses.some((r) => r.hasBackup);
			let latestTimestamp: number | null = null;
			for (const r of relayStatuses) {
				if (r.hasBackup && r.timestamp && (!latestTimestamp || r.timestamp > latestTimestamp)) {
					latestTimestamp = r.timestamp;
				}
			}
			return { loading: false, exists: hasBackup, timestamp: latestTimestamp, relayStatuses, error: null };
		} catch (e: any) {
			return { loading: false, exists: false, timestamp: null, relayStatuses: [], error: e.message || 'Check failed' };
		}
	}

	async function checkSparkBackupStatus() {
		sparkBackupStatus = { ...emptyWalletStatus, loading: true };
		sparkBackupStatus = await checkSingleWalletBackup(checkSparkRelayBackups);
	}

	async function checkNwcBackupStatus() {
		nwcBackupStatus = { ...emptyWalletStatus, loading: true };
		nwcBackupStatus = await checkSingleWalletBackup(checkNwcRelayBackups);
	}

	// ── Backup Actions ──

	async function handleBackup(type: BackupType) {
		backingUp[type] = true;
		messages[type] = null;

		try {
			switch (type) {
				case 'follows':
					await backupFollows($ndk, $userPublickey);
					break;
				case 'mute':
					await backupMuteList($ndk, $userPublickey);
					break;
				case 'profile': {
					const profileEvent = await $ndk.fetchEvent({
						kinds: [0],
						authors: [$userPublickey]
					});
					if (profileEvent) {
						await backupProfile($ndk, $userPublickey, JSON.parse(profileEvent.content));
					} else {
						throw new Error('No profile found to back up');
					}
					break;
				}
			}
			messages[type] = { text: 'Backup created successfully', type: 'success' };
			switch (type) {
				case 'follows':
					await checkFollowsStatus();
					break;
				case 'mute':
					await checkMuteStatus();
					break;
				case 'profile':
					await checkProfileStatus();
					break;
			}
		} catch (e: any) {
			messages[type] = { text: e.message || 'Backup failed', type: 'error' };
		} finally {
			backingUp[type] = false;
		}
	}

	// ── Restore Actions ──

	async function handleRestore(type: BackupType, index: number = 0) {
		const labels: Record<BackupType, string> = {
			follows: 'follow list',
			mute: 'mute list',
			profile: 'profile'
		};
		const versionLabel = index > 0 ? ` from backup #${index + 1}` : '';
		if (!confirm(`Restore your ${labels[type]}${versionLabel}? This will replace your current ${labels[type]}.`))
			return;

		restoring[type] = true;
		messages[type] = null;

		try {
			switch (type) {
				case 'follows': {
					const backup = followsBackups[index]?.data;
					if (backup) {
						await restoreFollowsFromBackup($ndk, $userPublickey, backup);
					} else {
						throw new Error('No backup data available to restore');
					}
					break;
				}
				case 'mute': {
					const backup = muteBackups[index]?.data;
					if (backup) {
						await restoreMuteListFromBackup($ndk, $userPublickey, backup);
					} else {
						throw new Error('No backup data available to restore');
					}
					break;
				}
				case 'profile': {
					const backup = profileBackups[index]?.data;
					if (backup) {
						await restoreProfileFromBackup($ndk, $userPublickey, backup);
					} else {
						throw new Error('No backup data available to restore');
					}
					break;
				}
			}
			messages[type] = { text: 'Restored successfully', type: 'success' };
		} catch (e: any) {
			messages[type] = { text: e.message || 'Restore failed', type: 'error' };
		} finally {
			restoring[type] = false;
		}
	}

	// ── Helpers ──

	function toggleRelayDetails(type: BackupType) {
		expandedType = expandedType === type ? null : type;
	}

	function toggleVersions(type: BackupType) {
		versionsExpanded[type] = !versionsExpanded[type];
	}

	function formatTimestamp(ts: number | null): string {
		if (!ts) return '';
		const now = Date.now();
		const diff = now - ts;

		if (diff < 60 * 1000) return 'just now';
		if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}m ago`;
		if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)}h ago`;
		if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / 86400000)}d ago`;
		return new Date(ts).toLocaleDateString();
	}

	function formatFullTimestamp(ts: number): string {
		const date = new Date(ts);
		return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}

	function formatRelayTimestamp(ts: number | undefined): string {
		if (!ts) return '';
		return new Date(ts).toLocaleDateString();
	}

	function getRelayDisplayName(relayUrl: string): string {
		try {
			return new URL(relayUrl).hostname;
		} catch {
			return relayUrl;
		}
	}

	function relayBackupCount(statuses: RelayBackupStatus[]): number {
		return statuses.filter((r) => r.hasBackup).length;
	}

	function getVersionSummary(type: BackupType, index: number): string {
		switch (type) {
			case 'follows': {
				const b = followsBackups[index]?.data;
				return b ? `${b.follows.length} follows` : '';
			}
			case 'mute': {
				const b = muteBackups[index]?.data;
				if (!b) return '';
				const count = b.muteList.pubkeys.length + b.muteList.words.length + b.muteList.tags.length + b.muteList.threads.length;
				return `${count} items`;
			}
			case 'profile':
				return '';
			default:
				return '';
		}
	}

	function getBackupList(type: BackupType): Array<{ timestamp: number; data?: any }> {
		switch (type) {
			case 'follows':
				return followsBackups;
			case 'mute':
				return muteBackups;
			case 'profile':
				return profileBackups;
		}
	}

	const typeLabels: Record<BackupType, { label: string; kind: string }> = {
		follows: { label: 'Follows', kind: 'kind:3' },
		mute: { label: 'Mute List', kind: 'kind:10000' },
		profile: { label: 'Profile', kind: 'kind:0' }
	};

	const types: BackupType[] = ['follows', 'mute', 'profile'];
</script>

<div class="flex flex-col gap-4">
	<p class="text-xs text-caption">
		Back up your social graph to Nostr relays using encrypted NIP-78 events. Only you can decrypt
		these backups.
	</p>

	{#if !canEncrypt}
		<div
			class="p-3 rounded-lg flex items-center gap-2 text-sm"
			style="background-color: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); color: var(--color-text-primary);"
		>
			<WarningIcon size={18} class="text-amber-500 flex-shrink-0" />
			<span class="text-xs"
				>Encryption is required for backups. Sign in with nsec, NIP-07, or NIP-46 to enable.</span
			>
		</div>
	{/if}

	{#each types as type}
		{@const status = statuses[type]}
		{@const info = typeLabels[type]}
		{@const hasRelays = status.relayStatuses.length > 0}
		{@const backupRelays = relayBackupCount(status.relayStatuses)}
		{@const backupList = getBackupList(type)}

		<div
			class="rounded-lg border overflow-hidden"
			style="border-color: var(--color-input-border); background-color: var(--color-bg-primary);"
		>
			<!-- Header -->
			<div class="px-4 py-3">
				<div class="flex items-center justify-between mb-1">
					<div class="flex items-center gap-2">
						<span class="text-sm font-medium" style="color: var(--color-text-primary)"
							>{info.label}</span
						>
						<span class="text-xs text-caption font-mono">{info.kind}</span>
					</div>
				</div>

				<!-- Status line -->
				<div class="flex items-center gap-1.5 mb-3">
					{#if status.loading}
						<div
							class="w-3 h-3 border-2 border-primary-color border-t-transparent rounded-full animate-spin"
						></div>
						<span class="text-xs text-caption">Checking...</span>
					{:else if status.error}
						<WarningIcon size={14} class="text-amber-500" />
						<span class="text-xs text-amber-500">{status.error}</span>
					{:else if status.exists}
						<CheckCircleIcon size={14} class="text-green-500" weight="fill" />
						<span class="text-xs text-caption">
							{status.backupCount} backup{status.backupCount !== 1 ? 's' : ''}
							{#if status.itemCount !== undefined}
								&middot; {status.itemCount} items
							{/if}
							{#if status.timestamp}
								&middot; {formatTimestamp(status.timestamp)}
							{/if}
							{#if hasRelays}
								&middot; {backupRelays}/{status.relayStatuses.length} relays
							{/if}
						</span>
					{:else}
						<XCircleIcon size={14} class="text-caption" />
						<span class="text-xs text-caption">No backup found</span>
					{/if}
				</div>

				<!-- Actions -->
				<div class="flex items-center gap-2 flex-wrap">
					<button
						class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
						style="background-color: var(--color-primary); color: #ffffff;"
						disabled={!canEncrypt || backingUp[type]}
						on:click={() => handleBackup(type)}
					>
						{#if backingUp[type]}
							<div
								class="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"
							></div>
							Backing up...
						{:else}
							<CloudArrowUpIcon size={14} />
							Backup Now
						{/if}
					</button>

					<button
						class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
						style="background-color: var(--color-bg-secondary); color: var(--color-text-primary); border: 1px solid var(--color-input-border);"
						disabled={!status.exists || !canEncrypt || restoring[type]}
						on:click={() => handleRestore(type)}
					>
						{#if restoring[type]}
							<div
								class="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"
							></div>
							Restoring...
						{:else}
							<CloudArrowDownIcon size={14} />
							Restore
						{/if}
					</button>

					{#if status.backupCount > 1}
						<button
							class="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs transition-colors hover:bg-[var(--color-bg-secondary)]"
							style="color: var(--color-caption);"
							on:click={() => toggleVersions(type)}
						>
							<ClockCounterClockwiseIcon size={12} />
							<CaretDownIcon
								size={10}
								class="transition-transform duration-200 {versionsExpanded[type]
									? 'rotate-180'
									: ''}"
							/>
							Versions
						</button>
					{/if}

					{#if hasRelays}
						<button
							class="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs transition-colors hover:bg-[var(--color-bg-secondary)]"
							style="color: var(--color-caption);"
							on:click={() => toggleRelayDetails(type)}
						>
							<CaretDownIcon
								size={12}
								class="transition-transform duration-200 {expandedType === type
									? 'rotate-180'
									: ''}"
							/>
							Relays
						</button>
					{/if}
				</div>

				<!-- Message -->
				{#if messages[type]}
					<div
						class="mt-2 text-xs px-2 py-1 rounded"
						class:text-green-600={messages[type]?.type === 'success'}
						class:text-red-500={messages[type]?.type === 'error'}
						style="background-color: {messages[type]?.type === 'success'
							? 'rgba(34, 197, 94, 0.1)'
							: 'rgba(239, 68, 68, 0.1)'};"
					>
						{messages[type]?.text}
					</div>
				{/if}
			</div>

			<!-- Version List (expandable) -->
			{#if versionsExpanded[type] && backupList.length > 0}
				<div
					class="px-4 pb-3 pt-2 border-t flex flex-col gap-1.5"
					style="border-color: var(--color-input-border);"
				>
					{#each backupList as backup, i}
						<div
							class="flex items-center justify-between text-xs p-2 rounded-lg"
							style="background-color: var(--color-bg-secondary);"
						>
							<div class="flex items-center gap-2 min-w-0">
								<span class="text-caption flex-shrink-0">#{i + 1}</span>
								<span class="truncate" style="color: var(--color-text-primary);">
									{formatFullTimestamp(backup.timestamp)}
								</span>
								{#if getVersionSummary(type, i)}
									<span class="text-caption flex-shrink-0">&middot; {getVersionSummary(type, i)}</span>
								{/if}
							</div>
							<button
								class="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors hover:opacity-80 flex-shrink-0 ml-2"
								style="color: var(--color-primary);"
								disabled={!backup.data || restoring[type]}
								on:click={() => handleRestore(type, i)}
							>
								<CloudArrowDownIcon size={12} />
								Restore
							</button>
						</div>
					{/each}
				</div>
			{/if}

			<!-- Relay Details (expandable) -->
			{#if expandedType === type && hasRelays}
				<div
					class="px-4 pb-3 pt-2 border-t flex flex-col gap-1.5"
					style="border-color: var(--color-input-border);"
				>
					{#each status.relayStatuses as relay}
						<div class="flex items-center justify-between text-xs">
							<div class="flex items-center gap-1.5 min-w-0">
								{#if relay.hasBackup}
									<CheckCircleIcon size={12} class="text-green-500 flex-shrink-0" weight="fill" />
								{:else if relay.error}
									<WarningIcon size={12} class="text-amber-500 flex-shrink-0" weight="fill" />
								{:else}
									<XCircleIcon size={12} class="text-caption flex-shrink-0" />
								{/if}
								<span class="truncate font-mono text-caption"
									>{getRelayDisplayName(relay.relay)}</span
								>
							</div>
							<span class="text-caption flex-shrink-0 ml-2">
								{#if relay.hasBackup && relay.timestamp}
									{formatRelayTimestamp(relay.timestamp)}
								{:else if relay.error}
									<span class="text-amber-500">{relay.error}</span>
								{:else}
									—
								{/if}
							</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/each}

	<!-- Wallet Backups (view-only) — show each type that has a backup -->
	{#each [{ key: 'spark', label: 'Spark Wallet', status: sparkBackupStatus }, { key: 'nwc', label: 'NWC Wallet', status: nwcBackupStatus }] as wallet (wallet.key)}
		{#if wallet.status.loading || wallet.status.exists}
			<div
				class="rounded-lg border overflow-hidden"
				style="border-color: var(--color-input-border); background-color: var(--color-bg-primary);"
			>
				<div class="px-4 py-3">
					<div class="flex items-center justify-between mb-1">
						<div class="flex items-center gap-2">
							<span class="text-sm font-medium" style="color: var(--color-text-primary);"
								>{wallet.label}</span
							>
						</div>
					</div>

					<!-- Status line -->
					<div class="flex items-center gap-1.5 mb-3">
						{#if wallet.status.loading}
							<div
								class="w-3 h-3 border-2 border-primary-color border-t-transparent rounded-full animate-spin"
							></div>
							<span class="text-xs text-caption">Checking...</span>
						{:else if wallet.status.error}
							<WarningIcon size={14} class="text-amber-500" />
							<span class="text-xs text-amber-500">{wallet.status.error}</span>
						{:else if wallet.status.exists}
							<CheckCircleIcon size={14} class="text-green-500" weight="fill" />
							<span class="text-xs text-caption">
								Backed up
								{#if wallet.status.timestamp}
									&middot; {formatTimestamp(wallet.status.timestamp)}
								{/if}
								&middot; {relayBackupCount(wallet.status.relayStatuses)}/{wallet.status.relayStatuses.length} relays
							</span>
						{/if}
					</div>

					<!-- Info + relay toggle -->
					<div class="flex items-center gap-2 flex-wrap">
						<span class="text-xs text-caption flex items-center gap-1.5">
							<WalletIcon size={14} />
							Manage in Wallet
						</span>

						{#if wallet.status.relayStatuses.length > 0}
							<button
								class="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs transition-colors hover:bg-[var(--color-bg-secondary)]"
								style="color: var(--color-caption);"
								on:click={() => (walletRelaysExpanded[wallet.key] = !walletRelaysExpanded[wallet.key])}
							>
								<CaretDownIcon
									size={12}
									class="transition-transform duration-200 {walletRelaysExpanded[wallet.key] ? 'rotate-180' : ''}"
								/>
								Relays
							</button>
						{/if}
					</div>
				</div>

				<!-- Relay Details (expandable) -->
				{#if walletRelaysExpanded[wallet.key] && wallet.status.relayStatuses.length > 0}
					<div
						class="px-4 pb-3 pt-2 border-t flex flex-col gap-1.5"
						style="border-color: var(--color-input-border);"
					>
						{#each wallet.status.relayStatuses as relay}
							<div class="flex items-center justify-between text-xs">
								<div class="flex items-center gap-1.5 min-w-0">
									{#if relay.hasBackup}
										<CheckCircleIcon size={12} class="text-green-500 flex-shrink-0" weight="fill" />
									{:else if relay.error}
										<WarningIcon size={12} class="text-amber-500 flex-shrink-0" weight="fill" />
									{:else}
										<XCircleIcon size={12} class="text-caption flex-shrink-0" />
									{/if}
									<span class="truncate font-mono text-caption"
										>{getRelayDisplayName(relay.relay)}</span
									>
								</div>
								<span class="text-caption flex-shrink-0 ml-2">
									{#if relay.hasBackup && relay.timestamp}
										{formatRelayTimestamp(relay.timestamp)}
									{:else if relay.error}
										<span class="text-amber-500">{relay.error}</span>
									{:else}
										—
									{/if}
								</span>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	{/each}

	<!-- Refresh all -->
	<button
		class="flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs transition-colors hover:opacity-80"
		style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border); color: var(--color-text-primary);"
		on:click={checkAllStatuses}
		disabled={statuses.follows.loading || statuses.mute.loading || statuses.profile.loading}
	>
		<ArrowClockwiseIcon
			size={14}
			class={statuses.follows.loading || statuses.mute.loading || statuses.profile.loading
				? 'animate-spin'
				: ''}
		/>
		Refresh All
	</button>
</div>
