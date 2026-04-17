import { open } from "@tauri-apps/api/shell";

/** Open a https URL in the system browser (Tauri) or a new tab (fallback). */
export async function openExternalUrl(url: string): Promise<void> {
  const u = url?.trim();
  if (!u || !/^https?:\/\//i.test(u)) return;
  try {
    await open(u);
  } catch {
    window.open(u, "_blank", "noopener,noreferrer");
  }
}
