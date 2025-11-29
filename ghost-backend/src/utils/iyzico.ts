import Iyzipay from 'iyzipay';
import dotenv from 'dotenv';

dotenv.config();

// Iyzico Ayarları (Render'da bu keyleri eklemen gerekecek)
const iyzipay = new Iyzipay({
    apiKey: process.env.IYZICO_API_KEY || 'sandbox-api-key',
    secretKey: process.env.IYZICO_SECRET_KEY || 'sandbox-secret-key',
    uri: 'https://sandbox-api.iyzipay.com' // Canlıya geçince değişecek
});

export default iyzipay;