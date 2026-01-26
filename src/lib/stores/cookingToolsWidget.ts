import { writable, derived } from 'svelte/store';

export type ToolsTab = 'timer' | 'converter';

interface CookingToolsState {
  open: boolean;
  activeTab: ToolsTab;
}

const initialState: CookingToolsState = {
  open: false,
  activeTab: 'timer'
};

function createCookingToolsStore() {
  const { subscribe, set, update } = writable<CookingToolsState>(initialState);

  return {
    subscribe,
    open: (tab?: ToolsTab) => {
      update((state) => ({
        open: true,
        activeTab: tab ?? state.activeTab
      }));
    },
    close: () => {
      update((state) => ({
        ...state,
        open: false
      }));
    },
    toggle: (tab?: ToolsTab) => {
      update((state) => {
        if (state.open && tab && tab !== state.activeTab) {
          // If open and switching tabs, just switch
          return { open: true, activeTab: tab };
        }
        // Otherwise toggle open state
        return {
          open: !state.open,
          activeTab: tab ?? state.activeTab
        };
      });
    },
    setTab: (tab: ToolsTab) => {
      update((state) => ({
        ...state,
        activeTab: tab
      }));
    }
  };
}

export const cookingToolsStore = createCookingToolsStore();

// Derived stores for backward compatibility
export const cookingToolsOpen = derived(cookingToolsStore, ($store) => $store.open);
export const activeToolsTab = derived(cookingToolsStore, ($store) => $store.activeTab);
