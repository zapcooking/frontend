<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { userPublickey } from '$lib/nostr';
	import {
		drafts,
		loadDrafts,
		deleteDraft,
		openDraft,
		openNewDraft
	} from '../../components/reads/articleDraftStore';
	import { getWordCount, getReadingTime, type ArticleDraft } from '$lib/articleEditor';
	import PencilSimpleLineIcon from 'phosphor-svelte/lib/PencilSimpleLine';
	import TrashIcon from 'phosphor-svelte/lib/Trash';
	import PlusIcon from 'phosphor-svelte/lib/Plus';
	import ClockIcon from 'phosphor-svelte/lib/Clock';
	import FileTextIcon from 'phosphor-svelte/lib/FileText';
	import { format } from 'date-fns';

	$: isSignedIn = $userPublickey !== '';

	let deleteConfirmId: string | null = null;

	// Redirect if not signed in
	$: if (!isSignedIn && typeof window !== 'undefined') {
		goto('/');
	}

	onMount(() => {
		loadDrafts();
	});

	function handleEdit(draftId: string) {
		openDraft(draftId);
	}

	function handleDelete(draftId: string) {
		deleteConfirmId = draftId;
	}

	function confirmDelete() {
		if (deleteConfirmId) {
			deleteDraft(deleteConfirmId);
			deleteConfirmId = null;
		}
	}

	function cancelDelete() {
		deleteConfirmId = null;
	}

	function handleNewDraft() {
		openNewDraft();
	}

	function formatDate(timestamp: number): string {
		return format(new Date(timestamp), 'MMM d, yyyy h:mm a');
	}

	function getDraftPreview(draft: ArticleDraft): string {
		if (!draft.content) return 'No content yet...';
		// Strip HTML and truncate
		const text = draft.content.replace(/<[^>]*>/g, ' ').trim();
		if (text.length <= 150) return text;
		return text.substring(0, 150) + '...';
	}

	$: sortedDrafts = [...$drafts].sort((a, b) => b.updatedAt - a.updatedAt);
</script>

<svelte:head>
	<title>My Drafts | zap.cooking</title>
	<meta name="description" content="Manage your article drafts on zap.cooking" />
</svelte:head>

