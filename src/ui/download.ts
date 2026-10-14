/**
 * Hand a file to the player: through the published page's downloads capability (claude.ai shows a
 * confirmation), else a plain browser download (the offline file, npm run play).
 */
type Downloads = { save(r: { filename: string; data: Blob }): Promise<unknown> };

export async function offerFile(filename: string, bytes: Uint8Array, type: string): Promise<'saved' | 'declined' | 'failed'> {
  const blob = new Blob([bytes as BlobPart], { type });
  const claude = (window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
  if (claude?.use) {
    const dl = await claude.use('downloads').catch(() => null) as Downloads | null;
    if (dl) {
      try { await dl.save({ filename, data: blob }); return 'saved'; }
      catch (e) { return (e as { code?: string }).code === 'declined' ? 'declined' : 'failed'; }
    }
  }
  try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    return 'saved';
  } catch { return 'failed'; }
}
