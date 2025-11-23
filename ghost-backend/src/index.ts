import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { supabase } from './config/supabase';
import { encrypt, decrypt } from './utils/crypto';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

interface AuthRequest extends Request {
    user?: any;
}

function generateFakeCardNumber() {
    const bin = "5555";
    const randomPart = Math.floor(Math.random() * 1000000000000).toString().padStart(12, '0');
    return (bin + randomPart).substring(0, 16);
}

function generateCVV() {
    return Math.floor(Math.random() * (999 - 100 + 1) + 100).toString();
}

function generateFakeName() {
    const names = ["Ali", "Ayşe", "Mehmet", "Zeynep", "Can", "Elif", "Murat", "Selin"];
    const surnames = ["Yılmaz", "Kaya", "Demir", "Çelik", "Şahin", "Yıldız", "Öztürk"];
    return names[Math.floor(Math.random() * names.length)] + " " + surnames[Math.floor(Math.random() * surnames.length)];
}

function generateGhostEmail(name: string) {
    const cleanName = name.toLowerCase().replace(/ /g, '.').replace(/[^a-z0-9.]/g, '');
    const randomSuffix = Math.floor(Math.random() * 1000);
    return `${cleanName}.${randomSuffix}@ghostmail.com`;
}

const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "Yetkisiz erişim! Token gerekli." });

    const token = authHeader.split(' ')[1];
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) return res.status(403).json({ error: "Geçersiz token." });

    req.user = user;
    next();
};

app.get('/', (req: Request, res: Response) => {
    res.send('Ghost Protocol Backend (Wallet Mode 👛) 👻');
});

app.get('/debug-crypto', (req: Request, res: Response) => {
    try {
        const testText = "GizliMesaj123";
        const encrypted = encrypt(testText);
        const decrypted = decrypt(encrypted);
        
        res.json({
            status: "OK",
            env_key_check: process.env.ENCRYPTION_KEY ? "Anahtar VAR" : "Anahtar YOK ❌",
            decrypted_check: decrypted === testText ? "Şifre Çözme Başarılı ✅" : "Şifre Çözme HATALI ❌"
        });
    } catch (error: any) {
        res.status(500).json({ error: "Kritik Hata", detail: error.message });
    }
});

app.post('/register', async (req: Request, res: Response) => {
    const { email, password, full_name, phone } = req.body;
    const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });

    if (authError) return res.status(400).json({ error: authError.message });
    if (!authData.user) return res.status(400).json({ error: "Kullanıcı oluşturulamadı" });

    await supabase.from('users').insert({
        id: authData.user.id,
        email: email,
        full_name: full_name,
        username: email.split('@')[0],
        phone: phone
    });

    res.json({ message: "Kayıt başarılı!", user: authData.user });
});

app.post('/login', async (req: Request, res: Response) => {
    const { email, password } = req.body;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: "Hatalı email veya şifre" });

    res.json({ 
        message: "Giriş başarılı",
        access_token: data.session.access_token,
        user: data.user
    });
});

app.post('/create-card', requireAuth, async (req: AuthRequest, res: Response) => {
    const { limit, merchant } = req.body;
    const user = req.user;

    const rawCardNumber = generateFakeCardNumber();
    const rawCVV = generateCVV();
    const expiry = "12/28";
    const fakeName = generateFakeName();
    const ghostEmail = generateGhostEmail(fakeName);
    const ghostPhone = "+90555" + Math.floor(Math.random() * 10000000);

    let encryptedCardNumber, encryptedCVV;
    try {
        encryptedCardNumber = encrypt(rawCardNumber);
        encryptedCVV = encrypt(rawCVV);
    } catch (e) {
        return res.status(500).json({ error: "Şifreleme hatası" });
    }

    const { data, error } = await supabase
        .from('virtual_cards')
        .insert({
            user_id: user.id,
            card_number: encryptedCardNumber,
            cvv: encryptedCVV,
            expiry_date: expiry,
            spending_limit: limit,
            merchant_lock: merchant,
            status: 'ACTIVE'
        })
        .select()
        .single();

    if (error) return res.status(500).json({ error: error.message });

    res.status(201).json({
        message: "Kart Oluşturuldu",
        card: { ...data, card_number: rawCardNumber, cvv: rawCVV },
        identity: { full_name: fakeName, email: ghostEmail, phone: ghostPhone }
    });
});

// --- YENİ: ESKİ KARTLARI GETİR (CÜZDAN) ---
app.get('/my-cards', requireAuth, async (req: AuthRequest, res: Response) => {
    const user = req.user;

    // 1. Kullanıcının tüm kartlarını çek
    const { data, error } = await supabase
        .from('virtual_cards')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false }); // En yeni en üstte

    if (error) return res.status(500).json({ error: error.message });

    // 2. Kart numaralarının şifresini çözüp gönder
    const decryptedCards = data.map(card => {
        try {
            return {
                ...card,
                card_number: decrypt(card.card_number), // Çöz
                cvv: decrypt(card.cvv)                 // Çöz
            };
        } catch (e) {
            return { ...card, card_number: "**** HATA ****", cvv: "***" };
        }
    });

    res.json({ cards: decryptedCards });
});

app.listen(port, () => {
    console.log(`[Server]: Sunucu http://localhost:${port} adresinde çalışıyor`);
});