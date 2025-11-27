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

// Webhook için raw body parser
app.use('/webhook', express.raw({ type: 'application/json' }));

app.use(cors({ origin: '*' })); 
app.use(express.json());

// GLOBAL LOGLAYICI
app.use((req, res, next) => {
    if (req.url !== '/webhook') console.log(`[GELEN İSTEK] -> ${req.method} ${req.url}`);
    next();
});

interface AuthRequest extends Request { user?: any; }

const BLOCKED_CATEGORIES = ['betting_casino_gambling', 'dating_escort_services', 'massage_parlors', 'non_fi_money_orders'];

// --- HELPERLAR ---
function generateFakeCardNumber() { return "5555" + Math.floor(Math.random() * 1000000000000).toString().padStart(12, '0').substring(0,12); }
function generateCVV() { return "123"; }
function generateFakeName() { return "Hayalet Kullanıcı"; }
function generateGhostEmail() { return `ghost.${Math.floor(Math.random()*1000)}@mail.com`; }

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

app.get('/', (req, res) => { res.send('Ghost Protocol vMobile-Ready 📲'); });

// --- MEVCUT LOGIN/REGISTER/WEBHOOK ENDPOINTLERİ ---

app.post('/webhook', async (req, res) => {
    // ... (Webhook kodları aynı kalabilir, yer kaplamaması için kısalttım)
    res.json({received: true});
});

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

// -----------------------------------------------------
// YENİ: MOBİL ONAY SİSTEMİ
// -----------------------------------------------------

// 1. EKLENTİ ÇAĞIRIR: İşlem Başlat (Beklemeye Al)
app.post('/initiate-request', requireAuth, async (req: AuthRequest, res: Response) => {
    const { type, details } = req.body; // type: 'CREATE_CARD', details: { limit, merchant }
    const user = req.user;

    // İsteği veritabanına PENDING olarak kaydet
    const { data, error } = await supabase
        .from('requests')
        .insert({
            user_id: user.id,
            type: type || 'CREATE_CARD',
            details: details,
            status: 'PENDING'
        })
        .select()
        .single();

    if (error) return res.status(500).json({ error: error.message });

    // Eklentiye "Bekle" diyoruz ve Request ID dönüyoruz
    res.json({ 
        status: 'PENDING_APPROVAL', 
        message: 'Lütfen mobil uygulamanızdan işlemi onaylayın.',
        request_id: data.id 
    });
});

// 2. MOBİL UYGULAMA ÇAĞIRIR: Bekleyenleri Getir
app.get('/pending-requests', requireAuth, async (req: AuthRequest, res: Response) => {
    const { data } = await supabase
        .from('requests')
        .select('*')
        .eq('user_id', req.user.id)
        .eq('status', 'PENDING')
        .order('created_at', { ascending: false });

    res.json({ requests: data || [] });
});

// 3. MOBİL UYGULAMA ÇAĞIRIR: Onayla veya Reddet
app.post('/approve-request', requireAuth, async (req: AuthRequest, res: Response) => {
    const { request_id, action } = req.body; // action: 'APPROVE' | 'REJECT'
    const user = req.user;

    // İsteği bul
    const { data: reqData } = await supabase.from('requests').select('*').eq('id', request_id).single();
    if (!reqData) return res.status(404).json({ error: "İstek bulunamadı" });

    if (action === 'REJECT') {
        await supabase.from('requests').update({ status: 'REJECTED' }).eq('id', request_id);
        return res.json({ message: "İstek reddedildi." });
    }

    // EĞER ONAYLANDIYSA -> ASIL İŞLEMİ (KART YARATMAYI) ŞİMDİ YAP
    if (reqData.type === 'CREATE_CARD') {
        const { limit, merchant, cardType } = reqData.details;
        
        try {
            // A. Kullanıcı Kontrolü / Oluşturma
            let cardholderId;
            const existingHolders = await stripe.issuing.cardholders.list({ email: user.email, status: 'active', limit: 1 });

            if (existingHolders.data.length > 0) {
                cardholderId = existingHolders.data[0].id;
            } else {
                const newHolder = await stripe.issuing.cardholders.create({
                    name: 'Ghost User',
                    email: user.email,
                    phone_number: '+15555555555',
                    status: 'active',
                    type: 'individual',
                    individual: { first_name: 'Ghost', last_name: 'User', dob: { day: 1, month: 1, year: 1990 } },
                    billing: { address: { line1: '1234 Main St', city: 'San Francisco', state: 'CA', postal_code: '94111', country: 'US' } },
                });
                cardholderId = newHolder.id;
            }

            // B. Kartı Yarat
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

            // C. Detayları Al ve Kaydet
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
                spending_limit: limit || 100,
                merchant_lock: merchant || "Genel",
                status: 'ACTIVE'
            });

            // İsteği APPROVED olarak güncelle
            await supabase.from('requests').update({ status: 'APPROVED' }).eq('id', request_id);
            
            return res.json({ message: "İşlem onaylandı ve kart oluşturuldu!" });

        } catch (e: any) {
            console.error("Stripe Hatası:", e);
            return res.status(500).json({ error: "İşlem sırasında hata: " + e.message });
        }
    }
    
    // Varsayılan dönüş (eğer tip farklıysa)
    return res.json({ message: "İşlem kaydedildi." });
});

// 4. EKLENTİ SORAR: "Onaylandı mı?" (Polling)
app.get('/check-request-status/:id', requireAuth, async (req: AuthRequest, res: Response) => {
    const { data } = await supabase.from('requests').select('status').eq('id', req.params.id).single();
    res.json({ status: data?.status || 'UNKNOWN' });
});

app.listen(port, () => { console.log(`Server running on ${port}`); });