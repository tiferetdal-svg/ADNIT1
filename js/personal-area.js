// Smart Planter - Final Version (Separate Cooldowns)
import { database } from './firebase-config.js';
import { ref, set, get, onValue, update, remove } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';
// ייבוא המפתחות מקובץ הקונפיגורציה החיצוני
import { API_KEYS } from './config.js';

console.log('🌱 Smart Planter Script Loaded (Separate Cooldowns)');

// --- הגדרות מפתחות (נלקחים כעת מהקובץ החיצוני) ---
const PLANT_ID_KEY = API_KEYS.PLANT_ID; 
const OPENAI_API_KEY = API_KEYS.OPENAI;

// --- גבולות בטיחות ---
const SAFETY_LIMITS = {
    min_moisture: 10, max_moisture: 90, min_temp_limit: 5, max_temp_limit: 45
};

// משתנים גלובליים
let isRealPlanterActive = false;
let currentCustomMsgs = { water: "", soil: "", temp: "" }; 
let deviceStates = { pump_status: 0, fan_status: 0 }; 
let currentSensors = { soil: 0, temp: 0, humidity: 0, light: 0 };
let lastWateringTime = 0;
const WATERING_DURATION = 10000; 
const WATERING_COOLDOWN = 300000; 
let targetValues = { moisture: 30, minTemp: 18, maxTemp: 30 }; 
let modalBase64Image = "";

// --- ניהול זמן התראות נפרד לכל סוג ---
let alertTimers = {
    water: 0,
    soil: 0,
    temp: 0
};
const ALERT_COOLDOWN = 10000; // 10 שניות המתנה לכל סוג

// ==========================================
// פונקציית ההודעה הקופצת
// ==========================================
function showPopupAlert(title, message, alertType, styleType = 'danger') {
    const now = Date.now();
    
    // בדיקה: האם עבר מספיק זמן מאז ההודעה האחרונה *מסוג זה*?
    if (now - alertTimers[alertType] < ALERT_COOLDOWN) return;
    
    // עדכון הזמן האחרון לסוג הזה בלבד
    alertTimers[alertType] = now;
    console.log(`🔔 קופצת התראה (${alertType}): ${message}`);

    const container = document.getElementById('toastPlacement');
    if (!container) return;

    // בחירת אייקון וצבע
    let icon = 'exclamation-triangle-fill';
    let colorClass = 'text-danger'; 
    
    if (styleType === 'warning') { 
        icon = 'droplet-half';
        colorClass = 'text-warning'; 
    } else if (styleType === 'temp') { 
        icon = 'thermometer-high';
        colorClass = 'text-danger'; 
    }

    const toastHtml = `
        <div class="toast show" role="alert" aria-live="assertive" aria-atomic="true">
            <div class="toast-header">
                <i class="bi bi-${icon} ${colorClass} me-2"></i>
                <strong class="me-auto">${title}</strong>
                <small class="text-muted">עכשיו</small>
                <button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Close" onclick="this.parentElement.parentElement.remove()"></button>
            </div>
            <div class="toast-body fw-bold">
                ${message}
            </div>
        </div>
    `;

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = toastHtml;
    const newToast = tempDiv.firstElementChild;
    container.appendChild(newToast);

    setTimeout(() => {
        if (newToast) newToast.remove();
    }, 5000);
}

// ==========================================
// לוגיקה ראשית
// ==========================================

