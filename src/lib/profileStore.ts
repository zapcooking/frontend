import { writable, derived, type Writable } from 'svelte/store';
import { resolveProfile, resolveProfiles, formatDisplayName, type ProfileData } from './profileResolver';
import { ndk } from './nostr';
import type { NDK } from '@nostr-dev-kit/ndk';

// Store for individual profile data
const profileData: Writable<Map<string, ProfileData | null>> = writable(new Map());

// Store for loading states
const loadingStates: Writable<Map<string, boolean>> = writable(new Map());

// Store for error states
const errorStates: Writable<Map<string, string | null>> = writable(new Map());

// Actions for profile management
export const profileActions = {
  // Load a single profile
  async loadProfile(nostrString: string): Promise<void> {
    // Set loading state
    loadingStates.update(states => {
      states.set(nostrString, true);
      return states;
    });

    // Clear any previous error
    errorStates.update(states => {
      states.set(nostrString, null);
      return states;
    });

    try {
      // Get current NDK instance
      let ndkInstance: NDK;
      const unsubscribe = ndk.subscribe(value => {
        ndkInstance = value;
      });
      unsubscribe();
      
      if (!ndkInstance) {
        throw new Error('NDK not available');
      }

      const profile = await resolveProfile(nostrString, ndkInstance);
      
      // Update profile data
      profileData.update(data => {
        data.set(nostrString, profile);
        return data;
      });
    } catch (error) {
      console.error(`Failed to load profile for ${nostrString}:`, error);
      
      // Set error state
      errorStates.update(states => {
        states.set(nostrString, error instanceof Error ? error.message : 'Unknown error');
        return states;
      });
    } finally {
      // Clear loading state
      loadingStates.update(states => {
        states.set(nostrString, false);
        return states;
      });
    }
  },

  // Load multiple profiles in batch
  async loadProfiles(nostrStrings: string[]): Promise<void> {
    // Set loading states for all
    loadingStates.update(states => {
      nostrStrings.forEach(nostrString => {
        states.set(nostrString, true);
      });
      return states;
    });

    // Clear previous errors
    errorStates.update(states => {
      nostrStrings.forEach(nostrString => {
        states.set(nostrString, null);
      });
      return states;
    });

    try {
      // Get current NDK instance
      let ndkInstance: NDK;
      const unsubscribe = ndk.subscribe(value => {
        ndkInstance = value;
      });
      unsubscribe();
      
      if (!ndkInstance) {
        throw new Error('NDK not available');
      }

      const profiles = await resolveProfiles(nostrStrings, ndkInstance);
      
      // Update profile data
      profileData.update(data => {
        profiles.forEach((profile, nostrString) => {
          data.set(nostrString, profile);
        });
        return data;
      });
    } catch (error) {
      console.error('Failed to load profiles:', error);
      
      // Set error states
      errorStates.update(states => {
        nostrStrings.forEach(nostrString => {
          states.set(nostrString, error instanceof Error ? error.message : 'Unknown error');
        });
        return states;
      });
    } finally {
      // Clear loading states
      loadingStates.update(states => {
        nostrStrings.forEach(nostrString => {
          states.set(nostrString, false);
        });
        return states;
      });
    }
  },

  // Clear all data
  clearAll(): void {
    profileData.set(new Map());
    loadingStates.set(new Map());
    errorStates.set(new Map());
  },

  // Clear specific profile data
  clearProfile(nostrString: string): void {
    profileData.update(data => {
      data.delete(nostrString);
      return data;
    });
    
    loadingStates.update(states => {
      states.delete(nostrString);
      return states;
    });
    
    errorStates.update(states => {
      states.delete(nostrString);
      return states;
    });
  }
};

// Derived stores for easy access
export const profiles = derived(profileData, $profileData => $profileData);
export const loadingProfiles = derived(loadingStates, $loadingStates => $loadingStates);
export const profileErrors = derived(errorStates, $errorStates => $errorStates);

// Helper function to get profile data for a specific nostr string
export function getProfile(nostrString: string): ProfileData | null {
  let result: ProfileData | null = null;
  
  profileData.subscribe(data => {
    result = data.get(nostrString) || null;
  })();
  
  return result;
}

// Helper function to check if a profile is loading
export function isProfileLoading(nostrString: string): boolean {
  let result = false;
  
  loadingStates.subscribe(states => {
    result = states.get(nostrString) || false;
  })();
  
  return result;
}

// Helper function to get profile error
export function getProfileError(nostrString: string): string | null {
  let result: string | null = null;
  
  errorStates.subscribe(states => {
    result = states.get(nostrString) || null;
  })();
  
  return result;
}

// Derived store for formatted display names
export const displayNames = derived(profiles, $profiles => {
  const names = new Map<string, string>();
  
  $profiles.forEach((profile, nostrString) => {
    names.set(nostrString, formatDisplayName(profile));
  });
  
  return names;
});
