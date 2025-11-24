import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Stripe from 'stripe'; 
import { supabase } from './config/supabase';
import { encrypt, decrypt } from './utils/crypto';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// STRIPE AYARI
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
    apiVersion: '2025-11-17.clover',
});

// 1. CORS AYARI (Herkesi kabul et)
app.use(cors({ origin: '*' })); 
app.use(express.json());

// 2. GLOBAL LOGLAYICI (KAPIDAKİ AJAN)
// Bu, sunucuya gelen HER isteği ekrana yazar.
app.use((req, res, next) => {
    console.log(`[GELEN İSTEK] -> ${req.method} ${req.url}`);
    next();
});

interface AuthRequest extends Request { user?: any; }

// --- HELPERLAR ---
function generateFakeCardNumber() {
    const bin = "5555";
    const randomPart = Math.floor(Math.random() * 1000000000000).toString().padStart(12, '0');
    return (bin + randomPart).substring(0, 16);
}
function generateCVV() { return Math.floor(Math.random() * (999 - 100 + 1) + 100).toString(); }
function generateFakeName() { return "Hayalet Kullanıcı"; }
function generateGhostEmail(name: string) { return `ghost.${Math.floor(Math.random()*10000)}@mail.com`; }

// --- MIDDLEWARE ---
const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    console.log("[AUTH] Token kontrol ediliyor..."); // LOG EKLENDİ
    
    if (!authHeader) {
        console.log("[AUTH HATA] Token yok!");
        return res.status(401).json({ error: "Token yok" });
    }
    
    const token = authHeader.split(' ')[1];
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
        console.log("[AUTH HATA] Token geçersiz:", error?.message);
        return res.status(403).json({ error: "Geçersiz token" });
    }
    
    console.log(`[AUTH BAŞARILI] Kullanıcı: ${user.email}`);
    req.user = user;
    next();
};

// --- ENDPOINTLER ---
app.get('/', (req, res) => { 
    console.log("[LOG] Ana sayfaya ping atıldı.");
    res.send('Ghost Protocol vFinal (Loglu) 👻'); 
});

app.post('/register', async (req, res) => {
    console.log("[LOG] Kayıt isteği:", req.body.email);
    const { email, password, full_name } = req.body;
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return res.status(400).json({ error: error.message });
    if (data.user) {
        await supabase.from('users').insert({
            id: data.user.id, email: email, full_name: full_name || "Anonim", username: email.split('@')[0]
        });
    }
    res.json({ message: "Kayıt başarılı", user: data.user });
});

app.post('/login', async (req, res) => {
    console.log("[LOG] Giriş isteği:", req.body.email);
    const { email, password } = req.body;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
        console.log("[LOGIN HATA]", error.message);
        return res.status(401).json({ error: "Hatalı giriş bilgileri" });
    }
    res.json({ access_token: data.session.access_token, user: data.user });
});

// KART YARATMA
app.post('/create-card', requireAuth, async (req: AuthRequest, res: Response) => {
    const { limit, merchant, cardType } = req.body;
    const user = req.user;

    console.log(`[İŞLEM] Kart yaratılıyor... Tip: ${cardType}, Limit: ${limit}`);

    try {
        let cardholderId;
        const existingHolders = await stripe.issuing.cardholders.list({ email: user.email, status: 'active', limit: 1 });

        if (existingHolders.data.length > 0) {
            cardholderId = existingHolders.data[0].id;
        } else {
            const newHolder = await stripe.issuing.cardholders.create({
                name: 'Ghost User',
                email: user.email,
                status: 'active',
                type: 'individual',
                billing: {
                    address: { line1: 'Istiklal Cad', city: 'Istanbul', state: 'TR', postal_code: '34000', country: 'TR' },
                },
            });
            cardholderId = newHolder.id;
        }

        const stripeCard = await stripe.issuing.cards.create({
            cardholder: cardholderId,
            currency: 'usd',
            type: 'virtual',
            status: 'active',
            spending_controls: { spending_limits: [{ amount: (limit || 100) * 100, interval: 'per_authorization' }] },
            metadata: { merchant_lock: merchant || "General" }
        });

        const cardDetails = await stripe.issuing.cards.retrieve(stripeCard.id, { expand: ['number', 'cvc'] });
        const rawCardNumber = cardDetails.number || generateFakeCardNumber(); 
        const rawCVV = cardDetails.cvc || generateCVV();
        const expiry = `${stripeCard.exp_month}/${stripeCard.exp_year}`;

        const encryptedCardNumber = encrypt(rawCardNumber);
        const encryptedCVV = encrypt(rawCVV);

        const { data: dbCard, error: dbError } = await supabase
            .from('virtual_cards')
            .insert({
                user_id: user.id,
                card_number: encryptedCardNumber,
                cvv: encryptedCVV,
                expiry_date: expiry,
                spending_limit: limit || 100,
                merchant_lock: merchant || "Genel",
                status: 'ACTIVE'
            })
            .select().single();

        if (dbError) throw new Error(dbError.message);

        console.log("[BAŞARILI] Kart oluşturuldu ve veritabanına yazıldı.");

        res.json({
            message: "Kart Hazır",
            card: { ...dbCard, card_number: rawCardNumber, cvv: rawCVV, type: cardType },
            identity: { full_name: generateFakeName(), email: generateGhostEmail("Ghost"), phone: "+905550000000" }
        });

    } catch (error: any) {
        console.error("[KRİTİK STRIPE HATASI]:", error);
        res.status(500).json({ error: "Stripe Hatası", detail: error.message });
    }
});

app.get('/my-cards', requireAuth, async (req: AuthRequest, res: Response) => {
    const { data } = await supabase.from('virtual_cards').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false });
    const decrypted = data?.map(c => {
        try { return { ...c, card_number: decrypt(c.card_number) }; } 
        catch { return { ...c, card_number: "**** HATA ****" }; }
    }) || [];
    res.json({ cards: decrypted });
});

app.listen(port, () => { console.log(`[BAŞLATILDI] Server port ${port} üzerinde çalışıyor...`); });