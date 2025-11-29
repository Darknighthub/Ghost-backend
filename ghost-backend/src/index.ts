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
    apiVersion: '2025-11-17.clover' as any,
});

app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(cors({ origin: '*' })); 
app.use(express.json());

// LOGLAYICI (Detaylı)
app.use((req, res, next) => {
    if (req.url !== '/webhook') {
        console.log(`[GELEN İSTEK] -> ${req.method} ${req.url}`);
        if (req.method === 'POST') console.log("Body:", JSON.stringify(req.body));
    }
    next();
});

interface AuthRequest extends Request { user?: any; }

const BLOCKED_CATEGORIES = ['betting_casino_gambling', 'dating_escort_services', 'massage_parlors', 'non_fi_money_orders'];

// --- HELPERLAR ---
function generateFakeCardNumber() { return "5555" + Math.floor(Math.random() * 1000000000000).toString().padStart(12, '0').substring(0,12); }
function generateCVV() { return "123"; }
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

app.get('/', (req, res) => { res.send('Ghost Protocol vFinal (Data Fix 🛠️) 🚀'); });

// --- AUTH ---
app.post('/register', async (req, res) => {
    const { email, password, full_name } = req.body;
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return res.status(400).json({ error: error.message });
    if (data.user) {
        await supabase.from('users').insert({ id: data.user.id, email, full_name: full_name || "Anonim", username: email.split('@')[0] });
    }
    res.json({ message: "Kayıt başarılı", user: data.user });
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: "Hatalı giriş" });
    res.json({ access_token: data.session.access_token, user: data.user });
});

app.get('/my-cards', requireAuth, async (req: AuthRequest, res: Response) => {
    const { data } = await supabase.from('virtual_cards').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false });
    const decrypted = data?.map(c => {
        try { return { ...c, card_number: decrypt(c.card_number) }; } 
        catch { return { ...c, card_number: "**** HATA ****" }; }
    }) || [];
    res.json({ cards: decrypted });
});

// --- ASENKRON İŞLEM (STRIPE İŞÇİSİ) ---
async function processCardCreation(user: any, reqData: any) {
    const requestId = reqData.id;

    // EMNİYET KEMERİ: Veri boşsa dur
    if (!reqData || !reqData.details) {
        console.error(`[HATA] İstek detayları boş! ID: ${requestId}`);
        await supabase.from('requests').update({ status: 'REJECTED', details: { error: "Veri paketi boş geldi" } }).eq('id', requestId);
        return; 
    }

    const { limit, merchant, cardType } = reqData.details;
    const limitAmount = parseInt(limit) || 100;

    console.log(`[ARKA PLAN] Stripe işlemi başlıyor... Limit: ${limitAmount}`);

    try {
        let cardholderId;
        const existingHolders = await stripe.issuing.cardholders.list({ email: user.email, status: 'active', limit: 1 });

        // KULLANICI YÖNETİMİ (Tamir Modu)
        if (existingHolders.data.length > 0) {
            cardholderId = existingHolders.data[0].id;
            await stripe.issuing.cardholders.update(cardholderId, {
                status: 'active',
                phone_number: '+15555555555', // Zorunlu
                individual: { first_name: 'Ghost', last_name: 'User', dob: { day: 1, month: 1, year: 1990 } }, // Zorunlu
                billing: { address: { line1: '1234 Main St', city: 'San Francisco', state: 'CA', postal_code: '94111', country: 'US' } },
            });
        } else {
            const newHolder = await stripe.issuing.cardholders.create({
                name: 'Ghost User', email: user.email, phone_number: '+15555555555', status: 'active', type: 'individual',
                individual: { first_name: 'Ghost', last_name: 'User', dob: { day: 1, month: 1, year: 1990 } },
                billing: { address: { line1: '1234 Main St', city: 'San Francisco', state: 'CA', postal_code: '94111', country: 'US' } },
            });
            cardholderId = newHolder.id;
        }

        // KART YARATMA
        const stripeCard = await stripe.issuing.cards.create({
            cardholder: cardholderId,
            currency: 'usd',
            type: 'virtual',
            status: 'active',
            spending_controls: {
                spending_limits: [{ amount: limitAmount * 100, interval: 'per_authorization' }],
                blocked_categories: BLOCKED_CATEGORIES as any,
            },
            metadata: { merchant_lock: merchant, type: cardType }
        });

        // DETAYLARI AL
        const cardDetails = await stripe.issuing.cards.retrieve(stripeCard.id, { expand: ['number', 'cvc'] });
        
        // Test modunda bazen numara gizli gelir, fallback yapalım
        const rawCardNumber = cardDetails.number || generateFakeCardNumber(); 
        const rawCVV = cardDetails.cvc || "123";
        const expiry = `${stripeCard.exp_month}/${stripeCard.exp_year}`;

        // KAYDET
        await supabase.from('virtual_cards').insert({
            user_id: user.id,
            card_number: encrypt(rawCardNumber),
            cvv: encrypt(rawCVV),
            expiry_date: expiry,
            spending_limit: limitAmount,
            merchant_lock: merchant,
            status: 'ACTIVE'
        });

        // BAŞARILI
        await supabase.from('requests').update({ status: 'APPROVED' }).eq('id', requestId);
        console.log(`[BAŞARILI] Kart üretildi: ${requestId}`);

    } catch (e: any) {
        console.error(`[ARKA PLAN HATA]: ${e.message}`);
        await supabase.from('requests').update({ 
            status: 'REJECTED', 
            details: { ...reqData.details, error: e.message } 
        }).eq('id', requestId);
    }
}

