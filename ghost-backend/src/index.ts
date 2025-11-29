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

// LOGLAYICI
app.use((req, res, next) => {
    if (req.url !== '/webhook') console.log(`[GELEN İSTEK] -> ${req.method} ${req.url}`);
    next();
});

interface AuthRequest extends Request { user?: any; }

const BLOCKED_CATEGORIES = ['betting_casino_gambling', 'dating_escort_services', 'massage_parlors'];

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

app.get('/', (req, res) => { res.send('Ghost Protocol vFinal (Mobile + Stripe Integrated) 🚀'); });

// --- AUTH & WEBHOOK ---
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

app.post('/webhook', async (req, res) => {
    let event;
    try { event = req.body; } catch (err: any) { return res.status(400).send(`Webhook Error: ${err.message}`); }
    if (event.type === 'issuing_authorization.created') {
        const auth = event.data.object;
        if (auth.card.metadata.type === 'SINGLE') {
            try { await stripe.issuing.cards.update(auth.card.id, { status: 'inactive' }); } catch (e) {}
        }
    }
    res.json({received: true});
});

app.get('/my-cards', requireAuth, async (req: AuthRequest, res: Response) => {
    const { data } = await supabase.from('virtual_cards').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false });
    const decrypted = data?.map(c => {
        try { return { ...c, card_number: decrypt(c.card_number) }; } 
        catch { return { ...c, card_number: "**** HATA ****" }; }
    }) || [];
    res.json({ cards: decrypted });
});

// -----------------------------------------------------
// MOBİL ONAY VE STRIPE İŞLEMLERİ
// -----------------------------------------------------

// 1. İSTEK BAŞLAT (Eklenti)
app.post('/initiate-request', requireAuth, async (req: AuthRequest, res: Response) => {
    const { type, details } = req.body; 
    const user = req.user;

    const { data, error } = await supabase.from('requests').insert({
        user_id: user.id,
        type: type || 'CREATE_CARD',
        details: details,
        status: 'PENDING'
    }).select().single();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ status: 'PENDING_APPROVAL', request_id: data.id });
});

// 2. BEKLEYENLERİ GETİR (Mobil)
app.get('/pending-requests', requireAuth, async (req: AuthRequest, res: Response) => {
    const { data } = await supabase.from('requests').select('*').eq('user_id', req.user.id).eq('status', 'PENDING').order('created_at', { ascending: false });
    res.json({ requests: data || [] });
});

// 3. İŞLEMİ ONAYLA VE KARTI YARAT (Mobil)
app.post('/approve-request', requireAuth, async (req: AuthRequest, res: Response) => {
    const { request_id, action } = req.body;
    const user = req.user;

    const { data: reqData } = await supabase.from('requests').select('*').eq('id', request_id).single();
    if (!reqData) return res.status(404).json({ error: "İstek bulunamadı" });

    if (action === 'REJECT') {
        await supabase.from('requests').update({ status: 'REJECTED' }).eq('id', request_id);
        return res.json({ message: "Reddedildi." });
    }

    // ONAYLANDIYSA -> STRIPE İŞLEMİNİ BAŞLAT
    if (reqData.type === 'CREATE_CARD') {
        const { limit, merchant, cardType } = reqData.details;
        
        try {
            console.log(`[STRIPE] İşlem başlıyor... Limit: ${limit}`);
            
            // A. Kullanıcı Kontrolü ve Tamir (US Adresi + Telefon)
            let cardholderId;
            const existingHolders = await stripe.issuing.cardholders.list({ email: user.email, status: 'active', limit: 1 });

            if (existingHolders.data.length > 0) {
                cardholderId = existingHolders.data[0].id;
                // Mevcut kullanıcıyı onar (Adres ve Telefon ekle)
                await stripe.issuing.cardholders.update(cardholderId, {
                    phone_number: '+15555555555',
                    billing: { address: { line1: '1234 Main St', city: 'San Francisco', state: 'CA', postal_code: '94111', country: 'US' } },
                    individual: { dob: { day: 1, month: 1, year: 1990 }, first_name: 'Ghost', last_name: 'User' }
                });
            } else {
                // Yeni kullanıcı yarat
                const newHolder = await stripe.issuing.cardholders.create({
                    name: 'Ghost User', email: user.email, phone_number: '+15555555555', status: 'active', type: 'individual',
                    individual: { first_name: 'Ghost', last_name: 'User', dob: { day: 1, month: 1, year: 1990 } },
                    billing: { address: { line1: '1234 Main St', city: 'San Francisco', state: 'CA', postal_code: '94111', country: 'US' } },
                });
                cardholderId = newHolder.id;
            }

            // B. Kart Yarat
            const stripeCard = await stripe.issuing.cards.create({
                cardholder: cardholderId,
                currency: 'usd',
                type: 'virtual',
                status: 'active',
                spending_controls: {
                    spending_limits: [{ amount: (limit || 100) * 100, interval: 'per_authorization' }],
                    blocked_categories: BLOCKED_CATEGORIES as any,
                },
                metadata: { merchant_lock: merchant || "Genel", type: cardType || "SUB" }
            });

            // C. Kaydet
            const cardDetails = await stripe.issuing.cards.retrieve(stripeCard.id, { expand: ['number', 'cvc'] });
            const rawCardNumber = cardDetails.number || generateFakeCardNumber(); 
            const rawCVV = cardDetails.cvc || "123";
            const expiry = `${stripeCard.exp_month}/${stripeCard.exp_year}`;

            const encryptedCardNumber = encrypt(rawCardNumber);
            const encryptedCVV = encrypt(rawCVV);

            await supabase.from('virtual_cards').insert({
                user_id: user.id,
                card_number: encryptedCardNumber,
                cvv: encryptedCVV,
                expiry_date: expiry,
                spending_limit: limit,
                merchant_lock: merchant,
                status: 'ACTIVE'
            });

            // D. İsteği Kapat
            await supabase.from('requests').update({ status: 'APPROVED' }).eq('id', request_id);
            
            console.log("[BAŞARILI] Kart oluşturuldu.");
            return res.json({ message: "Onaylandı ve Kart Oluşturuldu!" });

        } catch (e: any) {
            console.error("[HATA]", e);
            // Hata olsa bile isteği kapatmıyoruz ki tekrar denenebilsin veya loglansın
            return res.status(500).json({ error: "Stripe Hatası: " + e.message });
        }
    }
    
    return res.json({ message: "İşlem kaydedildi." });
});

// 4. DURUM KONTROL (Eklenti Polling)
app.get('/check-request-status/:id', requireAuth, async (req: AuthRequest, res: Response) => {
    const { data } = await supabase.from('requests').select('status').eq('id', req.params.id).single();
    res.json({ status: data?.status || 'UNKNOWN' });
});

app.listen(port, () => { console.log(`Server running on ${port}`); });