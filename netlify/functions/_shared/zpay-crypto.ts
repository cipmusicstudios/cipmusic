import crypto from 'node:crypto';

/** ZPay：参与签名的字段排除 sign、sign_type与空值；ASCII 排序后 a=b&c=d，再拼接商户 key，MD5 小写。 */
export function zpayMd5Lower(content: string): string {
  return crypto.createHash('md5').update(content, 'utf8').digest('hex').toLowerCase();
}

export function buildZpaySignBaseString(params: Record<string, string>): string {
  const keys = Object.keys(params)
    .filter(k => k !== 'sign' && k !== 'sign_type')
    .filter(k => {
      const v = params[k];
      return v != null && String(v).length > 0;
    })
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return keys.map(k => `${k}=${params[k]}`).join('&');
}

export function signZpayParams(params: Record<string, string>, merchantKey: string): string {
  const base = buildZpaySignBaseString(params);
  return zpayMd5Lower(`${base}${merchantKey}`);
}

export function verifyZpayNotify(params: Record<string, string>, merchantKey: string): boolean {
  const sign = params.sign;
  if (!sign) return false;
  const computed = signZpayParams(params, merchantKey);
  return computed === sign.toLowerCase();
}
