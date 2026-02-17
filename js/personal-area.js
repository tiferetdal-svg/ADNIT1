// Smart Planter - Final Version (Smarter AI Prompt)
import { database } from './firebase-config.js';
import { ref, set, get, onValue, update } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';

console.log('🌱 Smart Planter Script Loaded (Smarter AI)');

// --- הגדרות מפתחות ---
const PLANT_ID_KEY = 'ueJ63jSupqoGCsi60MgDfNe7SM6le5F8KKHjZPEMnto07KGnNo'; 
const OPENAI_API_KEY = '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';

// --- גבולות בטיחות ---
const SAFETY_LIMITS = {
    min_moisture: 10, 
    max_moisture: 90,
    min_temp_limit: 5,
    max_temp_limit: 45
};

let isRealPlanterActive = false;
let deviceStates = { pump_status: 0, fan_status: 0 }; 
let currentSensors = { soil: 0, temp: 0, humidity: 0, light: 0 };
let lastWateringTime = 0;
const WATERING_DURATION = 10000; 
const WATERING_COOLDOWN = 300000; 
let targetValues = { moisture: 30, minTemp: 18, maxTemp: 30 }; 
let modalBase64Image = "";

async function handleCreateNewPlanter() {
    const statusDiv = document.getElementById('modal-ai-status');
    const createBtn = document.getElementById('btn-create-planter');
    const isReal = document.getElementById('isRealDeviceCheck').checked;
    
    if (isReal && isRealPlanterActive) {
        if(confirm("קיימת כבר אדנית ראשית. להחליף אותה?")) {
             deletePlanter('real-planter-card'); 
        } else { return; }
    }

    if (statusDiv) statusDiv.innerText = "⏳ מזהה את הצמח...";
    if (createBtn) createBtn.disabled = true;

    try {
        const cleanBase64 = modalBase64Image.split(',')[1];

        // 1. Plant.id
        const idRes = await fetch('https://api.plant.id/v3/identification', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Api-Key': PLANT_ID_KEY
            },
            body: JSON.stringify({
                images: [cleanBase64],
                similar_images: true
            })
        });

        if (!idRes.ok) {
            const errText = await idRes.text();
            throw new Error(`Plant.id Error: ${errText}`);
        }

        const idData = await idRes.json();
        
        if (!idData.result?.classification?.suggestions?.length) {
            throw new Error("לא זוהה צמח בתמונה.");
        }
        
        const plantName = idData.result.classification.suggestions[0].name;
        
        if (statusDiv) statusDiv.innerText = `✅ זוהה: ${plantName}\n🤖 ה-AI מחשב השקיה אופטימלית...`;

        // 2. OpenAI
        const rawAiData = await fetchOpenAIData(plantName);
        console.log("🤖 תשובת ה-AI הגולמית:", rawAiData); // בדיקה בקונסול

        const safeData = applySafetyLimits(rawAiData);

        const newPlanter = {
            id: isReal ? 'real-planter-card' : 'sim-' + Date.now(),
            type: isReal ? 'real' : 'sim',
            name: plantName,
            data: safeData,
            image: modalBase64Image
        };

        renderPlanter(newPlanter);
        saveToStorage(newPlanter);

        if (isReal) {
            targetValues.moisture = safeData.moisture_percent;
            targetValues.maxTemp = safeData.max_temp;
            setupFirebaseListeners();
        }

        const modalEl = document.getElementById('addPlanterModal');
        if (modalEl) {
            const modal = bootstrap.Modal.getInstance(modalEl);
            if (modal) modal.hide();
        }
        resetModal();

    } catch (e) {
        console.error(e);
        alert("שגיאה: " + e.message);
        if (statusDiv) statusDiv.innerText = "❌ תקלה: " + e.message;
        if (createBtn) createBtn.disabled = false;
    }
}

