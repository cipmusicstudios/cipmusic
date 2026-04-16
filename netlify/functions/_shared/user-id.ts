/**
 * Supabase Auth 的 user id 为 UUID。
 * create-zpay-order / read-membership 当前从 body 读取 userId（见各 handler 内安全备注）。
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidString(v: string): boolean {
  return UUID_RE.test(v.trim());
}

/**
 * 优先 userId；兼容旧客户端仍传 authingUserId（temporary，与 Authing 无关，仅为字段名兼容）。
 */
export function userIdFromRequestBody(body: {
  userId?: string;
  authingUserId?: string;
}): string | null {
  const raw =
    (typeof body.userId === 'string' ? body.userId : '') ||
    (typeof body.authingUserId === 'string' ? body.authingUserId : '');
  const id = raw.trim();
  if (!id || !isUuidString(id)) return null;
  return id;
}
