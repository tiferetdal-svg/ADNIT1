// Firebase Authentication System
import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js';
import { 
    getAuth, 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword,
    sendPasswordResetEmail 
} from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js';
import { 
    getDatabase, 
    ref, 
    set 
} from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js';

console.log('🔥 Firebase Auth module loaded');

const firebaseConfig = {
    apiKey: "AIzaSyBAeXCLtxDl-C0CdRG3e5cgaD7Uwc7WhaE",
    authDomain: "adanit-ecb78.firebaseapp.com",
    databaseURL: "https://adanit-ecb78-default-rtdb.firebaseio.com",
    projectId: "adanit-ecb78",
    storageBucket: "adanit-ecb78.firebasestorage.app",
    messagingSenderId: "741983407880",
    appId: "1:741983407880:web:0cca1cde1fef27b851e6bd"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getDatabase(app);

console.log('✅ Firebase initialized');

// --- פונקציות עזר ---

function showMessage(elementId, message, type = 'info') {
    const messageElement = document.getElementById(elementId);
    if (messageElement) {
        messageElement.textContent = message;
        messageElement.className = `auth-message ${type}`;
        messageElement.style.display = 'block';
        
        // הסתרת הודעות הצלחה/שגיאה אחרי 5 שניות
        if (type === 'error' || type === 'success') {
            setTimeout(() => {
                messageElement.style.display = 'none';
            }, 5000);
        }
    }
}

function getErrorMessage(errorCode) {
    switch (errorCode) {
        case 'auth/invalid-email': return 'כתובת אימייל לא תקינה';
        case 'auth/user-not-found': return 'לא נמצא משתמש עם האימייל הזה';
        case 'auth/wrong-password': return 'סיסמה שגויה';
        case 'auth/invalid-credential': return 'פרטים שגויים';
        case 'auth/email-already-in-use': return 'האימייל הזה כבר רשום במערכת';
        case 'auth/weak-password': return 'הסיסמה חייבת להכיל לפחות 6 תווים';
        case 'auth/too-many-requests': return 'יותר מדי נסיונות. נסה שנית מאוחר יותר';
        case 'auth/missing-email': return 'נא להקליד כתובת אימייל';
        default: return 'אירעה שגיאה, נסה שנית';
    }
}

// --- לוגיקה ראשית ---

// התחברות
window.handleLogin = async function() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    
    if (!email || !password) {
        showMessage('login-message', 'אנא מלא את כל השדות', 'error');
        return;
    }
    
    try {
        showMessage('login-message', 'מתחבר...', 'info');
        await signInWithEmailAndPassword(auth, email, password);
        showMessage('login-message', 'התחברות הצליחה!', 'success');
        // הפניה לפרופיל
        setTimeout(() => { window.location.href = '../profile.html'; }, 1500);
    } catch (error) {
        console.error('❌ Login error:', error.code);
        showMessage('login-message', getErrorMessage(error.code), 'error');
    }
};

// הרשמה
window.handleSignUp = async function() {
    const name = document.getElementById('signupName').value.trim();
    const email = document.getElementById('signupEmail').value.trim();
    const password = document.getElementById('signupPassword').value;
    
    if (!name || !email || !password) {
        showMessage('signup-message', 'אנא מלא את כל השדות', 'error');
        return;
    }
    
    if (password.length < 6) {
        showMessage('signup-message', 'הסיסמה חייבת להכיל לפחות 6 תווים', 'error');
        return;
    }
    
    try {
        showMessage('signup-message', 'יוצר חשבון...', 'info');
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        
        // שמירת פרטים נוספים (שם) ב-Realtime Database
        await set(ref(database, `users/${user.uid}`), {
            name: name,
            email: email,
            uid: user.uid,
            createdAt: new Date().toISOString()
        });
        
        showMessage('signup-message', 'הרשמה הצליחה!', 'success');
        setTimeout(() => { window.location.href = '../profile.html'; }, 1500);
        
    } catch (error) {
        console.error('❌ Sign up error:', error.code);
        showMessage('signup-message', getErrorMessage(error.code), 'error');
    }
};

// איפוס סיסמה (שכחתי סיסמה)
window.handleForgotPassword = async function() {
    const email = document.getElementById('loginEmail').value.trim();
    
    if (!email) {
        showMessage('login-message', 'כדי לאפס סיסמה, יש לכתוב את האימייל בשדה למעלה וללחוץ שוב על "שכחת סיסמה?"', 'info');
        // מדגיש את שדה האימייל כדי שהמשתמש יבין איפה לכתוב
        const emailInput = document.getElementById('loginEmail');
        emailInput.focus();
        emailInput.style.borderColor = "#ffc107"; // צהוב להדגשה
        setTimeout(() => emailInput.style.borderColor = "", 3000); // מחזיר לצבע רגיל
        return;
    }

    try {
        await sendPasswordResetEmail(auth, email);
        showMessage('login-message', 'נשלח מייל לאיפוס סיסמה! בדוק את תיבת הדואר שלך.', 'success');
    } catch (error) {
        console.error('Reset error:', error);
        showMessage('login-message', getErrorMessage(error.code), 'error');
    }
};