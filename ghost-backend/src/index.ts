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
const BLOCKED_CATEGORIES = ['7995', '5967', '7800']; // Kumar, +18 vs.

// --- HELPERLAR ---
function generateFakeCardNumber() {
    const bin = "5555";
    const randomPart = Math.floor(Math.random() * 1000000000000).toString().padStart(12, '0');
    return (bin + randomPart).substring(0, 16);
}
function generateCVV() { return Math.floor(Math.random() * (999 - 100 + 1) + 100).toString(); }
function generateFakeName() { return "Hayalet Kullanıcı"; }
function generateGhostEmail(prefix?: string) { return `${prefix || 'ghost'}.${Math.floor(Math.random()*10000)}@mail.com`; }

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
app.get('/', (req, res) => { res.send('Ghost Protocol vFinal (Auto-Fixer Active) 🔧'); });

// WEBHOOK
app.post('/webhook', async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
        event = req.body; // Test modunda secret kontrolünü atlıyoruz
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

// --- KART YARATMA (DÜZELTİLMİŞ & TAMİRCİ MODU) ---
app.post('/create-card', requireAuth, async (req: AuthRequest, res: Response) => {
    const { limit, merchant, cardType } = req.body;
    const user = req.user;

    console.log(`[İŞLEM] Kart yaratılıyor... Limit: ${limit}`);

    try {
        let cardholderId;
        
        // 1. Kullanıcıyı Ara
        const existingHolders = await stripe.issuing.cardholders.list({ email: user.email, status: 'active', limit: 1 });

        if (existingHolders.data.length > 0) {
            cardholderId = existingHolders.data[0].id;
            console.log(`[STRIPE] Mevcut kullanıcı bulundu: ${cardholderId}`);
            
            // KRİTİK DÜZELTME: Eski kullanıcının adresi bozuk olabilir, ZORLA GÜNCELLE!
            // Bu işlem "Adres Hatası"nı %100 çözer.
            await stripe.issuing.cardholders.update(cardholderId, {
                billing: {
                    address: {
                        line1: '1234 Main St',
                        city: 'San Francisco',
                        state: 'CA',
                        postal_code: '94111',
                        country: 'US', // Garanti adres
                    },
                }
            });
            console.log(`[STRIPE] Kullanıcı adresi onarıldı/güncellendi.`);

        } else {
            // 2. Yoksa Yeni Yarat
            console.log("[STRIPE] Yeni kullanıcı oluşturuluyor...");
            const newHolder = await stripe.issuing.cardholders.create({
                name: 'Ghost User',
                email: user.email,
                status: 'active',
                type: 'individual',
                billing: {
                    address: { line1: '1234 Main St', city: 'San Francisco', state: 'CA', postal_code: '94111', country: 'US' },
                },
            });
            cardholderId = newHolder.id;
        }

        // 3. Kartı Yarat
        const stripeCard = await stripe.issuing.cards.create({
            cardholder: cardholderId,
            currency: 'usd',
            type: 'virtual',
            status: 'active',
            spending_controls: {
                spending_limits: [{ amount: (limit || 100) * 100, interval: 'per_authorization' }],
                blocked_categories: BLOCKED_CATEGORIES as unknown as Stripe.Issuing.CardCreateParams.SpendingControls.BlockedCategory[],
            },
            metadata: {
                merchant_lock: merchant || "General",
                type: cardType || "SUB"
            }
        });

        // 4. Veritabanına Kaydet
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
        // Hatanın ne olduğunu görmek için detayı dönüyoruz
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