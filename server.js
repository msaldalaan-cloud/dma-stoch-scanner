const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ==================== تخزين البيانات ====================
let strategies = [];
let scanResults = {};
let userEmail = '';

// ==================== دالة التحقق من وقت التداول ====================
function isTradingTime() {
    const now = new Date();
    const saudiTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Riyadh' }));
    
    const day = saudiTime.getDay();
    const hour = saudiTime.getHours();
    const minute = saudiTime.getMinutes();
    
    if (day === 5 || day === 6) {
        return { trading: false, reason: 'عطلة نهاية الأسبوع (الجمعة والسبت)' };
    }
    
    const currentMinutes = hour * 60 + minute;
    const startMinutes = 9 * 60 + 55;
    const endMinutes = 15 * 60 + 30;
    
    if (currentMinutes < startMinutes) {
        return { trading: false, reason: 'قبل افتتاح السوق (يفتح 9:55 صباحاً)' };
    }
    
    if (currentMinutes > endMinutes) {
        return { trading: false, reason: 'بعد إغلاق السوق (يغلق 3:30 مساءً)' };
    }
    
    let phase = '';
    if (currentMinutes >= 595 && currentMinutes < 600) phase = 'مزاد الافتتاح';
    else if (currentMinutes >= 600 && currentMinutes < 900) phase = 'التداول المستمر';
    else if (currentMinutes >= 900 && currentMinutes < 910) phase = 'مزاد الإغلاق';
    else if (currentMinutes >= 910 && currentMinutes <= 930) phase = 'التداول على سعر الإغلاق';
    
    return { trading: true, phase: phase };
}

// ==================== دوال EMA و SMA ====================
function calculateEMA(data, period) {
    if (!data || data.length === 0) return [];
    const k = 2 / (period + 1);
    const ema = [data[0]];
    for (let i = 1; i < data.length; i++) {
        ema.push(data[i] * k + ema[i - 1] * (1 - k));
    }
    return ema;
}

function calculateSMA(data, period) {
    if (!data || data.length < period) return [];
    return data.map((_, i, arr) => {
        if (i < period - 1) return arr[i];
        return arr.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
    });
}

// ==================== مؤشر DMA (10, 50, 10) ====================
function calculateDMA(data) {
    if (!data || data.length < 52) return null;
    const closes = data.map(d => d.c || d.close || 0);
    const ema10 = calculateEMA(closes, 10);
    const ema50 = calculateEMA(closes, 50);
    const dif = ema10.map((v, i) => v - (ema50[i] || 0));
    const difMa = calculateEMA(dif, 10);
    const lastIdx = dif.length - 1;
    const currentDif = dif[lastIdx];
    const currentDifMa = difMa[lastIdx];
    const previousDif = dif[lastIdx - 1] || 0;
    const previousDifMa = difMa[lastIdx - 1] || 0;
    return {
        dif: currentDif, difMa: currentDifMa,
        difAboveDifMa: currentDif > currentDifMa,
        close: closes[lastIdx], ma50: ema50[lastIdx],
        above50: closes[lastIdx] > ema50[lastIdx],
        difAboveZero: currentDif > 0,
        crossUp: (previousDif <= previousDifMa) && (currentDif > currentDifMa),
        crossDown: (previousDif >= previousDifMa) && (currentDif < currentDifMa)
    };
}

// ==================== مؤشر Stochastic (5, 3, 3) ====================
function calculateStoch(data) {
    if (!data || data.length < 8) return null;
    const highs = data.map(d => d.h || d.high || 0);
    const lows = data.map(d => d.l || d.low || 0);
    const closes = data.map(d => d.c || d.close || 0);
    const kPeriod = 5;
    const kValues = [];
    for (let i = kPeriod - 1; i < data.length; i++) {
        const highestHigh = Math.max(...highs.slice(i - kPeriod + 1, i + 1));
        const lowestLow = Math.min(...lows.slice(i - kPeriod + 1, i + 1));
        const range = highestHigh - lowestLow;
        kValues.push(range === 0 ? 50 : ((closes[i] - lowestLow) / range) * 100);
    }
    const dValues = calculateSMA(kValues, 3);
    const lastIdx = kValues.length - 1;
    const currentK = kValues[lastIdx];
    const currentD = dValues[lastIdx];
    const previousK = kValues[lastIdx - 1] || 0;
    const previousD = dValues[lastIdx - 1] || 0;
    return {
        k: currentK, d: currentD,
        kAboveD: currentK > currentD,
        kAbove50: currentK > 50,
        crossUp: (previousK <= previousD) && (currentK > currentD),
        crossDown: (previousK >= previousD) && (currentK < currentD)
    };
}

