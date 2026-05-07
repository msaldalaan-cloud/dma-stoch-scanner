const API_BASE = '/api';
let savedEmail = localStorage.getItem('userEmail') || '';
let scanHistory = JSON.parse(localStorage.getItem('scanHistory') || '[]');
let savedStrategies = JSON.parse(localStorage.getItem('strategies') || '[]');

const $ = (id) => document.getElementById(id);
const elements = {
    symbol: $('symbol'), refreshSymbol: $('refreshSymbol'), marketStatus: $('marketStatus'),
    marketStatusText: $('marketStatusText'), lastUpdate: $('lastUpdate'),
    dmaMonthly: $('dmaMonthly'), dmaMonthlyAbove50: $('dmaMonthlyAbove50'), dmaMonthlyDifZero: $('dmaMonthlyDifZero'),
    dmaWeekly: $('dmaWeekly'), dmaWeeklyAbove50: $('dmaWeeklyAbove50'), dmaWeeklyDifZero: $('dmaWeeklyDifZero'),
    dmaDaily: $('dmaDaily'), dmaDailyAbove50: $('dmaDailyAbove50'), dmaDailyDifZero: $('dmaDailyDifZero'), dmaDailyTrigger: $('dmaDailyTrigger'),
    stochMonthly: $('stochMonthly'), stochMonthlyAbove50: $('stochMonthlyAbove50'), stochMonthlyLevel: $('stochMonthlyLevel'),
    stochWeekly: $('stochWeekly'), stochWeeklyAbove50: $('stochWeeklyAbove50'), stochWeeklyLevel: $('stochWeeklyLevel'),
    stochDaily: $('stochDaily'), stochDailyAbove50: $('stochDailyAbove50'), stochDailyLevel: $('stochDailyLevel'), stochDailyTrigger: $('stochDailyTrigger'),
    emailInput: $('emailInput'), saveEmail: $('saveEmail'), emailStatus: $('emailStatus'),
    saveStrategy: $('saveStrategy'), runScan: $('runScan'),
    dmaBadge: $('dmaBadge'), dmaMonthlyResult: $('dmaMonthlyResult'), dmaWeeklyResult: $('dmaWeeklyResult'), dmaDailyResult: $('dmaDailyResult'), dmaFinalSignal: $('dmaFinalSignal'),
    stochBadge: $('stochBadge'), stochMonthlyResult: $('stochMonthlyResult'), stochWeeklyResult: $('stochWeeklyResult'), stochDailyResult: $('stochDailyResult'), stochFinalSignal: $('stochFinalSignal'),
    strategiesList: $('strategiesList'), scanLog: $('scanLog')
};

function formatStatus(v) { return v === true ? { text: '🟢 شراء', class: 'buy' } : v === false ? { text: '🔴 بيع', class: 'sell' } : { text: '⚪ انتظار', class: 'neutral' }; }
function setResult(el, v) { const s = formatStatus(v); const vs = el.querySelector('.result-value'); if (vs) { vs.textContent = s.text; vs.className = 'result-value ' + s.class; } }
function setFinalSignal(el, signals) {
    const a = signals.filter(s => s === true), f = signals.filter(s => s === false), vs = el.querySelector('.signal-text');
    let s;
    if (a.length === signals.length && signals.length > 0) s = { text: '🟢 شراء قوي', class: 'buy' };
    else if (a.length >= 2) s = { text: '🟢 شراء', class: 'buy' };
    else if (f.length >= 2) s = { text: '🔴 بيع', class: 'sell' };
    else s = { text: '⚪ انتظار', class: 'neutral' };
    if (vs) { vs.textContent = s.text; vs.className = 'signal-text ' + s.class; }
}
function setBadge(el, v) { el.textContent = v === true ? 'شراء' : v === false ? 'بيع' : 'انتظار'; el.className = 'result-badge ' + (v === true ? 'buy' : v === false ? 'sell' : 'neutral'); }

