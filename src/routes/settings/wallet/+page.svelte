<script lang="ts">
	import { onDestroy, onMount } from 'svelte'
	import { get } from 'svelte/store'
	import {
		breezSdk,
		lightningAddress,
		walletBalance,
		walletInitialized,
		initializeSdk,
		createAndConnectWallet,
		connectWallet,
		disconnectWallet,
		backupWalletToNostr,
		restoreWalletFromNostr,
		isSparkWalletConfigured,
		clearAllSparkWallets
	} from '$lib/spark'
	import { createAuthManager, getAuthManager, type AuthState } from '$lib/authManager'
	import { getNdkInstance } from '$lib/nostr'
	import { logger } from '$lib/logger'

	import Button from '$src/components/Button.svelte'
	import Modal from '$src/components/Modal.svelte'
	import LoadingState from '$src/components/LoadingState.svelte'
	import SectionHeader from '$src/components/SectionHeader.svelte'

	let authState: AuthState
	let unsubscribeAuth: () => void

	// Local component state
	let apiKey: string = import.meta.env.VITE_BREEZ_SPARK_API_KEY || ''
	let password = ''
	let newMnemonic: string = ''
	let showCreateModal = false
	let showDeleteConfirmModal = false

	// UI State
	let isLoading = false
	let error: string | null = null
	let successMessage: string | null = null

	$: currentPubkey = authState?.publicKey || ''
	$: isConnected = $walletInitialized && currentPubkey

	onMount(async () => {
		const ndk = getNdkInstance()
		const auth = createAuthManager(ndk)
		unsubscribeAuth = auth.subscribe((state) => {
			authState = state
			if (authState.isAuthenticated && authState.publicKey && !get(walletInitialized)) {
				// Attempt to auto-connect if authenticated and not already connected
				tryConnectWallet(authState.publicKey)
			}
		})

		// Initial check if already authenticated
		authState = auth.getState()
		if (authState.isAuthenticated && authState.publicKey && !get(walletInitialized)) {
			tryConnectWallet(authState.publicKey)
		}
	})

	onDestroy(() => {
		if (unsubscribeAuth) {
			unsubscribeAuth()
		}
	})

	async function tryConnectWallet(pubkey: string) {
		if (isSparkWalletConfigured(pubkey)) {
			isLoading = true
			error = null
			successMessage = null
			try {
				logger.info('Attempting to auto-connect Spark wallet...')
				const connected = await connectWallet(pubkey, password, apiKey)
				if (connected) {
					successMessage = 'Spark wallet automatically connected!'
				} else {
					error = 'Failed to auto-connect Spark wallet. Please enter password or create new.'
				}
			} catch (e) {
				error = `Error auto-connecting: ${e.message}`
				logger.error('Error auto-connecting Spark wallet:', e)
			} finally {
				isLoading = false
			}
		}
	}

	async function handleConnectExisting() {
		isLoading = true
		error = null
		successMessage = null
		try {
			if (!currentPubkey) throw new Error('Not authenticated with Nostr.')
			if (!apiKey) throw new Error('Breez API Key is required.')
			if (!password) throw new Error('Password is required to decrypt wallet.')

			const connected = await connectWallet(currentPubkey, password, apiKey)
			if (connected) {
				successMessage = 'Spark wallet connected successfully!'
				password = '' // Clear password on success
			} else {
				error = 'Failed to connect wallet. Check password or ensure wallet exists.'
			}
		} catch (e) {
			error = `Error connecting: ${e.message}`
			logger.error('Error connecting Spark wallet:', e)
		} finally {
			isLoading = false
		}
	}

	async function handleCreateNew() {
		isLoading = true
		error = null
		successMessage = null
		try {
			if (!currentPubkey) throw new Error('Not authenticated with Nostr.')
			if (!apiKey) throw new Error('Breez API Key is required.')
			if (!password) throw new Error('Password is required to encrypt wallet.')

			const mnemonic = await createAndConnectWallet(currentPubkey, password, apiKey)
			newMnemonic = mnemonic
			successMessage = 'New Spark wallet created and connected! Please write down your mnemonic.'
			showCreateModal = true
		} catch (e) {
			error = `Error creating wallet: ${e.message}`
			logger.error('Error creating Spark wallet:', e)
		} finally {
			isLoading = false
		}
	}

	async function handleBackupToNostr() {
		isLoading = true
		error = null
		successMessage = null
		try {
			if (!currentPubkey) throw new Error('Not authenticated with Nostr.')
			if (!password) throw new Error('Password is required to encrypt backup.')

			await backupWalletToNostr(currentPubkey, password)
			successMessage = 'Spark wallet backup published to Nostr relays!'
		} catch (e) {
			error = `Error backing up: ${e.message}`
			logger.error('Error backing up Spark wallet:', e)
		} finally {
			isLoading = false
		}
	}

	async function handleRestoreFromNostr() {
		isLoading = true
		error = null
		successMessage = null
		try {
			if (!currentPubkey) throw new Error('Not authenticated with Nostr.')
			if (!apiKey) throw new Error('Breez API Key is required.')
			if (!password) throw new Error('Password is required to decrypt backup.')

			const mnemonic = await restoreWalletFromNostr(currentPubkey, password, apiKey)
			if (mnemonic) {
				successMessage = 'Spark wallet restored and connected from Nostr!'
				password = ''
			} else {
				error = 'No backup found or password incorrect.'
			}
		} catch (e) {
			error = `Error restoring: ${e.message}`
			logger.error('Error restoring Spark wallet:', e)
		} finally {
			isLoading = false
		}
	}

	async function handleDisconnect() {
		isLoading = true
		error = null
		successMessage = null
		try {
			await disconnectWallet()
			successMessage = 'Spark wallet disconnected.'
		} catch (e) {
			error = `Error disconnecting: ${e.message}`
			logger.error('Error disconnecting Spark wallet:', e)
		} finally {
			isLoading = false
		}
	}

	async function handleDeleteLocal() {
		isLoading = true
		error = null
		successMessage = null
		try {
			if (!currentPubkey) throw new Error('Not authenticated with Nostr.')

			deleteMnemonic(currentPubkey)
			await disconnectWallet()
			successMessage = 'Local Spark wallet deleted.'
		} catch (e) {
			error = `Error deleting local wallet: ${e.message}`
			logger.error('Error deleting local Spark wallet:', e)
		} finally {
			isLoading = false
			showDeleteConfirmModal = false
		}
	}

	async function handleClearAll() {
		isLoading = true
		error = null
		successMessage = null
		try {
			clearAllSparkWallets()
			await disconnectWallet()
			successMessage = 'All local Spark wallets cleared.'
		} catch (e) {
			error = `Error clearing all wallets: ${e.message}`
			logger.error('Error clearing all Spark wallets:', e)
		} finally {
			isLoading = false
		}
	}
