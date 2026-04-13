import type { User } from '@authing/guard';

function readStr(u: User, key: string): string {
  const v = (u as unknown as Record<string, unknown>)[key];
  return typeof v === 'string' ? v.trim() : '';
}

export function authingDisplayName(user: User | null | undefined): string {
  if (!user) return '';
  return (
    readStr(user, 'nickname') ||
    readStr(user, 'username') ||
    (readStr(user, 'email').split('@')[0] ?? readStr(user, 'email')) ||
    readStr(user, 'phone') ||
    'User'
  );
}

export function authingEmail(user: User | null | undefined): string {
  if (!user) return '';
  return readStr(user, 'email');
}

export function authingAvatarUrl(user: User | null | undefined): string | null {
  if (!user) return null;
  const photo = readStr(user, 'photo');
  if (photo.startsWith('http://') || photo.startsWith('https://')) return photo;
  return null;
}
