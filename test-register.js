// test-register.js
// Bu dosya backend'e istek atarak yeni bir kullanıcı oluşturur.

const testUser = {
    email: 'ajan100@ghost.com', // İstediğin maili yazabilirsin
    password: 'cokgizlisifre123', // En az 6 karakter olmalı
    full_name: 'James Bond',
    phone: '+905550070077'
};

console.log("--- Kayıt İsteği Gönderiliyor ---");

fetch('http://localhost:3000/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(testUser)
})
.then(res => res.json())
.then(data => {
    console.log("--- SUNUCUDAN GELEN CEVAP ---");
    console.log(data);
    
    if (data.user) {
        console.log("✅ BAŞARILI! Kullanıcı ID:", data.user.id);
    } else {
        console.log("❌ HATA:", data.error);
    }
})
.catch(err => console.error("Bağlantı Hatası:", err));