const BASE_URL = "https://ghost-backend-vyoi.onrender.com";

document.addEventListener('DOMContentLoaded', () => {
    
    // Elementleri Seç
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const createCardBtn = document.getElementById('create-card-btn'); // Buton 1
    const fillBtn = document.getElementById('fill-btn');             // Buton 2 (Gizli)
    
    const loginScreen = document.getElementById('login-screen');
    const dashboardScreen = document.getElementById('dashboard-screen');
    const statusMsg = document.getElementById('status-msg');
    const cardNumberDisplay = document.querySelector('.card-number');

    // Hafızadaki Kart Verisi
    let currentCardData = null;

    // --- 1. KART OLUŞTURMA BUTONU (Sadece Üretir) ---
    createCardBtn.addEventListener('click', async () => {
        chrome.storage.local.get(['ghost_token'], async (result) => {
            const token = result.ghost_token;
            if (!token) return showLogin();

            createCardBtn.innerText = "Üretiliyor...";
            createCardBtn.disabled = true;

            try {
                const response = await fetch(`${BASE_URL}/create-card`, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ limit: 100, merchant: "Manual Check" })
                });
                const data = await response.json();

                if (data.card) {
                    // Veriyi sakla
                    currentCardData = data;

                    // Ekrana yaz
                    cardNumberDisplay.innerText = formatCardNumber(data.card.card_number);
                    
                    // --- KRİTİK AN ---
                    // 1. Oluştur butonunu GİZLE
                    createCardBtn.classList.add('hidden');
                    // 2. Doldur butonunu GÖSTER
                    fillBtn.classList.remove('hidden');

                } else {
                    alert("Hata: " + data.error);
                    resetButtons();
                }
            } catch (error) {
                console.error(error);
                alert("Bağlantı hatası");
                resetButtons();
            }
        });
    });

    // --- 2. DOLDURMA BUTONU (Sadece Doldurur) ---
    fillBtn.addEventListener('click', () => {
        if (!currentCardData) return;

        fillBtn.innerText = "Dolduruluyor...";
        
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    action: "FILL_FORM",
                    data: currentCardData 
                }).then(() => {
                    setTimeout(() => { fillBtn.innerText = "Tekrar Doldur 🪄"; }, 1000);
                }).catch(err => {
                    alert("Lütfen sayfayı yenileyip tekrar dene.");
                    fillBtn.innerText = "Hata: Sayfayı Yenile";
                });
            }
        });
    });

    // --- LOGIN ---
    loginBtn.addEventListener('click', async () => {
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        statusMsg.innerText = "Giriş yapılıyor...";

        try {
            const response = await fetch(`${BASE_URL}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await response.json();

            if (data.access_token) {
                chrome.storage.local.set({ 'ghost_token': data.access_token }, showDashboard);
                statusMsg.innerText = "";
            } else {
                statusMsg.innerText = "Hata: " + (data.error || "Başarısız");
            }
        } catch (error) { statusMsg.innerText = "Hata!"; }
    });

    // --- LOGOUT ---
    logoutBtn.addEventListener('click', () => {
        chrome.storage.local.remove('ghost_token', () => {
            currentCardData = null;
            resetButtons();
            showLogin();
        });
    });

    // --- YARDIMCI FONKSİYONLAR ---
    function resetButtons() {
        createCardBtn.innerText = "Yeni Kart Oluştur";
        createCardBtn.disabled = false;
        createCardBtn.classList.remove('hidden');
        fillBtn.classList.add('hidden');
    }

    function showDashboard() {
        loginScreen.classList.add('hidden');
        dashboardScreen.classList.remove('hidden');
    }
    function showLogin() {
        loginScreen.classList.remove('hidden');
        dashboardScreen.classList.add('hidden');
    }
    function formatCardNumber(num) {
        return num.match(/.{1,4}/g).join(' ');
    }

    chrome.storage.local.get(['ghost_token'], (result) => {
        if (result.ghost_token) showDashboard(); else showLogin();
    });
});