// ==================== دالة الفحص ====================
function checkStrategy(strategy, allData) {
    const results = {};
    const intervals = ['monthly', 'weekly', 'daily'];
    
    for (const interval of intervals) {
        const dmaSettings = strategy.dma[interval];
        if (!dmaSettings || !dmaSettings.enabled) {
            results[`dma_${interval}`] = null;
            continue;
        }
        const data = allData[interval];
        if (!data) { results[`dma_${interval}`] = false; continue; }
        const dma = calculateDMA(data);
        if (!dma) { results[`dma_${interval}`] = false; continue; }
        
        if (interval === 'daily' && dmaSettings.trigger) {
            results[`dma_${interval}`] = dma.crossUp;
        } else {
            let baseCondition = dma.difAboveDifMa;
            let extraConditions = true;
            if (dmaSettings.above50) extraConditions = extraConditions && dma.above50;
            if (dmaSettings.difZero) extraConditions = extraConditions && dma.difAboveZero;
            results[`dma_${interval}`] = baseCondition && extraConditions;
        }
    }
    
    for (const interval of intervals) {
        const stochSettings = strategy.stoch[interval];
        if (!stochSettings || !stochSettings.enabled) {
            results[`stoch_${interval}`] = null;
            continue;
        }
        const data = allData[interval];
        if (!data) { results[`stoch_${interval}`] = false; continue; }
        const stoch = calculateStoch(data);
        if (!stoch) { results[`stoch_${interval}`] = false; continue; }
        const crossLevel = stochSettings.crossLevel || 50;
        
        if (interval === 'daily' && stochSettings.trigger) {
            let signal = stoch.crossUp;
            if (crossLevel !== 50) signal = signal && stoch.currentK >= crossLevel;
            results[`stoch_${interval}`] = signal;
        } else {
            let baseCondition = stoch.kAboveD;
            let extraConditions = true;
            if (stochSettings.above50) extraConditions = extraConditions && stoch.kAbove50;
            if (crossLevel !== 50) extraConditions = extraConditions && stoch.currentK >= crossLevel;
            results[`stoch_${interval}`] = baseCondition && extraConditions;
        }
    }
    return results;
}

// ==================== محاكاة بيانات ====================
function generateMockData(interval) {
    const count = interval === 'monthly' ? 60 : interval === 'weekly' ? 52 : 100;
    const data = [];
    let price = 100;
    for (let i = 0; i < count; i++) {
        const change = (Math.random() - 0.48) * 3;
        price = Math.max(price + change, 50);
        data.push({ c: price, close: price, h: price + Math.random() * 2, high: price + Math.random() * 2, l: price - Math.random() * 2, low: price - Math.random() * 2, o: price - change, open: price - change });
    }
    return data;
}

// ==================== إرسال إيميل ====================
async function sendEmail(toEmail, results) {
    try {
        const emailjs = require('@emailjs/nodejs');
        const templateParams = {
            to_email: toEmail,
            subject: '🔔 إشارة تداول جديدة - DMA & Stochastic Scanner',
            symbol: results.symbol || 'غير محدد',
            dma_monthly: results.results.dma_monthly ? '🟢 شراء' : results.results.dma_monthly === false ? '🔴 بيع' : '⚪ غير مفعل',
            dma_weekly: results.results.dma_weekly ? '🟢 شراء' : results.results.dma_weekly === false ? '🔴 بيع' : '⚪ غير مفعل',
            dma_daily: results.results.dma_daily ? '🟢 شراء' : results.results.dma_daily === false ? '🔴 بيع' : '⚪ غير مفعل',
            stoch_monthly: results.results.stoch_monthly ? '🟢 شراء' : results.results.stoch_monthly === false ? '🔴 بيع' : '⚪ غير مفعل',
            stoch_weekly: results.results.stoch_weekly ? '🟢 شراء' : results.results.stoch_weekly === false ? '🔴 بيع' : '⚪ غير مفعل',
            stoch_daily: results.results.stoch_daily ? '🟢 شراء' : results.results.stoch_daily === false ? '🔴 بيع' : '⚪ غير مفعل',
            date: new Date().toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' }),
            time: new Date().toLocaleTimeString('ar-SA', { timeZone: 'Asia/Riyadh' })
        };
        await emailjs.send(process.env.EMAILJS_SERVICE_ID, process.env.EMAILJS_TEMPLATE_ID, templateParams, { publicKey: process.env.EMAILJS_PUBLIC_KEY, privateKey: process.env.EMAILJS_PRIVATE_KEY });
        console.log('✅ تم إرسال البريد إلى:', toEmail);
        return true;
    } catch (error) {
        console.error('❌ خطأ:', error.message);
        return false;
    }
}

