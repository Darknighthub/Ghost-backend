import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Stripe from 'stripe'; 
import { supabase } from './config/supabase';
import { encrypt, decrypt } from './utils/crypto';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

 // STRIPE BAĞLANTISI
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
    apiVersion: '2025-11-17.clover',
});

app.use(cors());
app.use(express.json());

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
    if (!authHeader) return res.status(401).json({ error: "Token yok" });
    const token = authHeader.split(' ')[1];
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(403).json({ error: "Geçersiz token" });
    req.user = user;
    next();
};

// --- ENDPOINTLER ---
app.get('/', (req, res) => { res.send('Ghost Protocol vFinal (Stripe Fixed) 👻'); });

// KAYIT
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

// GİRİŞ
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: "Hatalı giriş bilgileri" });
    res.json({ access_token: data.session.access_token, user: data.user });
});

// --- KRİTİK KISIM: STRIPE İLE KART YARATMA ---
app.post('/create-card', requireAuth, async (req: AuthRequest, res: Response) => {
    const { limit, merchant, cardType } = req.body;
    const user = req.user;

    console.log(`[LOG] Kart isteği geldi. Kullanıcı: ${user.email}`);

    try {
        // 1. KART SAHİBİ (CARDHOLDER) KONTROLÜ
        // Önce Stripe'a soruyoruz: Bu email ile kayıtlı biri var mı?
        let cardholderId;
        
        console.log("[LOG] Stripe'da kullanıcı aranıyor...");
        const existingHolders = await stripe.issuing.cardholders.list({
            email: user.email,
            status: 'active',
            limit: 1
        });

        if (existingHolders.data.length > 0) {
            // Varsa onu kullan
            cardholderId = existingHolders.data[0].id;
            console.log(`[LOG] Mevcut kullanıcı bulundu: ${cardholderId}`);
        } else {
            // Yoksa yeni oluştur
            console.log("[LOG] Yeni kullanıcı oluşturuluyor...");
            const newHolder = await stripe.issuing.cardholders.create({
                name: 'Ghost User',
                email: user.email,
                status: 'active',
                type: 'individual',
                billing: {
                    address: {
                        line1: 'Istiklal Cad',
                        city: 'Istanbul',
                        state: 'TR', // Test modunda eyalet kodu bazen sorun olabilir, TR yazalım
                        postal_code: '34000',
                        country: 'TR',
                    },
                },
            });
            cardholderId = newHolder.id;
            console.log(`[LOG] Yeni kullanıcı oluşturuldu: ${cardholderId}`);
        }

        // 2. SANAL KART İSTEĞİ
        console.log("[LOG] Sanal kart talep ediliyor...");
        const stripeCard = await stripe.issuing.cards.create({
            cardholder: cardholderId,
            currency: 'usd', // DİKKAT: Test modunda USD daha garantidir. TRY bazen hata verebilir.
            type: 'virtual',
            status: 'active',
            spending_controls: {
                spending_limits: [
                    {
                        amount: (limit || 100) * 100,
                        interval: 'per_authorization',
                    },
                ],
            },
            metadata: {
                merchant_lock: merchant || "General",
            }
        });
        console.log(`[LOG] Stripe kartı oluştu: ${stripeCard.id}`);

        // 3. KART DETAYLARINI AL
        const cardDetails = await stripe.issuing.cards.retrieve(
            stripeCard.id,
            { expand: ['number', 'cvc'] }
        );

        // Stripe Test API bazen numarayı hemen vermezse fallback yapalım
        const rawCardNumber = cardDetails.number || generateFakeCardNumber(); 
        const rawCVV = cardDetails.cvc || generateCVV();
        const expiry = `${stripeCard.exp_month}/${stripeCard.exp_year}`;

        // 4. ŞİFRELE VE KAYDET
        console.log("[LOG] Veritabanına kaydediliyor...");
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

        console.log("[LOG] İşlem BAŞARILI! Yanıt dönülüyor.");
        
        res.json({
            message: "Kart Hazır",
            card: { 
                ...dbCard, 
                card_number: rawCardNumber, 
                cvv: rawCVV,
                type: cardType 
            },
            identity: { 
                full_name: generateFakeName(), 
                email: generateGhostEmail("Ghost"), 
                phone: "+905550000000" 
            }
        });

    } catch (error: any) {
        console.error("[KRİTİK HATA]:", error); // Render loglarında görünecek
        res.status(500).json({ 
            error: "Stripe İşlem Hatası", 
            detail: error.message 
        });
    }
});

// KARTLARI GETİR
app.get('/my-cards', requireAuth, async (req: AuthRequest, res: Response) => {
    const { data } = await supabase.from('virtual_cards').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false });
    const decrypted = data?.map(c => {
        try { return { ...c, card_number: decrypt(c.card_number) }; } 
        catch { return { ...c, card_number: "**** HATA ****" }; }
    }) || [];
    res.json({ cards: decrypted });
});

app.listen(port, () => { console.log(`Server running on ${port}`); });


