// test-auth-card.js

// 1. Az önce kopyaladığın o uzun Token'ı buraya yapıştır!
const myToken = "eyJhbGciOiJIUzI1NiIsImtpZCI6IlRwSGxSY00rTEZjUUpMYmIiLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJodHRwczovL3JqbGZ5eHJlYXlyZnJ5dHV5YWx0LnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiI5YmRlZTA5Mi01YThhLTQ1MzItOGFjMi0wNTQ4MTgyOGRmZDYiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzYzODE2MjcyLCJpYXQiOjE3NjM4MTI2NzIsImVtYWlsIjoiYWphbjEwMEBnaG9zdC5jb20iLCJwaG9uZSI6IiIsImFwcF9tZXRhZGF0YSI6eyJwcm92aWRlciI6ImVtYWlsIiwicHJvdmlkZXJzIjpbImVtYWlsIl19LCJ1c2VyX21ldGFkYXRhIjp7ImVtYWlsIjoiYWphbjEwMEBnaG9zdC5jb20iLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwicGhvbmVfdmVyaWZpZWQiOmZhbHNlLCJzdWIiOiI5YmRlZTA5Mi01YThhLTQ1MzItOGFjMi0wNTQ4MTgyOGRmZDYifSwicm9sZSI6ImF1dGhlbnRpY2F0ZWQiLCJhYWwiOiJhYWwxIiwiYW1yIjpbeyJtZXRob2QiOiJwYXNzd29yZCIsInRpbWVzdGFtcCI6MTc2MzgxMjY3Mn1dLCJzZXNzaW9uX2lkIjoiMzE1NDQxNzYtYTRiOC00NDJiLTliOWMtZGIyNjBkMmEwOWRiIiwiaXNfYW5vbnltb3VzIjpmYWxzZX0.v923RgeNj7JxpbFHKZj1sxLTsebBeDot9KEGXW7Wy6w"; 

console.log("--- Korumalı Alana Giriliyor ---");

fetch('http://localhost:3000/create-card', {
    method: 'POST',
    headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${myToken}` // İşte pasaportumuzu burada gösteriyoruz!
    },
    body: JSON.stringify({
        limit: 500,        // Kart limiti
        merchant: 'Netflix' // Hangi site için?
        // DİKKAT: userId GÖNDERMİYORUZ! Sistem bizi token'dan tanıyacak.
    })
})
.then(res => res.json())
.then(data => {
    console.log("--- SUNUCUDAN GELEN CEVAP ---");
    
    if (data.card) {
        console.log("✅ MUHTEŞEM! KART OLUŞTURULDU!");
        console.log("💳 Kart No:", data.card.card_number);
        console.log("👤 Kullanıcı ID (Token'dan bulundu):", data.card.user_id);
    } else {
        console.log("❌ HATA:", data);
    }
})
.catch(err => console.error("Hata:", err));