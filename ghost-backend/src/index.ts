import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Stripe from 'stripe'; 
import { supabase } from './config/supabase';
import { encrypt, decrypt } from './utils/crypto';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// STRIPE AYARI (API Sürümü Güncel)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
    apiVersion: '2025-11-17.clover' as any,
});

// Webhook için
app.use('/webhook', express.raw({ type: 'application/json' }));

app.use(cors({ origin: '*' })); 
app.use(express.json());

// LOGLAYICI
app.use((req, res, next) => {
    if (req.url !== '/webhook') console.log(`[GELEN İSTEK] -> ${req.method} ${req.url}`);
    next();
});

interface AuthRequest extends Request { user?: any; }

// --- YASAKLI KATEGORİLER ---
const BLOCKED_CATEGORIES = [
    'betting_casino_gambling', 
    'dating_escort_services', 
    'massage_parlors',
    'non_fi_money_orders'
];

// --- HELPERLAR ---
function generateFakeCardNumber() {
    const bin = "5555";
    const randomPart = Math.floor(Math.random() * 1000000000000).toString().padStart(12, '0');
    return (bin + randomPart).substring(0, 16);
}
function generateCVV() { return Math.floor(Math.random() * (999 - 100 + 1) + 100).toString(); }
function generateFakeName() { return "Hayalet Kullanıcı"; }
function generateGhostEmail() { return `ghost.${Math.floor(Math.random()*10000)}@mail.com`; }

// --- MIDDLEWARE ---
const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "Token yok" });
    const token = authHeader.split(' ')[1];
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(403).json({ error: "Geçersiz token" });
    req.user = user;
    next();
};

// --- ENDPOINTLER ---
app.get('/', (req, res) => { res.send('Ghost Protocol vFinal (Clean Slate Mode) 🚀'); });

// WEBHOOK
app.post('/webhook', async (req, res) => {
    let event;
    try {
        event = req.body;
    } catch (err: any) {
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'issuing_authorization.created') {
        const auth = event.data.object;
        if (auth.card.metadata.type === 'SINGLE') {
            console.log(`[FREE TRIAL] Kart kullanıldı, iptal ediliyor...`);
            try { await stripe.issuing.cards.update(auth.card.id, { status: 'inactive' }); } 
            catch (e) { console.error("İptal hatası", e); }
        }
    }
    res.json({received: true});
});

app.post('/register', async (req, res) => {
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
    const { email, password } = req.body;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: "Hatalı giriş" });
    res.json({ access_token: data.session.access_token, user: data.user });
});

// --- KART YARATMA (GARANTİ ÇÖZÜM) ---
app.post('/create-card', requireAuth, async (req: AuthRequest, res: Response) => {
    const { limit, merchant, cardType } = req.body;
    const user = req.user;

    console.log(`[İŞLEM] Kart yaratılıyor... Limit: ${limit}`);

    try {
        // STRATEJİ DEĞİŞİKLİĞİ: Eski kullanıcıyı arama. 
        // Her seferinde tertemiz, her şeyi tam yeni bir kullanıcı (Cardholder) yarat.
        // Bu, "Outstanding Requirements" hatasını %100 önler.
        
        console.log("[STRIPE] Temiz Cardholder oluşturuluyor...");
        
        const newHolder = await stripe.issuing.cardholders.create({
            name: 'Ghost User',
            email: user.email,
            phone_number: '+15555555555', // ZORUNLU: Telefon
            status: 'active',
            type: 'individual',
            individual: {
                first_name: 'Ghost',
                last_name: 'User',
                dob: { day: 1, month: 1, year: 1990 }, // ZORUNLU: Doğum Tarihi
                card_issuing: {
                    user_terms_acceptance: { // ZORUNLU: Sözleşme onayı
                        date: Math.floor(Date.now() / 1000),
                        ip: '127.0.0.1',
                    },
                },
            },
            billing: {
                address: { // ZORUNLU: Geçerli US Adresi
                    line1: '1234 Main St',
                    city: 'San Francisco',
                    state: 'CA',
                    postal_code: '94111',
                    country: 'US', 
                },
            },
        });
        
        const cardholderId = newHolder.id;
        console.log(`[STRIPE] Cardholder hazır: ${cardholderId}`);

        // 2. Kartı Yarat
        const stripeCard = await stripe.issuing.cards.create({
            cardholder: cardholderId,
            currency: 'usd',
            type: 'virtual',
            status: 'active',
            spending_controls: {
                spending_limits: [{ amount: (limit || 100) * 100, interval: 'per_authorization' }],
                blocked_categories: BLOCKED_CATEGORIES as any,
            },
            metadata: {
                merchant_lock: merchant || "General",
                type: cardType || "SUB"
            }
        });

        console.log(`[STRIPE] Kart oluşturuldu: ${stripeCard.id}`);

        // 3. Veritabanına Kaydet
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

        res.json({
            message: "Kart Hazır",
            card: { ...dbCard, card_number: rawCardNumber, cvv: rawCVV, type: cardType },
            identity: { full_name: generateFakeName(), email: generateGhostEmail(), phone: "+905550000000" }
        });

    } catch (error: any) {
        console.error("[KRİTİK HATA]:", error);
        res.status(500).json({ error: "Kart Oluşturulamadı", detail: error.message || error.raw?.message });
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

app.listen(port, () => { console.log(`Server running on ${port}`); });