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

const BLOCKED_CATEGORIES = ['betting_casino_gambling', 'dating_escort_services', 'massage_parlors', 'non_fi_money_orders'];

// --- HELPERLAR ---
function generateFakeCardNumber() { return "5555" + Math.floor(Math.random() * 1000000000000).toString().padStart(12, '0').substring(0,12); }
function generateCVV() { return "123"; }
function generateFakeName() { return "Hayalet Kullanıcı"; }
function generateGhostEmail() { return `ghost.${Math.floor(Math.random()*10000)}@mail.com`; }

// --- YENİ: EXPO PUSH BİLDİRİM FONKSİYONU ---
async function sendPushNotification(expoPushToken: string, title: string, body: string) {
    const message = {
        to: expoPushToken,
        sound: 'default',
        title: title,
        body: body,
        data: { screen: 'Requests' }, // Bildirime tıklayınca açılacak ekran
    };

    await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Accept-encoding': 'gzip, deflate',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
    });
}

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

app.get('/', (req, res) => { res.send('Ghost Protocol vFinal (Push Notifications 🔔) 🚀'); });

// --- AUTH & USER ---
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

// YENİ: PUSH TOKEN KAYDETME
app.post('/update-push-token', requireAuth, async (req: AuthRequest, res: Response) => {
    const { pushToken } = req.body;
    const { error } = await supabase.from('users').update({ push_token: pushToken }).eq('id', req.user.id);
    if(error) return res.status(500).json({ error: error.message });
    res.json({ message: "Bildirim ayarları güncellendi." });
});

app.get('/my-cards', requireAuth, async (req: AuthRequest, res: Response) => {
    const { data } = await supabase.from('virtual_cards').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false });
    const decrypted = data?.map(c => {
        try { return { ...c, card_number: decrypt(c.card_number) }; } 
        catch { return { ...c, card_number: "**** HATA ****" }; }
    }) || [];
    res.json({ cards: decrypted });
});

// KAYNAK KARTLAR
app.post('/add-source-card', requireAuth, async (req: AuthRequest, res: Response) => {
    const { cardNumber, bankName, brand, expiry } = req.body;
    const { data, error } = await supabase.from('source_cards').insert({
        user_id: req.user.id, bank_name: bankName || "Banka", brand: brand || "Visa",
        last4: cardNumber.slice(-4), expiry_date: expiry, status: 'ACTIVE'
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: "Eklendi", card: data });
});

app.get('/source-cards', requireAuth, async (req: AuthRequest, res: Response) => {
    const { data } = await supabase.from('source_cards').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false });
    res.json({ cards: data || [] });
});

// --- İŞLEM AKIŞI ---

async function processCardCreation(user: any, reqData: any) {
    const requestId = reqData.id;
    if (!reqData || !reqData.details) return; // Hata koruması

    const { limit, merchant, cardType } = reqData.details;
    const limitAmount = parseInt(limit) || 100;

    try {
        let cardholderId;
        const existingHolders = await stripe.issuing.cardholders.list({ email: user.email, status: 'active', limit: 1 });

        if (existingHolders.data.length > 0) {
            cardholderId = existingHolders.data[0].id;
            await stripe.issuing.cardholders.update(cardholderId, {
                status: 'active', phone_number: '+15555555555',
                individual: { first_name: 'Ghost', last_name: 'User', dob: { day: 1, month: 1, year: 1990 } },
                billing: { address: { line1: '1234 Main St', city: 'SF', state: 'CA', postal_code: '94111', country: 'US' } },
            });
        } else {
            const newHolder = await stripe.issuing.cardholders.create({
                name: 'Ghost User', email: user.email, phone_number: '+15555555555', status: 'active', type: 'individual',
                individual: { first_name: 'Ghost', last_name: 'User', dob: { day: 1, month: 1, year: 1990 } },
                billing: { address: { line1: '1234 Main St', city: 'SF', state: 'CA', postal_code: '94111', country: 'US' } },
            });
            cardholderId = newHolder.id;
        }

        const stripeCard = await stripe.issuing.cards.create({
            cardholder: cardholderId, currency: 'usd', type: 'virtual', status: 'active',
            spending_controls: { spending_limits: [{ amount: limitAmount * 100, interval: 'per_authorization' }], blocked_categories: BLOCKED_CATEGORIES as any },
            metadata: { merchant_lock: merchant, type: cardType }
        });

        const cardDetails = await stripe.issuing.cards.retrieve(stripeCard.id, { expand: ['number', 'cvc'] });
        const rawCardNumber = cardDetails.number || generateFakeCardNumber(); 
        const rawCVV = cardDetails.cvc || "123";
        const expiry = `${stripeCard.exp_month}/${stripeCard.exp_year}`;

        await supabase.from('virtual_cards').insert({
            user_id: user.id, card_number: encrypt(rawCardNumber), cvv: encrypt(rawCVV),
            expiry_date: expiry, spending_limit: limitAmount, merchant_lock: merchant, status: 'ACTIVE'
        });

        await supabase.from('requests').update({ status: 'APPROVED' }).eq('id', requestId);
        
        // BAŞARI BİLDİRİMİ (Opsiyonel: İşlem bitince de bildirim atabiliriz)
        // await sendPushNotification(userToken, "İşlem Tamam!", "Kartınız oluşturuldu.");

    } catch (e: any) {
        await supabase.from('requests').update({ status: 'REJECTED', details: { ...reqData.details, error: e.message } }).eq('id', requestId);
    }
}

// 1. İSTEK BAŞLAT (BİLDİRİM GÖNDEREN KISIM)
app.post('/initiate-request', requireAuth, async (req: AuthRequest, res: Response) => {
    const { limit, merchant, cardType, type, details } = req.body; 
    const user = req.user;
    const requestDetails = details || { limit: limit || 100, merchant: merchant || "Genel", cardType: cardType || "SINGLE" };

    const { data, error } = await supabase.from('requests').insert({
        user_id: user.id, type: type || 'CREATE_CARD', details: requestDetails, status: 'PENDING'
    }).select().single();

    if (error) return res.status(500).json({ error: error.message });

    // --- BİLDİRİM GÖNDER ---
    // Kullanıcının Push Token'ını al
    const { data: userData } = await supabase.from('users').select('push_token').eq('id', user.id).single();
    
    if (userData?.push_token) {
        console.log("Bildirim gönderiliyor:", userData.push_token);
        await sendPushNotification(
            userData.push_token,
            "Onay Bekleniyor 🔔",
            `${merchant} için ${requestDetails.limit} TL tutarında kart isteği var.`
        );
    }

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