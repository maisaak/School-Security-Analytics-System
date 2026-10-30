interface IncidentIdentity { id: number; detected_at: string }

// The feed is a newest-first window, not a durable delivery queue. A high-water
// timestamp prevents deletions exposing older rows from creating false alarms.
export function createIncidentTracker() {
  let initialized = false;
  let watermark = -Infinity;
  const seen = new Set<string>();
  return <T extends IncidentIdentity>(rows: T[]): T[] => {
    const fresh = rows.filter(row => {
      const timestamp = Date.parse(row.detected_at);
      return initialized && Number.isFinite(timestamp) && timestamp >= watermark && !seen.has(`${row.id}:${row.detected_at}`);
    });
    for (const row of rows) {
      const timestamp = Date.parse(row.detected_at);
      if (Number.isFinite(timestamp)) watermark = Math.max(watermark, timestamp);
      seen.add(`${row.id}:${row.detected_at}`);
    }
    // Bound memory; pruned identities are still protected by the watermark.
    while (seen.size > 2000) seen.delete(seen.values().next().value!);
    initialized = true;
    return fresh.sort((a, b) => Date.parse(a.detected_at) - Date.parse(b.detected_at) || a.id - b.id);
  };
}