// --- המוח החדש והחכם יותר ---
async function fetchOpenAIData(plantName) {
    // הנחיה חכמה יותר שמבדילה בין סוגי צמחים
    const prompt = `
    Identify the plant "${plantName}" and provide specific agricultural data.
    CRITICAL RULES FOR VALUES:
    - If Cactus/Succulent: moisture_percent MUST be 15-25%.
    - If Leafy/Tropical (e.g., Basil, Fern): moisture_percent MUST be 50-70%.
    - If Flowering (e.g., Rose): moisture_percent MUST be 40-60%.
    
    Return ONLY a valid JSON object:
    {
        "moisture_percent": (integer, based on the rules above),
        "min_temp": (integer),
        "max_temp": (integer),
        "watering_freq": (short Hebrew string, e.g. "פעם בשבוע"),
        "watering_desc": (short Hebrew string, e.g. "לייבש בין השקיות")
    }`;

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-3.5-turbo-1106",
                response_format: { "type": "json_object" },
                messages: [{role: "user", content: prompt}],
                temperature: 0.2 // יצירתיות נמוכה לדיוק גבוה
            })
        });

        const data = await response.json();
        if (data.error) throw new Error("OpenAI: " + data.error.message);
        
        const content = data.choices[0].message.content;
        return JSON.parse(content);

    } catch (e) {
        console.error("AI Error:", e);
        // ברירת מחדל רק במקרה חירום
        return {
            moisture_percent: 40, min_temp: 18, max_temp: 30,
            watering_freq: "לפי הצורך", watering_desc: "השקיה רגילה"
        };
    }
}

function applySafetyLimits(data) {
    // אם הנתון לא קיים, נשתמש ב-40 כברירת מחדל
    let m = data.moisture_percent !== undefined ? data.moisture_percent : 40;
    let minT = data.min_temp || 15;
    let maxT = data.max_temp || 30;

    let safeMoist = Math.max(SAFETY_LIMITS.min_moisture, Math.min(m, SAFETY_LIMITS.max_moisture));
    let safeMinT = Math.max(SAFETY_LIMITS.min_temp_limit, minT);
    let safeMaxT = Math.min(SAFETY_LIMITS.max_temp_limit, maxT);

    return {
        moisture_percent: safeMoist, 
        min_temp: safeMinT, 
        max_temp: safeMaxT,
        watering_desc: data.watering_desc || "השקיה מותאמת",
        watering_freq: data.watering_freq || "משתנה"
    };
}

// ==========================================
// רינדור (ללא שינוי)
// ==========================================

function renderPlanter(planter) {
    const isReal = planter.type === 'real';
    const grid = document.getElementById('planters-grid');
    const template = document.getElementById('planter-template');
    
    if (!grid || !template) return;

    const clone = template.content.cloneNode(true);
    const card = clone.querySelector('.fade-in-card');
    if (card) card.id = planter.id;

    const badge = clone.querySelector('.badge-status');
    const subtitle = clone.querySelector('.planter-subtitle');
    const header = clone.querySelector('.planter-header');
    const cardEl = clone.querySelector('.planter-card');

    if (isReal) {
        isRealPlanterActive = true;
        if(cardEl) cardEl.classList.add('border-success', 'border-2');
        if(header) header.classList.add('bg-success', 'bg-opacity-10');
        if(badge) { badge.className = 'real-badge'; badge.innerHTML = '<i class="bi bi-wifi"></i> מחובר'; }
        if(subtitle) subtitle.innerText = "מחובר לחומרה";
    } else {
        if(badge) { badge.className = 'sim-badge'; badge.innerHTML = '<i class="bi bi-cloud-slash"></i> מדומה'; }
        if(subtitle) subtitle.innerText = "אדנית מדומה (AI)";
    }

    const nameEl = clone.querySelector('.planter-name');
    const imgEl = clone.querySelector('.planter-img');
    if(nameEl) nameEl.innerText = planter.name;
    if(imgEl) {
        imgEl.src = planter.image;
        if(isReal) imgEl.style.borderColor = "#198754";
    }

    const setTxt = (sel, txt) => { const el = clone.querySelector(sel); if(el) el.innerText = txt; };
    setTxt('.val-ai-target-moist', planter.data.moisture_percent + "%");
    setTxt('.val-ai-temp-range', `${planter.data.min_temp}-${planter.data.max_temp}°`);
    setTxt('.val-ai-freq', planter.data.watering_freq);
    setTxt('.val-ai-instruction', planter.data.watering_desc);

    if (isReal) {
        const setID = (sel, id) => { const el = clone.querySelector(sel); if(el) el.id = id; };
        setID('.val-soil', "sensor-soil");
        setID('.val-temp', "sensor-temp");
        setID('.val-humidity', "sensor-humidity");
        setID('.val-dist', "sensor-dist");
        setID('.val-water-text', "sensor-water");
        setID('.water-bar', "water-bar");
        
        const pBtn = clone.querySelector('.btn-pump-node');
        const fBtn = clone.querySelector('.btn-fan-node');
        if(pBtn) {
            pBtn.id = "btn-pump";
            pBtn.onclick = () => setRealDeviceState('pump', !deviceStates.pump_status);
            const txt = pBtn.querySelector('span'); if(txt) txt.id = "pumpText";
        }
        if(fBtn) {
            fBtn.id = "btn-fan";
            fBtn.onclick = () => setRealDeviceState('fan', !deviceStates.fan_status);
            const txt = fBtn.querySelector('span'); if(txt) txt.id = "fanText";
        }

        const camContainer = clone.querySelector('.camera-container');
        if(camContainer) camContainer.innerHTML = `<img id="camera-stream" src="" alt="offline" style="width:100%; height:100%; object-fit:contain; opacity:0.8;">`;
        const camBadge = clone.querySelector('.cam-badge-status');
        if(camBadge) { camBadge.id = "cam-status"; camBadge.innerText = "מנותק"; }

    } else {
        setTxt('.val-soil', (planter.data.moisture_percent - 5) + "%");
        setTxt('.val-temp', "24°");
        setTxt('.val-humidity', "50%");
        setTxt('.val-dist', "12 cm");
        setTxt('.val-water-text', "80%");
        
        const wBar = clone.querySelector('.water-bar');
        if(wBar) wBar.style.width = "80%";
        
        const pBtn = clone.querySelector('.btn-pump-node');
        const fBtn = clone.querySelector('.btn-fan-node');
        if(pBtn) pBtn.onclick = (e) => toggleSimButton(e.currentTarget, 'pump');
        if(fBtn) fBtn.onclick = (e) => toggleSimButton(e.currentTarget, 'fan');
        
        const camBadge = clone.querySelector('.cam-badge-status');
        if(camBadge) { camBadge.innerText = "אין מצלמה"; camBadge.classList.add('bg-secondary'); }
    }

    const delBtn = clone.querySelector('.delete-btn');
    if(delBtn) delBtn.onclick = () => deletePlanter(planter.id);

    if (isReal) {
        grid.insertBefore(clone, grid.firstChild);
    } else {
        grid.appendChild(clone);
    }
    
    checkEmptyState();
}