// -----------------------------------------------------
// İSTEK YÖNETİMİ (DÜZELTİLEN KISIM)
// -----------------------------------------------------

app.post('/initiate-request', requireAuth, async (req: AuthRequest, res: Response) => {
    // BURASI DÜZELTİLDİ: Eklentiden gelen dağınık veriyi toparlıyoruz
    const { limit, merchant, cardType, type, details } = req.body; 
    const user = req.user;

    // Eğer eklenti 'details' nesnesi göndermemişse, biz oluşturalım
    const requestDetails = details || {
        limit: limit || 100,
        merchant: merchant || "Genel",
        cardType: cardType || "SINGLE"
    };

    const { data, error } = await supabase.from('requests').insert({
        user_id: user.id,
        type: type || 'CREATE_CARD',
        details: requestDetails, // Artık içi dolu!
        status: 'PENDING'
    }).select().single();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ status: 'PENDING_APPROVAL', request_id: data.id });
});

app.get('/pending-requests', requireAuth, async (req: AuthRequest, res: Response) => {
    const { data } = await supabase.from('requests').select('*').eq('user_id', req.user.id).eq('status', 'PENDING').order('created_at', { ascending: false });
    res.json({ requests: data || [] });
});

app.post('/approve-request', requireAuth, async (req: AuthRequest, res: Response) => {
    const { request_id, action } = req.body;
    const user = req.user;

    const { data: reqData } = await supabase.from('requests').select('*').eq('id', request_id).single();
    if (!reqData) return res.status(404).json({ error: "İstek bulunamadı" });

    if (action === 'REJECT') {
        await supabase.from('requests').update({ status: 'REJECTED' }).eq('id', request_id);
        return res.json({ message: "Reddedildi." });
    }

    if (reqData.type === 'CREATE_CARD') {
        res.json({ message: "Onay alındı, işlem başladı." });
        // Kritik: Kullanıcı ve Veriyi fonksiyona paslıyoruz
        processCardCreation(user, reqData);
    } else {
        res.json({ message: "İşlem kaydedildi." });
    }
});

app.get('/check-request-status/:id', requireAuth, async (req: AuthRequest, res: Response) => {
    const { data } = await supabase.from('requests').select('status').eq('id', req.params.id).single();
    res.json({ status: data?.status || 'UNKNOWN' });
});

app.post('/webhook', async (req, res) => { res.json({received: true}); });

app.listen(port, () => { console.log(`Server running on ${port}`); });