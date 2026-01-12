// Fallback tree data structure for The Garden invite tree
export interface TreeNodeData {
  pubkey: string; // hex format
  children: TreeNodeData[];
  isRoot?: boolean;
}

// Fallback static data (used when fetch fails)
// This is a minimal example structure - in practice, this would be more complete
export const fallbackTreeData: TreeNodeData[] = [
  {
    pubkey: '15u3cqhx6vuj3rywg0ph5mfv009lxja6cyvqn2jagaydukq6zmjwqex05rq',
    isRoot: true,
    children: []
  }
];