function setupFirebaseListeners() {
    if (!document.getElementById('sensor-soil')) return;

    onValue(ref(database, '/fromAltera'), (snapshot) => {
        const data = snapshot.val();
        if (!data) return;

        if (data.B !== undefined && data.B !== null) {
            const el = document.getElementById('sensor-water');
            const bar = document.getElementById('water-bar');
            if(el) el.textContent = parseInt(data.B) + '%';
            if(bar) bar.style.width = parseInt(data.B) + '%';
        }
        
        if (data.A !== undefined && data.A !== null) {
            const el = document.getElementById('sensor-dist');
            if(el) el.textContent = data.A + ' cm';
        }
        
        if (data.C !== undefined && data.C !== null) {
            let raw = parseInt(data.C);
            let val = Math.max(0, Math.min(raw, 210)); 
            currentSensors.soil = Math.round(100 - ((val / 210) * 100));
            const el = document.getElementById('sensor-soil');
            if(el) el.textContent = currentSensors.soil + '%';
            checkAndActuateReal();
        }
    });

    onValue(ref(database, '/TEMP'), (s) => {
        if(s.val() !== null) {
            currentSensors.temp = parseFloat(s.val());
            const el = document.getElementById('sensor-temp');
            if(el) el.textContent = currentSensors.temp + '°';
            checkAndActuateReal();
        }
    });
    
    onValue(ref(database, '/HUMIDITY'), (s) => {
        if(s.val() !== null) {
            const el = document.getElementById('sensor-humidity');
            if(el) el.textContent = s.val() + '%';
        }
    });

    onValue(ref(database, '/camIp'), (s) => {
        const vid = document.getElementById('camera-stream');
        if (vid && s.val()) {
            if(!vid.src.includes(s.val())) vid.src = `http://${s.val()}:81/stream`;
            const badge = document.getElementById('cam-status');
            if(badge) { badge.innerText = "מחובר"; badge.className = "badge bg-success position-absolute top-0 end-0 m-2"; }
        }
    });
}

function checkAndActuateReal() {
    const now = Date.now();
    if (currentSensors.soil < targetValues.moisture) {
        if (now - lastWateringTime > WATERING_COOLDOWN) {
            console.log("💧 משקה...");
            lastWateringTime = now;
            setRealDeviceState('pump', true);
            setTimeout(() => setRealDeviceState('pump', false), WATERING_DURATION);
        }
    }
    if (currentSensors.temp > targetValues.maxTemp && deviceStates.fan_status === 0) setRealDeviceState('fan', true);
    else if (currentSensors.temp < targetValues.maxTemp && deviceStates.fan_status === 1) setRealDeviceState('fan', false);
}