async function handleCreateNewPlanter() {
    const statusDiv = document.getElementById('modal-ai-status');
    const createBtn = document.getElementById('btn-create-planter');
    const isReal = document.getElementById('isRealDeviceCheck').checked;
    
    const msgWater = document.getElementById('msgWater').value || "התראה: מיכל המים ריק!";
    const msgSoil = document.getElementById('msgSoil').value || "התראה: האדמה יבשה, משקה...";
    const msgTemp = document.getElementById('msgTemp').value || "התראה: חם מדי! מפעיל מאוורר.";

    if (isReal && isRealPlanterActive) {
        if(confirm("קיימת כבר אדנית ראשית. להחליף אותה?")) {
             deletePlanter('real-planter-card'); 
        } else { return; }
    }

    if (statusDiv) statusDiv.innerText = "⏳ מזהה את הצמח...";
    if (createBtn) createBtn.disabled = true;

    try {
        const cleanBase64 = modalBase64Image.split(',')[1];

        // Plant.id
        const idRes = await fetch('https://api.plant.id/v3/identification', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Api-Key': PLANT_ID_KEY },
            body: JSON.stringify({ images: [cleanBase64], similar_images: true })
        });

        if (!idRes.ok) throw new Error(await idRes.text());
        const idData = await idRes.json();
        
        if (!idData.result?.classification?.suggestions?.length) throw new Error("לא זוהה צמח.");
        const plantName = idData.result.classification.suggestions[0].name;
        
        if (statusDiv) statusDiv.innerText = `✅ זוהה: ${plantName}\n🤖 ה-AI מגדיר נתונים...`;

        // OpenAI
        const rawAiData = await fetchOpenAIData(plantName);
        const safeData = applySafetyLimits(rawAiData);

        const newPlanter = {
            id: isReal ? 'real-planter-card' : 'sim-' + Date.now(),
            type: isReal ? 'real' : 'sim',
            name: plantName,
            data: safeData,
            image: modalBase64Image,
            messages: {
                water: msgWater,
                soil: msgSoil,
                temp: msgTemp
            }
        };

        saveToFirebase(newPlanter);

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

// --- API Helpers ---
async function fetchOpenAIData(plantName) {
    const prompt = `Identify "${plantName}". Return JSON: {"moisture_percent":int,"min_temp":int,"max_temp":int,"watering_freq":hebrew_string,"watering_desc":hebrew_string_no_quotes}`;
    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
            body: JSON.stringify({
                model: "gpt-3.5-turbo-1106",
                response_format: { "type": "json_object" },
                messages: [{role: "user", content: prompt}],
                temperature: 0.2
            })
        });
        const data = await response.json();
        if (data.error) throw new Error(data.error.message);
        return JSON.parse(data.choices[0].message.content);
    } catch (e) {
        return { moisture_percent: 40, min_temp: 18, max_temp: 30, watering_freq: "לפי הצורך", watering_desc: "השקיה רגילה" };
    }
}

function applySafetyLimits(data) {
    let m = data.moisture_percent || 40;
    return {
        moisture_percent: Math.max(10, Math.min(m, 90)),
        min_temp: Math.max(5, data.min_temp || 15),
        max_temp: Math.min(45, data.max_temp || 30),
        watering_desc: data.watering_desc || "השקיה מותאמת",
        watering_freq: data.watering_freq || "משתנה"
    };
}

// --- Firebase Sync ---
function saveToFirebase(planter) {
    set(ref(database, 'saved_planters/' + planter.id), planter)
    .catch((e) => alert("שגיאה בשמירה לענן: " + e.message));
}

function listenToPlantersFromCloud() {
    const grid = document.getElementById('planters-grid');
    
    onValue(ref(database, 'saved_planters'), (snapshot) => {
        const data = snapshot.val();
        if(grid) grid.innerHTML = '';
        isRealPlanterActive = false; 
        
        if (!data) { checkEmptyState(); return; }

        const list = Object.values(data);
        list.sort((a, b) => (a.type === 'real' ? -1 : 1));

        list.forEach(planter => {
            renderPlanter(planter);
            if (planter.type === 'real') {
                isRealPlanterActive = true;
                targetValues.moisture = planter.data.moisture_percent;
                targetValues.maxTemp = planter.data.max_temp;
                
                if (planter.messages) {
                    currentCustomMsgs = planter.messages;
                }
                setupSensorListeners(); 
            }
        });
        checkEmptyState();
    });
}

