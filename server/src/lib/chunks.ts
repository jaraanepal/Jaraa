// Resumable-upload assembler — ported from spikes/photos/src/pipeline.mjs.
// The client splits a photo into ~1MB chunks; each chunk is POSTed with
// (uploadId, index, total). When the final chunk arrives the full buffer is
// returned for the normal photo pipeline. Entries are evicted after 30 min.
export class ChunkAssembler {
  private parts = new Map<string, { chunks: Map<number, Buffer>; total: number; at: number }>();

  addChunk(uploadId: string, index: number, total: number, chunk: Buffer): Buffer | null {
    this.evict();
    let u = this.parts.get(uploadId);
    if (!u) { u = { chunks: new Map(), total, at: Date.now() }; this.parts.set(uploadId, u); }
    if (u.total !== total) throw new Error("chunk total mismatch");
    u.chunks.set(index, chunk);
    if (u.chunks.size === u.total) {
      const ordered: Buffer[] = [];
      for (let i = 0; i < u.total; i++) {
        const c = u.chunks.get(i);
        if (!c) return null;
        ordered.push(c);
      }
      this.parts.delete(uploadId);
      return Buffer.concat(ordered);
    }
    return null;
  }

  private evict() {
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [k, v] of this.parts) if (v.at < cutoff) this.parts.delete(k);
  }
}
