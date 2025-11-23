// test-login.js
// Bu dosya giriş yapıp 'access_token' almaya yarar.

// BURASI ÖNEMLİ: test-register.js'de kullandığın email ve şifrenin aynısını yazmalısın.
const loginData = {
    email: 'ajan100@ghost.com', 
    password: 'cokgizlisifre123'
};

console.log("--- Giriş İsteği Gönderiliyor ---");

fetch('http://localhost:3000/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(loginData)
})
.then(res => res.json())
.then(data => {
    console.log("--- SUNUCUDAN GELEN CEVAP ---");
    
    if (data.access_token) {
        console.log("✅ GİRİŞ BAŞARILI!");
        console.log("🔑 TOKEN (Bunu Kopyala):");
        console.log("---------------------------------------------------");
        console.log(data.access_token); 
        console.log("---------------------------------------------------");
        console.log("Bu token'ı bir sonraki aşamada kart yaratmak için kullanacaksın.");
    } else {
        console.log("❌ GİRİŞ HATASI:", data);
        console.log("İpucu: Email veya şifren register dosyasındakiyle aynı mı?");
    }
})
.catch(err => console.error("Bağlantı Hatası:", err));