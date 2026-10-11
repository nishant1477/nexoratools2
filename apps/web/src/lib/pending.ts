// Files chosen before sign-in (or dropped on the home page) survive client-side navigation in memory only.
const store = new Map<string, File[]>();
export const stashFiles = (toolId: string, files: File[]) => { store.set(toolId, files); };
export const takeFiles = (toolId: string): File[] => { const f = store.get(toolId) ?? []; store.delete(toolId); return f; };
export const peekFiles = (toolId: string): File[] => store.get(toolId) ?? [];
