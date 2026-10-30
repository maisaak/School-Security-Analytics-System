// Cancelable event keeps draft ownership in the editor rather than in navigation.
export function canLeaveWorkspace(): boolean {
  return window.dispatchEvent(new Event("workspace-before-leave", { cancelable: true }));
}
