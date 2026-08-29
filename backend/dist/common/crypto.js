"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FieldCrypto = void 0;
exports.maskEmail = maskEmail;
exports.maskLast4 = maskLast4;
const crypto_1 = require("crypto");
class FieldCrypto {
    key;
    constructor(dataEncryptionKey) {
        const raw = Buffer.from(dataEncryptionKey, 'base64');
        this.key = raw.length === 32 ? raw : Buffer.from(require('crypto').createHash('sha256').update(dataEncryptionKey).digest());
    }
    encrypt(plain) {
        const iv = (0, crypto_1.randomBytes)(12);
        const cipher = (0, crypto_1.createCipheriv)('aes-256-gcm', this.key, iv);
        const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();
        return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.');
    }
    decrypt(payload) {
        const [ivB64, tagB64, dataB64] = payload.split('.');
        const decipher = (0, crypto_1.createDecipheriv)('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64'));
        decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
        return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
    }
}
exports.FieldCrypto = FieldCrypto;
function maskEmail(email) {
    if (!email)
        return '';
    const [name, domain] = email.split('@');
    if (!domain)
        return '*';
    if (name.length <= 2)
        return `${name[0]}***@${domain}`;
    return `${name[0]}***${name[name.length - 1]}@${domain}`;
}
function maskLast4(value) {
    if (!value)
        return '';
    return `****${value.slice(-4)}`;
}
