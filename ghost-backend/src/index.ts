import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { supabase } from './config/supabase';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// --- TİP TANIMLAMALARI ---
interface AuthRequest extends Request {
    user?: any;
}

// --- YARDIMCI FONKSİYONLAR ---
function generateFakeCardNumber() {
    const bin = "5555";
    const randomPart = Math.floor(Math.random() * 1000000000000).toString().padStart(12, '0');
    return (bin + randomPart).substring(0, 16);
}

function generateCVV() {
    return Math.floor(Math.random() * (999 - 100 + 1) + 100).toString();
}

// YENİ: Sahte İsim Üretici
function generateFakeName() {
    const names = ["Ali", "Ayşe", "Mehmet", "Zeynep", "Can", "Elif", "Murat", "Selin"];
    const surnames = ["Yılmaz", "Kaya", "Demir", "Çelik", "Şahin", "Yıldız", "Öztürk"];
    return names[Math.floor(Math.random() * names.length)] + " " + surnames[Math.floor(Math.random() * surnames.length)];
}

// YENİ: Sahte Email Üretici
function generateGhostEmail(name: string) {
    const cleanName = name.toLowerCase().replace(/ /g, '.').replace(/[^a-z0-9.]/g, '');
    const randomSuffix = Math.floor(Math.random() * 1000);
    return `${cleanName}.${randomSuffix}@ghostmail.com`;
}

// --- MIDDLEWARE ---
const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "Yetkisiz erişim! Token gerekli." });

    const token = authHeader.split(' ')[1];
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) return res.status(403).json({ error: "Geçersiz token." });

    req.user = user;
    next();
};

// --- ENDPOINTLER ---

app.get('/', (req: Request, res: Response) => {
    res.send('Ghost Protocol Backend (Auth + Identity) 👻');
});

// KAYIT OL
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

// GİRİŞ YAP
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

// KART VE KİMLİK YARAT
app.post('/create-card', requireAuth, async (req: AuthRequest, res: Response) => {
    const { limit, merchant } = req.body;
    const user = req.user;

    // Veri Üretimi
    const cardNumber = generateFakeCardNumber();
    const cvv = generateCVV();
    const expiry = "12/28";
    const fakeName = generateFakeName();
    const ghostEmail = generateGhostEmail(fakeName);
    const ghostPhone = "+90555" + Math.floor(Math.random() * 10000000);

    const { data, error } = await supabase
        .from('virtual_cards')
        .insert({
            user_id: user.id,
            card_number: cardNumber,
            cvv: cvv,
            expiry_date: expiry,
            spending_limit: limit,
            merchant_lock: merchant,
            status: 'ACTIVE'
        })
        .select()
        .single();

    if (error) return res.status(500).json({ error: error.message });

    // Cevap
    res.status(201).json({
        message: "Hayalet Kimlik Hazır! 👻",
        card: data,
        identity: {
            full_name: fakeName,
            email: ghostEmail,
            phone: ghostPhone
        }
    });
});

app.listen(port, () => {
    console.log(`[Server]: Sunucu http://localhost:${port} adresinde çalışıyor`);
});