async function setRealDeviceState(device, turnOn) {
    const desired = turnOn ? 1 : 0;
    if (deviceStates[device + '_status'] === desired) return;

    const cmd = (device === 'pump') ? (turnOn ? 129 : 128) : (turnOn ? 65 : 64);
    
    try {
        await set(ref(database, '/toAltera'), cmd);
        await update(ref(database, 'smart_planter/controls'), { [device + '_status']: desired });
        deviceStates[device + '_status'] = desired;
        
        const btn = document.getElementById(`btn-${device}`);
        if (btn) {
            btn.className = `btn control-btn ${device}-btn-${turnOn ? 'on' : 'off'}`;
            const txt = btn.querySelector('span');
            const label = device === 'pump' ? 'משאבה' : 'מאוורר';
            if(txt) txt.innerText = `${label} ${turnOn ? 'פועל' : ''}`;
        }
    } catch(e) { console.error(e); }
}

function saveToStorage(planter) {
    let list = JSON.parse(localStorage.getItem('my_planters') || '[]');
    list = list.filter(p => p.id !== planter.id);
    list.push(planter);
    localStorage.setItem('my_planters', JSON.stringify(list));
}

function loadFromStorage() {
    const list = JSON.parse(localStorage.getItem('my_planters') || '[]');
    list.sort((a, b) => (a.type === 'real' ? -1 : 1));
    list.forEach(p => renderPlanter(p));
    
    if (list.some(p => p.type === 'real')) {
        const real = list.find(p => p.type === 'real');
        if(real) {
            targetValues.moisture = real.data.moisture_percent;
            targetValues.maxTemp = real.data.max_temp;
            setupFirebaseListeners();
        }
    }
}

window.deletePlanter = function(id) {
    if (!confirm('למחוק את האדנית?')) return;
    const el = document.getElementById(id);
    if (el) el.remove();
    let list = JSON.parse(localStorage.getItem('my_planters') || '[]');
    list = list.filter(p => p.id !== id);
    localStorage.setItem('my_planters', JSON.stringify(list));
    if (id === 'real-planter-card') isRealPlanterActive = false;
    checkEmptyState();
}

function checkEmptyState() {
    const grid = document.getElementById('planters-grid');
    const emptyMsg = document.getElementById('empty-state');
    if (grid && emptyMsg) {
        emptyMsg.style.display = (grid.children.length === 0) ? 'block' : 'none';
    }
}

function resetModal() {
    const preview = document.getElementById('modal-preview-img');
    const text = document.getElementById('modal-upload-text');
    const status = document.getElementById('modal-ai-status');
    const btn = document.getElementById('btn-create-planter');
    const input = document.getElementById('modalFileInput');
    const check = document.getElementById('isRealDeviceCheck');

    if(preview) preview.style.display = 'none';
    if(text) text.style.display = 'block';
    if(status) status.innerText = "";
    if(btn) btn.disabled = true;
    if(input) input.value = "";
    modalBase64Image = "";
    if(check) check.checked = false;
}

window.toggleSimButton = function(btn, type) {
    if(!btn) return;
    const isOn = btn.classList.contains(`${type}-btn-on`);
    const labels = { pump: 'משאבה', fan: 'מאוורר' };
    const icons = { pump: 'droplet', fan: 'fan' };
    if (!isOn) {
        btn.classList.replace(`${type}-btn-off`, `${type}-btn-on`);
        btn.innerHTML = `<i class="bi bi-${icons[type]}-fill"></i> פועל...`;
        if(type === 'pump') setTimeout(() => toggleSimButton(btn, type), 3000);
    } else {
        btn.classList.replace(`${type}-btn-on`, `${type}-btn-off`);
        btn.innerHTML = `<i class="bi bi-${icons[type]}"></i> ${labels[type]}`;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const modalUploadBox = document.getElementById('modal-upload-box');
    const modalFileInput = document.getElementById('modalFileInput');
    const modalCreateBtn = document.getElementById('btn-create-planter');

    if (modalUploadBox) {
        modalUploadBox.onclick = () => modalFileInput.click();
        modalFileInput.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const r = new FileReader();
            r.onload = () => {
                modalBase64Image = r.result;
                const prev = document.getElementById('modal-preview-img');
                const txt = document.getElementById('modal-upload-text');
                if(prev) { prev.src = modalBase64Image; prev.style.display = 'block'; }
                if(txt) txt.style.display = 'none';
                if(modalCreateBtn) modalCreateBtn.disabled = false;
            };
            r.readAsDataURL(file);
        };
        if(modalCreateBtn) modalCreateBtn.onclick = handleCreateNewPlanter;
    }

    try {
        loadFromStorage();
    } catch (e) {
        console.error("Storage Error", e);
    }
});