</script>

<div class="space-y-6 p-4">
	<SectionHeader title="Spark Wallet Management" />

	<p class="text-sm text-gray-500 dark:text-gray-400">
		Integrate a self-custodial Lightning wallet powered by Breez SDK Spark. This allows in-app
		zapping and receiving payments. Your mnemonic is encrypted locally with a password you provide.
	</p>

	{#if !authState?.isAuthenticated}
		<div class="rounded-md bg-red-50 p-4 text-red-700 dark:bg-red-900 dark:text-red-300">
			<p>Please log in with your Nostr account to manage your Spark wallet.</p>
		</div>
	{/if}

	<div class="form-control">
		<label for="apiKey" class="label">
			<span class="label-text">Breez API Key</span>
		</label>
		<input
			type="text"
			id="apiKey"
			placeholder="Enter your Breez API Key"
			class="input input-bordered w-full"
			bind:value={apiKey}
			disabled={isLoading || isConnected}
		/>
		<label class="label">
			<span class="label-text-alt text-gray-500 dark:text-gray-400"
				>Get one at <a href="https://breez.technology/spark/" target="_blank" class="link"
					>breez.technology/spark</a
				>. For production, use environment variables.</span
			>
		</label>
	</div>

	{#if authState?.isAuthenticated}
		<div class="rounded-md bg-base-200 p-4 shadow-sm">
			<h3 class="text-lg font-semibold mb-2">Wallet Status</h3>
			<p>
				<strong>Nostr Public Key:</strong> <code>{currentPubkey.slice(0, 8)}...{currentPubkey.slice(-8)}</code>
			</p>
			{#if isConnected}
				<p class="text-success-content">Status: Connected</p>
				<p><strong>Balance:</strong> {$walletBalance ?? 'N/A'} sats</p>
				<p><strong>Lightning Address:</strong> {$lightningAddress ?? 'N/A'}</p>
			{:else}
				<p class="text-error-content">Status: Disconnected</p>
			{/if}
			{#if isSparkWalletConfigured(currentPubkey)}
				<p class="text-sm text-gray-600 dark:text-gray-300">
					Local wallet found for this account.
				</p>
			{:else}
				<p class="text-sm text-gray-600 dark:text-gray-300">No local wallet found for this account.</p>
			{/if}
		</div>

		<div class="form-control">
			<label for="password" class="label">
				<span class="label-text">Wallet Password</span>
			</label>
			<input
				type="password"
				id="password"
				placeholder="Enter wallet password"
				class="input input-bordered w-full"
				bind:value={password}
				disabled={isLoading}
			/>
			<label class="label">
				<span class="label-text-alt text-gray-500 dark:text-gray-400"
					>This password encrypts your wallet mnemonic locally and for Nostr backups.</span
				>
			</label>
		</div>

		<div class="flex flex-wrap gap-4">
			{#if !isConnected}
				<Button on:click={handleConnectExisting} disabled={isLoading || !currentPubkey || !apiKey}
					>Connect Existing Wallet</Button
				>
				<Button on:click={handleCreateNew} disabled={isLoading || !currentPubkey || !apiKey}
					>Create New Wallet</Button
				>
				<Button on:click={handleRestoreFromNostr} disabled={isLoading || !currentPubkey || !apiKey}
					>Restore from Nostr</Button
				>
			{/if}

			{#if isConnected}
				<Button on:click={handleBackupToNostr} disabled={isLoading || !currentPubkey || !apiKey}
					>Backup to Nostr</Button
				>
				<Button on:click={handleDisconnect} disabled={isLoading}>Disconnect Wallet</Button>
			{/if}

			{#if isSparkWalletConfigured(currentPubkey)}
				<Button on:click={() => (showDeleteConfirmModal = true)} disabled={isLoading}
					>Delete Local Wallet</Button
				>
			{/if}
			<Button on:click={handleClearAll} disabled={isLoading} variant="danger"
				>Clear All Local Wallets</Button
			>
		</div>

		{#if isLoading}
			<LoadingState message="Processing request..." />
		{/if}

		{#if error}
			<div class="rounded-md bg-red-50 p-4 text-red-700 dark:bg-red-900 dark:text-red-300">
				<p>{error}</p>
			</div>
		{/if}

		{#if successMessage}
			<div class="rounded-md bg-green-50 p-4 text-green-700 dark:bg-green-900 dark:text-green-300">
				<p>{successMessage}</p>
			</div>
		{/if}
	{/if}

	<!-- Modals -->
	<Modal bind:open={showCreateModal} title="New Wallet Mnemonic">
		<p class="mb-4">
			<strong>IMPORTANT:</strong> Please write down this mnemonic phrase in a secure location. This
			is the only way to recover your wallet if you lose your password or device.
		</p>
		<div class="break-words rounded-md bg-gray-100 p-4 font-mono text-sm dark:bg-gray-700">
			{newMnemonic}
		</div>
		<div slot="footer">
			<Button on:click={() => (showCreateModal = false)}>I have saved my mnemonic</Button>
		</div>
	</Modal>

	<Modal bind:open={showDeleteConfirmModal} title="Confirm Deletion">
		<p>Are you sure you want to delete the local Spark wallet for this account?</p>
		<p class="text-sm text-red-500">This will remove the mnemonic from your browser's storage.</p>
		<div slot="footer" class="flex justify-end gap-2">
			<Button on:click={() => (showDeleteConfirmModal = false)} variant="secondary"
				>Cancel</Button
			>
			<Button on:click={handleDeleteLocal} variant="danger">Delete</Button>
		</div>
	</Modal>
</div>
