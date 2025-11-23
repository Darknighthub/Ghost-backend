console.log("Ghost Protocol Ajanı v2.1 (Akıllı Arama) Devrede! 👻");

const KEYWORDS = {
    card: ['card', 'cc-number', 'cc_number', 'cardnumber', 'kart_no', 'pan', 'kart numarası'],
    cvv: ['cvv', 'cvc', 'security', 'guvenlik', 'kod'],
    expiry: ['expiry', 'exp', 'expiration', 'skf', 'son_kullanma', 'date', 'tarih', 'yil'],
    // GÜNCELLENEN KISIM: Daha fazla kelime ekledik
    name: [
        'name', 'fullname', 'adsoyad', 'cardholder', 'card_holder', 'holder', // Alt tireli versiyon eklendi
        'isim', 'owner', 'ad-soyad', 'ad soyad', 'sahibi', 'kart sahibi'     // Türkçe ve boşluklu versiyonlar
    ],
    email: ['mail', 'eposta', 'e-mail'],
    phone: ['phone', 'tel', 'mobile', 'cep', 'gsm']
};

function findInput(keywordArray) {
    const inputs = document.querySelectorAll('input');
    for (let input of inputs) {
        const name = (input.name || '').toLowerCase();
        const id = (input.id || '').toLowerCase();
        const placeholder = (input.placeholder || '').toLowerCase();
        const type = (input.type || '').toLowerCase();

        if (keywordArray.includes('mail') && type === 'email') return input;

        // Kelime ararken daha esnek davranıyoruz
        const isMatch = keywordArray.some(key => 
            name.includes(key) || id.includes(key) || placeholder.includes(key)
        );
        if (isMatch) return input;
    }
    return null;
}

function fillField(inputElement, value) {
    if (!inputElement) return;
    
    console.log("Dolduruluyor:", inputElement.name, "->", value); // Hata ayıklama için log

    inputElement.value = value;
    inputElement.style.backgroundColor = "#e8f0fe"; 
    inputElement.style.transition = "background-color 0.5s";
    
    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    inputElement.dispatchEvent(new Event('change', { bubbles: true }));
    inputElement.dispatchEvent(new Event('blur', { bubbles: true }));
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "FILL_FORM") {
        const { card, identity } = request.data;
        console.log("Hayalet Kimlik Paketi Geldi:", request.data);

        const inputs = {
            card: findInput(KEYWORDS.card),
            cvv: findInput(KEYWORDS.cvv),
            expiry: findInput(KEYWORDS.expiry),
            name: findInput(KEYWORDS.name),
            email: findInput(KEYWORDS.email),
            phone: findInput(KEYWORDS.phone)
        };

        if (inputs.name) console.log("✅ İsim kutusu bulundu!");
        else console.log("❌ İsim kutusu BULUNAMADI. Anahtar kelimeleri kontrol et.");

        fillField(inputs.card, card.card_number);
        fillField(inputs.cvv, card.cvv);
        fillField(inputs.expiry, card.expiry_date);
        
        if(identity) {
            fillField(inputs.name, identity.full_name);
            fillField(inputs.email, identity.email);
            fillField(inputs.phone, identity.phone);
        }

        sendResponse({ status: "ok" });
    }
});