// ==================== API Routes ====================
app.get('/api/market-status', (req, res) => {
    const status = isTradingTime();
    res.json({ ...status, time: new Date().toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' }) });
});

app.post('/api/strategies', (req, res) => {
    const strategy = req.body;
    strategy.id = Date.now();
    strategy.createdAt = new Date().toISOString();
    strategies.push(strategy);
    res.json({ success: true, id: strategy.id, total: strategies.length });
});

app.get('/api/strategies', (req, res) => res.json(strategies));

app.delete('/api/strategies/:id', (req, res) => {
    strategies = strategies.filter(s => s.id !== parseInt(req.params.id));
    res.json({ success: true });
});

app.post('/api/scan', async (req, res) => {
    const { symbol, email, strategy } = req.body;
    const strategiesToCheck = strategy ? [strategy] : strategies;
    if (strategiesToCheck.length === 0) return res.json({ success: false, message: 'لا توجد استراتيجيات' });
    
    const allData = { monthly: generateMockData('monthly'), weekly: generateMockData('weekly'), daily: generateMockData('daily') };
    const allResults = {};
    for (const strat of strategiesToCheck) allResults[strat.name || 'default'] = checkStrategy(strat, allData);
    
    const scanResult = { symbol: symbol || '2222', results: allResults[Object.keys(allResults)[0]] || {}, timestamp: new Date().toISOString() };
    scanResults = scanResult;
    
    let emailSent = false;
    if (email || userEmail) emailSent = await sendEmail(email || userEmail, scanResult);
    
    res.json({ success: true, results: scanResult.results, emailSent, timestamp: scanResult.timestamp });
});

app.post('/api/save-email', (req, res) => {
    userEmail = req.body.email;
    res.json({ success: true });
});

app.get('/api/results', (req, res) => res.json(scanResults));

app.get('/api/cron', async (req, res) => {
    const status = isTradingTime();
    if (!status.trading) return res.json({ success: false, message: status.reason, trading: false });
    if (strategies.length === 0) return res.json({ success: false, message: 'لا توجد استراتيجيات' });
    
    const allData = { monthly: generateMockData('monthly'), weekly: generateMockData('weekly'), daily: generateMockData('daily') };
    let signalsFound = 0;
    for (const strat of strategies) {
        const results = checkStrategy(strat, allData);
        if (results.dma_daily === true || results.stoch_daily === true) {
            signalsFound++;
            if (userEmail) await sendEmail(userEmail, { symbol: strat.symbol || '2222', results });
        }
    }
    res.json({ success: true, strategiesChecked: strategies.length, signalsFound, phase: status.phase });
});

// ==================== Cron محلي ====================
cron.schedule('*/5 6-15 * * 0-4', async () => {
    const status = isTradingTime();
    if (!status.trading || strategies.length === 0 || !userEmail) return;
    const allData = { monthly: generateMockData('monthly'), weekly: generateMockData('weekly'), daily: generateMockData('daily') };
    for (const strat of strategies) {
        const results = checkStrategy(strat, allData);
        if (results.dma_daily === true || results.stoch_daily === true) {
            await sendEmail(userEmail, { symbol: strat.symbol || '2222', results });
        }
    }
}, { timezone: 'Asia/Riyadh' });

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
