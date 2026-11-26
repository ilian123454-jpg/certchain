import { query } from "../db/pool";

export async function audit(actorId: string | null, action: string, entityId: string | null, details: Record<string, unknown> = {}) {
  await query("INSERT INTO audit_log (actor_id, action, entity_id, details) VALUES ($1, $2, $3, $4)", [actorId, action, entityId, JSON.stringify(details)]);
}
