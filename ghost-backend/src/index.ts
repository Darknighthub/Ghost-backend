import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Stripe from 'stripe'; // Stripe kütüphanesi
import { supabase } from './config/supabase';
import { encrypt, decrypt } from './utils/crypto';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// STRIPE AYARLARI
// Eğer key yoksa hata vermesin diye boş string atıyoruz ama çalışmaz.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
    apiVersion: '2025-11-17.clover', // En güncel API sürümü
});

app.use(cors());
app.use(express.json());

interface AuthRequest extends Request { user?: any; }

// --- MOCK DATA OLUŞTURUCULAR (Sadece İsim/Mail İçin) ---
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
app.get('/', (req, res) => { res.send('Ghost Protocol: Stripe Entegrasyonu Aktif 💳'); });

// GİRİŞ & KAYIT (Aynı Kalıyor)
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

// --- STRIPE İLE KART YARATMA ---
app.post('/create-card', requireAuth, async (req: AuthRequest, res: Response) => {
    const { limit, merchant, cardType } = req.body;
    const user = req.user;

    try {
        // 1. Önce bir "Cardholder" (Kart Sahibi) oluşturmamız lazım.
        // Gerçek sistemde her kullanıcı için 1 kere oluşturup ID'sini veritabanında saklarız.
        // Şimdilik her seferinde yeni oluşturuyoruz (Test amaçlı).
        const cardholder = await stripe.issuing.cardholders.create({
            name: 'Ghost User',
            email: user.email,
            status: 'active',
            type: 'individual',
            billing: {
                address: {
                    line1: 'Istiklal Cad.',
                    city: 'Istanbul',
                    state: 'TR',
                    postal_code: '34000',
                    country: 'TR', // Test modunda TR çalışır
                },
            },
        });

        // 2. Sanal Kartı Stripe'tan İste
        const stripeCard = await stripe.issuing.cards.create({
            cardholder: cardholder.id,
            currency: 'try', // Türk Lirası (veya usd)
            type: 'virtual',
            status: 'active',
            spending_controls: {
                spending_limits: [
                    {
                        amount: (limit || 100) * 100, // Kuruş cinsinden (100 TL = 10000 kuruş)
                        interval: 'per_authorization',
                    },
                ],
            },
            metadata: {
                merchant_lock: merchant || "General",
                system_user_id: user.id
            }
        });

        // 3. Hassas Bilgileri Al (Kart No ve CVV)
        // Stripe API güvenlik gereği kart numarasını oluşturma anında döner.
        // Test modunda bu detayları 'stripeCard' objesi içinde verir.
        
        // Test kartları için detayları çekme (Stripe Test verisi döner)
        const cardDetails = await stripe.issuing.cards.retrieve(
            stripeCard.id,
            { expand: ['number', 'cvc'] }
        );

        // Eğer test modundaysak ve numara gizliyse, test numarası atayalım
        // (Stripe bazen API'de numarayı maskeler, test için mock gerekebilir)
        const rawCardNumber = cardDetails.number || "4242424242424242"; // Fallback test kartı
        const rawCVV = cardDetails.cvc || "123"; 
        const expiry = `${stripeCard.exp_month}/${stripeCard.exp_year}`;

        // 4. Şifrele ve Bizim Veritabanına Kaydet
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

        // 5. Eklentiye Şifresiz Gönder
        res.json({
            message: "Stripe Kartı Hazır",
            card: { 
                ...dbCard, 
                card_number: rawCardNumber, 
                cvv: rawCVV,
                type: cardType 
            },
            identity: { 
                full_name: generateFakeName(), 
                email: generateGhostEmail(), 
                phone: "+905550000000" 
            }
        });

    } catch (error: any) {
        console.error("Stripe Hatası:", error);
        res.status(500).json({ error: error.message || "Kart oluşturma hatası" });
    }
});

// KARTLARI GETİR (Aynı Kalıyor)
app.get('/my-cards', requireAuth, async (req: AuthRequest, res: Response) => {
    const { data } = await supabase.from('virtual_cards').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false });
    const decrypted = data?.map(c => {
        try { return { ...c, card_number: decrypt(c.card_number) }; } 
        catch { return { ...c, card_number: "**** HATA ****" }; }
    }) || [];
    res.json({ cards: decrypted });
});

app.listen(port, () => { console.log(`Server running on ${port}`); });