import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || ''; // Render'a eklediğin anahtar
const IV_LENGTH = 16; // AES için standart

if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) {
    console.error("KRİTİK HATA: ENCRYPTION_KEY eksik veya çok kısa! .env dosyasını kontrol et.");
}

// Şifreleme Fonksiyonu (Veriyi Çöp'e Çevirir)
export function encrypt(text: string): string {
    if (!text) return '';
    
    // Rastgele bir başlangıç vektörü (IV) oluştur
    const iv = crypto.randomBytes(IV_LENGTH);
    
    // Anahtarı Buffer formatına çevir (hex ise)
    const keyBuffer = Buffer.from(ENCRYPTION_KEY, 'hex').length === 32 
        ? Buffer.from(ENCRYPTION_KEY, 'hex') 
        : Buffer.from(ENCRYPTION_KEY.slice(0, 32)); // Düz metin ise ilk 32 karakteri al

    const cipher = crypto.createCipheriv('aes-256-cbc', keyBuffer, iv);
    
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    // Sonuç: IV:ŞifreliVeri (İkisini birleştirip kaydediyoruz)
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

// Şifre Çözme Fonksiyonu (Çöpü Veriye Çevirir)
export function decrypt(text: string): string {
    if (!text) return '';

    try {
        const textParts = text.split(':');
        const iv = Buffer.from(textParts.shift()!, 'hex');
        const encryptedText = Buffer.from(textParts.join(':'), 'hex');
        
        const keyBuffer = Buffer.from(ENCRYPTION_KEY, 'hex').length === 32 
            ? Buffer.from(ENCRYPTION_KEY, 'hex') 
            : Buffer.from(ENCRYPTION_KEY.slice(0, 32));

        const decipher = crypto.createDecipheriv('aes-256-cbc', keyBuffer, iv);
        
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        
        return decrypted.toString();
    } catch (error) {
        console.error("Şifre çözme hatası:", error);
        return 'DATA_CORRUPTED';
    }
}