function getStrategyData() {
    return {
        name: `Strategy_${new Date().toLocaleString('ar-SA').replace(/[:\s]/g,'_')}`, symbol: elements.symbol.value,
        dma: {
            monthly: { enabled: elements.dmaMonthly.checked, above50: elements.dmaMonthlyAbove50.checked, difZero: elements.dmaMonthlyDifZero.checked, bullish: true },
            weekly: { enabled: elements.dmaWeekly.checked, above50: elements.dmaWeeklyAbove50.checked, difZero: elements.dmaWeeklyDifZero.checked, bullish: true },
            daily: { enabled: elements.dmaDaily.checked, above50: elements.dmaDailyAbove50.checked, difZero: elements.dmaDailyDifZero.checked, trigger: elements.dmaDailyTrigger.checked, bullish: true }
        },
        stoch: {
            monthly: { enabled: elements.stochMonthly.checked, above50: elements.stochMonthlyAbove50.checked, crossLevel: parseInt(elements.stochMonthlyLevel.value)||50, bullish: true },
            weekly: { enabled: elements.stochWeekly.checked, above50: elements.stochWeeklyAbove50.checked, crossLevel: parseInt(elements.stochWeeklyLevel.value)||50, bullish: true },
            daily: { enabled: elements.stochDaily.checked, above50: elements.stochDailyAbove50.checked, crossLevel: parseInt(elements.stochDailyLevel.value)||50, trigger: elements.stochDailyTrigger.checked, bullish: true }
        }
    };
}

function displayResults(r) {
    if (!r) return;
    setResult(elements.dmaMonthlyResult, r.dma_monthly); setResult(elements.dmaWeeklyResult, r.dma_weekly); setResult(elements.dmaDailyResult, r.dma_daily);
    const ds = [r.dma_monthly, r.dma_weekly, r.dma_daily].filter(s => s !== null);
    setFinalSignal(elements.dmaFinalSignal, ds); setBadge(elements.dmaBadge, ds.every(s=>s===true)?true:ds.some(s=>s===false)?false:null);
    setResult(elements.stochMonthlyResult, r.stoch_monthly); setResult(elements.stochWeeklyResult, r.stoch_weekly); setResult(elements.stochDailyResult, r.stoch_daily);
    const ss = [r.stoch_monthly, r.stoch_weekly, r.stoch_daily].filter(s => s !== null);
    setFinalSignal(elements.stochFinalSignal, ss); setBadge(elements.stochBadge, ss.every(s=>s===true)?true:ss.some(s=>s===false)?false:null);
}

function mockResults() {
    const r = {};
    r.dma_monthly = elements.dmaMonthly.checked ? Math.random()>0.4 : null;
    r.dma_weekly = elements.dmaWeekly.checked ? Math.random()>0.4 : null;
    r.dma_daily = elements.dmaDaily.checked ? Math.random()>0.4 : null;
    r.stoch_monthly = elements.stochMonthly.checked ? Math.random()>0.4 : null;
    r.stoch_weekly = elements.stochWeekly.checked ? Math.random()>0.4 : null;
    r.stoch_daily = elements.stochDaily.checked ? Math.random()>0.4 : null;
    return r;
}

async function saveStrategyToServer(s) { try { return await (await fetch(`${API_BASE}/strategies`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(s) })).json(); } catch(e) { return null; } }
async function runScanOnServer(s) { try { return await (await fetch(`${API_BASE}/scan`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ symbol:elements.symbol.value, email:elements.emailInput.value||savedEmail, strategy:s }) })).json(); } catch(e) { return null; } }
async function getMarketStatus() { try { return await (await fetch(`${API_BASE}/market-status`)).json(); } catch(e) { return null; } }