window.deletePlanter = function(id) {
    if (!confirm('למחוק את האדנית?')) return;
    remove(ref(database, 'saved_planters/' + id));
    if (id === 'real-planter-card') isRealPlanterActive = false;
}

// ==========================================
// חיישנים ובקרה (מעודכן עם טיימרים נפרדים)
// ==========================================

function setupSensorListeners() {
    if (window.sensorsListening) return;
    window.sensorsListening = true;

    onValue(ref(database, '/fromAltera'), (snapshot) => {
        const data = snapshot.val();
        if (!data) return;

        // 1. מיכל מים - משתמש בטיימר 'water'
        if (data.B !== undefined) {
            const level = parseInt(data.B);
            const el = document.getElementById('sensor-water');
            const bar = document.getElementById('water-bar');
            if(el) el.textContent = level + '%';
            if(bar) bar.style.width = level + '%';
            
            if (level < 2) {
                showPopupAlert('מיכל המים ריק', currentCustomMsgs.water || "נא למלא מים!", 'water', 'warning');
            }
        }
        
        if (data.A !== undefined) {
            const el = document.getElementById('sensor-dist');
            if(el) el.textContent = data.A + ' cm';
        }
        
        // 2. לחות אדמה - משתמש בטיימר 'soil'
        if (data.C !== undefined) {
            let raw = parseInt(data.C);
            let val = Math.max(0, Math.min(raw, 210)); 
            currentSensors.soil = Math.round(100 - ((val / 210) * 100));
            
            const el = document.getElementById('sensor-soil');
            if(el) el.textContent = currentSensors.soil + '%';
            
            if (currentSensors.soil < targetValues.moisture) {
                showPopupAlert('יובש באדמה', currentCustomMsgs.soil || "האדמה יבשה!", 'soil', 'warning');
            }
            checkAndActuateReal();
        }
    });

    onValue(ref(database, '/TEMP'), (s) => {
        if(s.val() !== null) {
            currentSensors.temp = parseFloat(s.val());
            const el = document.getElementById('sensor-temp');
            if(el) el.textContent = currentSensors.temp + '°';
            
            // 3. טמפרטורה - משתמש בטיימר 'temp'
            if (currentSensors.temp > targetValues.maxTemp) {
                showPopupAlert('טמפרטורה גבוהה', currentCustomMsgs.temp || "חם מדי לצמח!", 'temp', 'temp');
            }
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
    try {
        await set(ref(database, '/toAltera'), (device === 'pump') ? (turnOn ? 129 : 128) : (turnOn ? 65 : 64));
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
    if(imgEl && planter.image) {
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

    if (isReal) { grid.insertBefore(clone, grid.firstChild); } else { grid.appendChild(clone); }
}

function checkEmptyState() {
    const grid = document.getElementById('planters-grid');
    const emptyMsg = document.getElementById('empty-state');
    if (grid && emptyMsg) emptyMsg.style.display = (grid.children.length === 0) ? 'block' : 'none';
}

function resetModal() {
    const preview = document.getElementById('modal-preview-img');
    const text = document.getElementById('modal-upload-text');
    const status = document.getElementById('modal-ai-status');
    const btn = document.getElementById('btn-create-planter');
    const input = document.getElementById('modalFileInput');
    const check = document.getElementById('isRealDeviceCheck');
    const msgInputs = ['msgWater', 'msgSoil', 'msgTemp'];

    if(preview) preview.style.display = 'none';
    if(text) text.style.display = 'block';
    if(status) status.innerText = "";
    if(btn) btn.disabled = true;
    if(input) input.value = "";
    modalBase64Image = "";
    if(check) check.checked = false;
    
    msgInputs.forEach(id => {
        const el = document.getElementById(id);
        if(el) el.value = "";
    });
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
    listenToPlantersFromCloud();
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
});