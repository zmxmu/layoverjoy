import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * AES-256-GCM 应用层字段加密。
 * 每个字段独立 12 字节 IV，输出格式：base64(iv).base64(authTag).base64(ciphertext)
 */
export class FieldCrypto {
  private readonly key: Buffer;

  constructor(dataEncryptionKey: string) {
    // 支持 32 字节 Base64 或任意长度字符串（取 sha 摘要保证 32 字节）
    const raw = Buffer.from(dataEncryptionKey, 'base64');
    this.key = raw.length === 32 ? raw : Buffer.from(require('crypto').createHash('sha256').update(dataEncryptionKey).digest());
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.');
  }

  decrypt(payload: string): string {
    const [ivB64, tagB64, dataB64] = payload.split('.');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  }
}

/** 日志脱敏：邮箱仅保留首尾各一位。 */
export function maskEmail(email?: string | null): string {
  if (!email) return '';
  const [name, domain] = email.split('@');
  if (!domain) return '*';
  if (name.length <= 2) return `${name[0]}***@${domain}`;
  return `${name[0]}***${name[name.length - 1]}@${domain}`;
}

/** 日志脱敏：证件号/订单号只保留末四位。 */
export function maskLast4(value?: string | null): string {
  if (!value) return '';
  return `****${value.slice(-4)}`;
}