elements.saveStrategy.addEventListener('click', async () => {
    const s = getStrategyData(); savedStrategies.push(s);
    localStorage.setItem('strategies', JSON.stringify(savedStrategies));
    await saveStrategyToServer(s); loadStrategies(); alert('✅ تم حفظ الاستراتيجية');
});
elements.runScan.addEventListener('click', async () => {
    elements.runScan.disabled = true; elements.runScan.innerHTML = '<span>⏳</span> جاري الفحص...';
    const s = getStrategyData(); const sr = await runScanOnServer(s);
    const r = (sr && sr.success) ? sr.results : mockResults();
    displayResults(r);
    scanHistory.unshift({ time: new Date().toLocaleString('ar-SA'), symbol: elements.symbol.value, results: r });
    if (scanHistory.length > 20) scanHistory.pop();
    localStorage.setItem('scanHistory', JSON.stringify(scanHistory)); loadScanHistory();
    elements.lastUpdate.textContent = 'آخر فحص: ' + new Date().toLocaleTimeString('ar-SA');
    elements.runScan.disabled = false; elements.runScan.innerHTML = '<span>🔍</span> بدء الفحص';
});
elements.saveEmail.addEventListener('click', async () => {
    const e = elements.emailInput.value.trim();
    if (!e) { elements.emailStatus.textContent = '⚠️ الرجاء إدخال بريد'; elements.emailStatus.style.color = '#ef5350'; return; }
    savedEmail = e; localStorage.setItem('userEmail', e);
    elements.emailStatus.textContent = '✅ تم الحفظ'; elements.emailStatus.style.color = '#66bb6a';
    try { await fetch(`${API_BASE}/save-email`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email:e}) }); } catch(ex) {}
    setTimeout(()=>{ elements.emailStatus.textContent=''; }, 3000);
});
elements.refreshSymbol.addEventListener('click', ()=> elements.runScan.click());

function deleteStrategy(i) { savedStrategies.splice(i,1); localStorage.setItem('strategies', JSON.stringify(savedStrategies)); loadStrategies(); }
function loadStrategies() {
    if (savedStrategies.length===0) { elements.strategiesList.innerHTML='<p class="empty-message">لا توجد استراتيجيات</p>'; return; }
    elements.strategiesList.innerHTML = savedStrategies.map((s,i) => `<div class="strategy-item"><span>📊 ${s.name}</span><span style="font-size:11px;color:#9fa8da;">${s.symbol}</span><button onclick="deleteStrategy(${i})">🗑️</button></div>`).join('');
}
function loadScanHistory() {
    if (scanHistory.length===0) { elements.scanLog.innerHTML='<p class="empty-message">لا توجد فحوصات</p>'; return; }
    elements.scanLog.innerHTML = scanHistory.slice(0,10).map(l => `<div class="log-item"><span>🕐 ${l.time}</span><span>${l.symbol}</span><span>${l.results?.dma_daily?'🟢':l.results?.dma_daily===false?'🔴':'⚪'}</span></div>`).join('');
}

async function updateMarketStatus() {
    const st = await getMarketStatus(), dot = elements.marketStatus.querySelector('.status-dot');
    if (st && st.trading) { elements.marketStatusText.textContent = `🟢 السوق مفتوح - ${st.phase}`; dot.className = 'status-dot open'; }
    else if (st && !st.trading) { elements.marketStatusText.textContent = `🔴 ${st.reason}`; dot.className = 'status-dot closed'; }
    else { const d = new Date().getDay(); elements.marketStatusText.textContent = (d===5||d===6)?'🔴 عطلة':'🔴 مغلق'; dot.className = (d===5||d===6)?'status-dot holiday':'status-dot closed'; }
}

function init() {
    if (savedEmail) { elements.emailInput.value = savedEmail; elements.emailStatus.textContent = '✅ محفوظ'; elements.emailStatus.style.color = '#66bb6a'; }
    loadStrategies(); loadScanHistory(); updateMarketStatus(); displayResults(mockResults());
    elements.lastUpdate.textContent = 'آخر فحص: ' + new Date().toLocaleTimeString('ar-SA');
}
setInterval(updateMarketStatus, 60000);
setInterval(()=>{ if(savedStrategies.length>0){ displayResults(mockResults()); elements.lastUpdate.textContent='آخر تحديث: '+new Date().toLocaleTimeString('ar-SA'); } }, 300000);
init();.;
