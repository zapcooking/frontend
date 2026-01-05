# **Specification: Wallet UX Refactor & NIP-46 Integration**

## **1\. Project Context**

App: zap.cooking (SvelteKit \+ NDK \+ Breez SDK)  
Objective: Resolve UI visibility issues for wallet errors and expand wallet management (backup/restore/sync) to support NIP-46 (Nostr Connect/Bunker).  
Currently, the app supports **NIP-07** (browser extensions) for wallet metadata encryption and **Manual Strings** for NWC. We are adding **NIP-46** as a parallel auth method for these features.

## ---

**2\. Deliverable A: Global Notification System**

### **Problem**

Wallet error messages are currently rendered as inline absolute-positioned text (e.g., \<p class="text-red-500"\>). These often fall behind Z-indexed modals or layout containers, leaving the user with a "frozen" UI and no visible feedback.

### **Requirements**

* **Centralized Store:** Create src/lib/stores/notifications.ts using a Svelte writable array to manage a queue of toast notifications.  
* **Root Provider:** Implement a NotificationProvider.svelte component.  
  * **Placement:** Root layout (+layout.svelte).  
  * **Z-Index:** Must be z-\[9999\] to clear all modals.  
  * **Behavior:** Auto-dismiss after 5 seconds; manual dismiss button.  
* **Refactor:** Replace all local let error bindings in src/lib/components/wallet/\* with notifications.error('Message').

## ---

**3\. Deliverable B: NIP-46 Wallet Lifecycle Support**

### **Requirements**

* **Standardized Storage (NIP-78):** Use **Kind 30078** for all wallet backups and metadata syncing.  
* **Signer-Agnostic Encryption:** Refactor wallet backup/restore utilities to use the active NDKSigner.  
  * If user is logged in via **NIP-07**, use extension signing.  
  * If user is logged in via **NIP-46**, route encryption/decryption requests to the Bunker.  
* **Restore via Bunker:**  
  * Modify the "Restore" UI to include a "Nostr Connect / Bunker" input.  
  * Fetch **NIP-78** events from relays and use the Bunker to decrypt the Breez seed or NWC string.  
* **Relay Syncing:**  
  * Enable "Save to Cloud" for NWC strings using NIP-46 signing.  
* **Persistence:** Ensure manual NWC connection strings remain functional as a fallback.

## ---

**4\. Technical Implementation Details**

### **4.1. Store Boilerplate (src/lib/stores/notifications.ts)**

TypeScript

import { writable } from 'svelte/store';

export type NotificationType \= 'error' | 'success' | 'warning' | 'info';  
export interface Notification { id: string; type: NotificationType; message: string; timeout?: number; }

function createNotificationStore() {  
    const { subscribe, update } \= writable\<Notification\[\]\>(\[\]);  
    return {  
        subscribe,  
        add: (message: string, type: NotificationType \= 'info') \=\> {  
            const id \= Math.random().toString(36).substring(2, 9);  
            update(n \=\> \[...n, { id, type, message }\]);  
            setTimeout(() \=\> update(n \=\> n.filter(m \=\> m.id \!== id)), 5000);  
        },  
        error: (m: string) \=\> this.add(m, 'error'),  
        remove: (id: string) \=\> update(n \=\> n.filter(m \=\> m.id \!== id))  
    };  
}  
export const notifications \= createNotificationStore();

### **4.2. NIP-78 Signer Mapping**

Ensure the wallet initialization logic references the ndk.signer correctly:

TypeScript

// Example Signer Logic for NIP-78  
async function getWalletData() {  
    const signer \= ndk.signer; // NDKNip46Signer or NDKNip07Signer  
    const user \= await signer.user();  
      
    const event \= await ndk.fetchEvent({  
        kinds: \[30078\], // NIP-78  
        authors: \[user.pubkey\],  
        '\#d': \['zap\_cooking\_wallet\_v1'\]  
    });

    if (event) {  
        // Triggers the appropriate local or remote decryption prompt  
        const decrypted \= await event.decrypt();  
        return JSON.parse(decrypted);  
    }  
}

## ---

**5\. Files to Touch**

1. src/lib/stores/notifications.ts (New)  
2. src/lib/components/ui/NotificationProvider.svelte (New)  
3. src/routes/+layout.svelte (Inject Provider)  
4. src/lib/ndk.ts (Verify Signer initialization)  
5. src/lib/components/wallet/WalletProvider.svelte (Core logic update)  
6. src/lib/components/wallet/Breez/BreezWallet.svelte (Error UI update)  
7. src/lib/components/wallet/NWC/NWCConnect.svelte (Add Cloud Sync)

## ---

**6\. Testing Criteria**

1. **UI:** Trigger an NWC error (e.g., wrong string format). Verify the toast appears on top of the modal.  
2. **Auth:** Log in via a Bunker. Save a wallet backup to **NIP-78**. Log out. Log back in via Bunker on a different browser and verify the wallet restores correctly.  
3. **Stability:** Ensure NIP-07 extension signing still works for users who prefer extensions.