<div class="drafts-page">
	<header class="page-header">
		<div class="header-content">
			<h1 class="page-title">My Drafts</h1>
			<p class="page-subtitle">Manage your article drafts</p>
		</div>

		<button class="new-draft-btn" on:click={handleNewDraft}>
			<PlusIcon size={18} />
			<span>New Article</span>
		</button>
	</header>

	{#if sortedDrafts.length === 0}
		<div class="empty-state">
			<FileTextIcon size={48} />
			<h2>No drafts yet</h2>
			<p>Start writing your first article!</p>
			<button class="start-writing-btn" on:click={handleNewDraft}>
				<PencilSimpleLineIcon size={18} />
				Start Writing
			</button>
		</div>
	{:else}
		<div class="drafts-list">
			{#each sortedDrafts as draft (draft.id)}
				<article class="draft-card">
					{#if draft.coverImage}
						<div class="draft-cover">
							<img src={draft.coverImage} alt="" />
						</div>
					{/if}

					<div class="draft-content">
						<h2 class="draft-title">
							{draft.title || 'Untitled'}
						</h2>

						{#if draft.subtitle}
							<p class="draft-subtitle">{draft.subtitle}</p>
						{/if}

						<p class="draft-preview">{getDraftPreview(draft)}</p>

						<div class="draft-meta">
							<span class="meta-item">
								<ClockIcon size={14} />
								{formatDate(draft.updatedAt)}
							</span>
							<span class="meta-divider">·</span>
							<span class="meta-item">
								{getWordCount(draft.content)} words
							</span>
							<span class="meta-divider">·</span>
							<span class="meta-item">
								{getReadingTime(getWordCount(draft.content))} min read
							</span>
						</div>

						{#if draft.tags.length > 0}
							<div class="draft-tags">
								{#each draft.tags.slice(0, 3) as tag}
									<span class="tag">#{tag}</span>
								{/each}
								{#if draft.tags.length > 3}
									<span class="tag more">+{draft.tags.length - 3}</span>
								{/if}
							</div>
						{/if}
					</div>

					<div class="draft-actions">
						<button
							class="action-btn edit"
							on:click={() => handleEdit(draft.id)}
							title="Edit draft"
						>
							<PencilSimpleLineIcon size={18} />
							<span>Edit</span>
						</button>
						<button
							class="action-btn delete"
							on:click={() => handleDelete(draft.id)}
							title="Delete draft"
						>
							<TrashIcon size={18} />
						</button>
					</div>
				</article>
			{/each}
		</div>
	{/if}
</div>

<!-- Delete Confirmation Modal -->
{#if deleteConfirmId}
	<div class="modal-backdrop" on:click|self={cancelDelete} role="presentation">
		<div class="confirm-modal" role="alertdialog" aria-modal="true">
			<h3>Delete Draft?</h3>
			<p>This action cannot be undone. The draft will be permanently deleted.</p>
			<div class="confirm-actions">
				<button class="confirm-btn cancel" on:click={cancelDelete}>Cancel</button>
				<button class="confirm-btn delete" on:click={confirmDelete}>Delete</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.drafts-page {
		max-width: 900px;
		margin: 0 auto;
		padding: 1rem 0;
	}

	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 2rem;
		padding-bottom: 1.5rem;
		border-bottom: 1px solid var(--color-input-border);
	}

	.header-content {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.page-title {
		font-size: 1.75rem;
		font-weight: 700;
		color: var(--color-text-primary);
	}

	.page-subtitle {
		font-size: 0.875rem;
		color: var(--color-text-secondary);
	}

	.new-draft-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.625rem 1rem;
		border-radius: 9999px;
		background: linear-gradient(135deg, #f97316, #f59e0b);
		color: white;
		font-size: 0.875rem;
		font-weight: 600;
		transition: all 0.15s ease;
		box-shadow: 0 4px 12px rgba(249, 115, 22, 0.25);
	}

	.new-draft-btn:hover {
		transform: translateY(-1px);
		box-shadow: 0 6px 16px rgba(249, 115, 22, 0.35);
	}

	/* Empty State */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 4rem 2rem;
		text-align: center;
		color: var(--color-text-secondary);
	}

	.empty-state h2 {
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 1rem 0 0.5rem;
	}

	.empty-state p {
		margin-bottom: 1.5rem;
	}

	.start-writing-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1.25rem;
		border-radius: 0.5rem;
		background: var(--color-primary);
		color: white;
		font-weight: 500;
		transition: all 0.15s ease;
	}

	.start-writing-btn:hover {
		opacity: 0.9;
	}

	/* Drafts List */
	.drafts-list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.draft-card {
		display: flex;
		gap: 1rem;
		padding: 1.25rem;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-input-border);
		border-radius: 0.75rem;
		transition: all 0.15s ease;
	}

	.draft-card:hover {
		border-color: var(--color-primary);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
	}

	.draft-cover {
		flex-shrink: 0;
		width: 120px;
		height: 80px;
		border-radius: 0.5rem;
		overflow: hidden;
	}

	.draft-cover img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.draft-content {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.draft-title {
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--color-text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.draft-subtitle {
		font-size: 0.875rem;
		color: var(--color-text-secondary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.draft-preview {
		font-size: 0.875rem;
		color: var(--color-text-secondary);
		line-height: 1.5;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.draft-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		margin-top: 0.25rem;
	}

	.meta-item {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.meta-divider {
		opacity: 0.5;
	}

	.draft-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		margin-top: 0.5rem;
	}

	.tag {
		padding: 0.125rem 0.5rem;
		background: var(--color-accent-gray);
		color: var(--color-primary);
		font-size: 0.75rem;
		font-weight: 500;
		border-radius: 9999px;
	}

	.tag.more {
		background: var(--color-input-border);
		color: var(--color-text-secondary);
	}

	.draft-actions {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.action-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		padding: 0.5rem 0.75rem;
		border-radius: 0.5rem;
		font-size: 0.875rem;
		font-weight: 500;
		transition: all 0.15s ease;
	}

	.action-btn.edit {
		background: var(--color-primary);
		color: white;
	}

	.action-btn.edit:hover {
		opacity: 0.9;
	}

	.action-btn.delete {
		color: var(--color-text-secondary);
		padding: 0.5rem;
	}

	.action-btn.delete:hover {
		background: #fee2e2;
		color: #dc2626;
	}

	/* Modal */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.5);
		padding: 1rem;
	}

	.confirm-modal {
		background: var(--color-bg-secondary);
		border-radius: 1rem;
		padding: 1.5rem;
		max-width: 400px;
		width: 100%;
		box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
	}

	.confirm-modal h3 {
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin-bottom: 0.75rem;
	}

	.confirm-modal p {
		font-size: 0.875rem;
		color: var(--color-text-secondary);
		margin-bottom: 1.5rem;
		line-height: 1.5;
	}

	.confirm-actions {
		display: flex;
		gap: 0.75rem;
		justify-content: flex-end;
	}

	.confirm-btn {
		padding: 0.5rem 1rem;
		border-radius: 0.5rem;
		font-size: 0.875rem;
		font-weight: 500;
		transition: all 0.15s ease;
	}

	.confirm-btn.cancel {
		color: var(--color-text-secondary);
	}

	.confirm-btn.cancel:hover {
		background: var(--color-accent-gray);
	}

	.confirm-btn.delete {
		background: #dc2626;
		color: white;
	}

	.confirm-btn.delete:hover {
		background: #b91c1c;
	}

	/* Mobile Responsive */
	@media (max-width: 640px) {
		.page-header {
			flex-direction: column;
			gap: 1rem;
		}

		.new-draft-btn {
			width: 100%;
			justify-content: center;
		}

		.draft-card {
			flex-direction: column;
		}

		.draft-cover {
			width: 100%;
			height: 120px;
		}

		.draft-actions {
			flex-direction: row;
			justify-content: flex-end;
		}

		.action-btn.edit {
			flex: 1;
		}
	}
</style>
