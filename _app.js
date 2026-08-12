
/* ============ number motion ============ */
window.animNum = (function(){
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return function(el, to, fmt){
    if(!el) return;
    const from = Number.isFinite(el._v) ? el._v : null;
    el._v = to;
    if(reduce || from === null || from === to || Math.abs(to - from) < 1){ el.textContent = fmt(to); return; }
    const t0 = performance.now(), dur = 550;
    cancelAnimationFrame(el._raf);
    (function step(t){
      const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(from + (to - from) * e);
      if(p < 1) el._raf = requestAnimationFrame(step);
    })(t0);
  };
})();

/* ============ shell: nav, sheet, dates ============ */
(function(){
  const sections = document.querySelectorAll('.section');
  const navBtns = document.querySelectorAll('.nav-btn');
  const tabBtns = document.querySelectorAll('.tab-btn');
  const sheet = document.getElementById('sheet');
  const sheetBtns = sheet ? sheet.querySelectorAll('[data-tab]') : [];
  const PRIMARY = ['overview','finances','journal','books'];

  function go(tab, scroll){
    const target = document.getElementById(tab);
    if(!target) return;
    sections.forEach(s => s.classList.remove('active'));
    target.classList.add('active');
    navBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    sheetBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    const more = document.getElementById('more-btn');
    if(more) more.classList.toggle('active', PRIMARY.indexOf(tab) === -1);
    try { localStorage.setItem('karen-tab', tab); } catch(e){}
    if(scroll !== false) window.scrollTo({top:0, behavior:'smooth'});
    document.dispatchEvent(new CustomEvent('tab:changed', {detail:tab}));
  }
  window.gotoTab = go;

  [...navBtns, ...tabBtns, ...sheetBtns].forEach(b => {
    if(!b.dataset.tab) return;
    b.addEventListener('click', () => { closeSheet(); go(b.dataset.tab); });
  });
  document.querySelectorAll('[data-goto]').forEach(b =>
    b.addEventListener('click', () => go(b.dataset.goto)));

  function openSheet(){ if(sheet) sheet.classList.add('open'); }
  function closeSheet(){ if(sheet) sheet.classList.remove('open'); }
  const moreBtn = document.getElementById('more-btn');
  if(moreBtn) moreBtn.addEventListener('click', openSheet);
  if(sheet) sheet.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', closeSheet));
  document.addEventListener('keydown', e => { if(e.key === 'Escape') closeSheet(); });

  try {
    const last = localStorage.getItem('karen-tab');
    if(last && document.getElementById(last)) go(last, false);
  } catch(e){}

  // dates + greeting
  const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MON = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const now = new Date();
  const stamp = DAYS[now.getDay()] + ', ' + MON[now.getMonth()] + ' ' + now.getDate();
  const eb = document.getElementById('ov-eyebrow');
  if(eb) eb.textContent = stamp.toLowerCase() + ' · ' + now.getFullYear();
  const fd = document.getElementById('foot-date');
  if(fd) fd.textContent = stamp;
  const tb = document.getElementById('topbar-date');
  if(tb) tb.innerHTML = DAYS[now.getDay()].slice(0,3) + '<br>' + MON[now.getMonth()].slice(0,3) + ' ' + now.getDate();
  const h = now.getHours();
  const greet = h < 4 ? 'still up, ' : h < 11 ? 'good morning, ' : h < 17 ? 'good afternoon, ' : h < 22 ? 'good evening, ' : 'late again, ';
  const title = document.querySelector('#overview h1.title');
  if(title) title.innerHTML = greet + '<em>karen</em>.';
})();

/* ============ the ledger: bills, due dates, payday math ============ */
(function(){
  const $ = id => document.getElementById(id);
  if(!$('exp-list')) return;

  const EDIT_KEY = 'karen-bill-edits', PAID_KEY = 'karen-due-paid', PAY_KEY = 'karen-pay';
  const LEGACY_DAYS = 'karen-due-days';
  const GOAL = 219000, WINDOW_DAYS = 14;
  const peso = n => '₱' + Math.round(n).toLocaleString('en-US');
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // amount:null on savings means "read the live renovation commitment"
  // spread:true means it leaves the account through the month, not on one date
  const ITEMS = [
    {id:'car',      name:'Car loan (BPI)',    amount:20122, day:7,  sure:true, note:'auto-debit'},
    {id:'savings',  name:'Savings (renovation)', amount:null, day:7, sure:true, note:'pay yourself first', save:true},
    {id:'electric', name:'Electric bill',     amount:6000,  day:20},
    {id:'mom',      name:"Mom's allowance",   amount:5000,  day:1},
    {id:'food',     name:'Food allowance',    amount:4500,  spread:true},
    {id:'milk',     name:"Dandan's milk",     amount:3200,  day:1},
    {id:'gas',      name:'Gas',               amount:3000,  spread:true},
    {id:'kazie',    name:"Kazie's allowance", amount:2500,  day:1},
    {id:'tv',       name:'TV payment',        amount:2592,  day:10, until:'2027-04-30', note:'ends apr 2027'},
    {id:'grocery',  name:'Grocery',           amount:2000,  spread:true},
    {id:'tuition',  name:"Dandan's tuition",  amount:2000,  day:5},
    {id:'converge', name:'Converge internet', amount:1647,  day:15},
    {id:'events',   name:'Events buffer',     amount:1500,  spread:true},
    {id:'extras',   name:'Dandan extras',     amount:500,   spread:true},
    {id:'gap',      name:'Unaccounted',       amount:4850,  spread:true, note:'the gap between your ₱61,411 and the list'}
  ];

  const readJSON = (k,f) => { try { return JSON.parse(localStorage.getItem(k)) || f; } catch(e){ return f; } };
  const writeJSON = (k,v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} };

  let edits = readJSON(EDIT_KEY, {});
  let paid  = readJSON(PAID_KEY, {});
  let pay   = Object.assign({mode:'biweekly', next:'', income:120000}, readJSON(PAY_KEY, {}));

  // migrate the older day-only store
  const legacy = readJSON(LEGACY_DAYS, null);
  if(legacy){
    Object.keys(legacy).forEach(id => {
      edits[id] = Object.assign({}, edits[id], {day:+legacy[id]});
    });
    writeJSON(EDIT_KEY, edits); localStorage.removeItem(LEGACY_DAYS);
  }

  const savingsCommit = () => {
    const s = readJSON('karen-savings', {});
    return Number.isFinite(+s.monthly) ? +s.monthly : 15000;
  };
  const savedSoFar = () => {
    const s = readJSON('karen-savings', {});
    return Number.isFinite(+s.saved) ? +s.saved : 18000;
  };
  const dayOf = it => {
    const d = edits[it.id] && +edits[it.id].day;
    return (Number.isFinite(d) && d >= 1 && d <= 31) ? d : it.day;
  };
  const amountOf = it => {
    if(it.save) return savingsCommit();
    const a = edits[it.id] && edits[it.id].amount;
    return (Number.isFinite(+a) && a !== '' && a !== null) ? +a : it.amount;
  };
  const isDead = it => it.until && new Date(it.until + 'T23:59:59') < new Date();
  const live = () => ITEMS.filter(it => !isDead(it));

  function midnight(d){ const x = new Date(d); x.setHours(0,0,0,0); return x; }
  const lastDay = (y,m) => new Date(y, m + 1, 0).getDate();
  function occurrence(day, y, m){ return new Date(y, m, Math.min(day, lastDay(y,m))); }
  function nextDue(day, from){
    const t = midnight(from);
    let d = occurrence(day, t.getFullYear(), t.getMonth());
    if(d < t) d = occurrence(day, t.getFullYear(), t.getMonth() + 1);
    return d;
  }
  const cycleKey = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
  const dayDiff = (a,b) => Math.round((midnight(a) - midnight(b)) / 86400000);
  const iso = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  const nice = d => MON[d.getMonth()] + ' ' + d.getDate();
  const ord = n => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');
  const phrase = n => n < 0 ? Math.abs(n) + ' days late' : n === 0 ? 'due today' : n === 1 ? 'due tomorrow' : 'due in ' + n + ' days';
  const tone = n => n < 3 ? 'hot' : n < 7 ? 'warm' : 'calm';

  const perYear = () => pay.mode === 'semimonthly' ? 24 : 26;
  const perPayday = () => (+pay.income || 0) * 12 / perYear();

  function defaultNextPayday(){
    const t = midnight(new Date());
    if(pay.mode === 'semimonthly'){
      const y = t.getFullYear(), m = t.getMonth();
      const mid = new Date(y, m, 15), end = new Date(y, m, lastDay(y,m));
      if(t <= mid) return mid;
      if(t <= end) return end;
      return new Date(y, m+1, 15);
    }
    const d = new Date(t);
    d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7)); // next friday
    return d;
  }
  function payStart(){
    const d = pay.next ? new Date(pay.next + 'T00:00:00') : defaultNextPayday();
    return isNaN(d) ? defaultNextPayday() : midnight(d);
  }
  function periodBounds(i){
    const s = payStart();
    if(pay.mode === 'semimonthly'){
      let cur = new Date(s);
      for(let k = 0; k < i; k++) cur = nextSemi(cur);
      return [cur, nextSemi(cur)];
    }
    const a = new Date(s); a.setDate(a.getDate() + i * 14);
    const b = new Date(a); b.setDate(b.getDate() + 14);
    return [a,b];
  }
  function nextSemi(d){
    const y = d.getFullYear(), m = d.getMonth();
    return d.getDate() < 15 ? new Date(y,m,15)
         : d.getDate() === 15 ? new Date(y,m,lastDay(y,m))
         : new Date(y,m+1,15);
  }

  /* ---------- fixed expense list ---------- */
  function renderExpenses(){
    const rows = ITEMS.map(it => {
      const dead = isDead(it), amt = amountOf(it);
      const when = it.spread ? 'spread' : ord(dayOf(it));
      return '<div class="expense-row' + (dead ? ' dead' : '') + (it.save ? ' sav-row' : '') + '">' +
        '<span class="nm">' + it.name + (it.note ? '<span class="day">' + it.note + '</span>' : '') + '</span>' +
        '<span class="leader"></span>' +
        '<span class="amt' + (it.id === 'car' ? ' bold' : '') + '">' + peso(amt) +
          '<span class="day">' + when + '</span></span>' +
        '</div>';
    }).join('');
    $('exp-list').innerHTML = rows;

    const total = live().reduce((s,it) => s + amountOf(it), 0);
    window.animNum($('exp-total'), total, peso);
    $('exp-count').textContent = live().length;
    $('exp-flag').innerHTML =
      'was ₱61,411 with the Shopee loan. that is paid off and gone. <b>₱4,850</b> is still unnamed — ' +
      '<button class="linkish" data-open-edit="1">name it or zero it</button>.';
    const b = $('exp-flag').querySelector('[data-open-edit]');
    if(b) b.addEventListener('click', () => { openEditor(); $('due-edit').scrollIntoView({behavior:'smooth', block:'center'}); });
    return total;
  }

  /* ---------- due soon ---------- */
  function dueList(){
    const now = new Date();
    return live().filter(it => !it.spread).map(it => {
      const date = nextDue(dayOf(it), now);
      if(it.until && date > new Date(it.until + 'T23:59:59')) return null;
      return {it, date, n: dayDiff(date, now), key: it.id + ':' + cycleKey(date), amount: amountOf(it)};
    }).filter(Boolean).sort((a,z) => a.n - z.n);
  }
  function overdue(){
    const now = midnight(new Date());
    const out = [];
    live().filter(it => !it.spread).forEach(it => {
      const d = occurrence(dayOf(it), now.getFullYear(), now.getMonth());
      if(d < now && !paid[it.id + ':' + cycleKey(d)]) out.push({it, date:d, n: dayDiff(d, now), amount: amountOf(it), key: it.id + ':' + cycleKey(d)});
    });
    return out.sort((a,z) => a.n - z.n);
  }

  function renderDue(){
    const items = dueList();
    const soon = items.filter(i => i.n <= WINDOW_DAYS);
    const later = items.filter(i => i.n > WINDOW_DAYS).slice(0,3);
    const late = overdue();
    const shown = late.concat(soon);
    const unpaid = shown.filter(i => !paid[i.key]);
    const total = unpaid.reduce((s,i) => s + i.amount, 0);

    $('due-total').innerHTML = shown.length
      ? '<b>' + peso(total) + '</b> across ' + unpaid.length + ' unpaid · next ' + WINDOW_DAYS + ' days'
      : 'nothing in the next ' + WINDOW_DAYS + ' days';

    $('due-list').innerHTML = shown.length ? shown.map(i => {
      const isPaid = !!paid[i.key], t = i.n < 0 ? 'hot' : tone(i.n);
      return '<div class="due-row' + (isPaid ? ' paid' : '') + '">' +
        '<span class="pip ' + (isPaid ? '' : t) + '"></span>' +
        '<span class="due-name">' + i.it.name + (i.it.sure ? '' : ' <span style="color:var(--ink-mute)">·&nbsp;date?</span>') +
          (i.it.note ? '<small>' + i.it.note + '</small>' : '') + '</span>' +
        '<span class="due-amt">' + peso(i.amount) + '</span>' +
        '<span class="due-when ' + (isPaid ? '' : t) + '">' + (isPaid ? 'paid' : phrase(i.n)) +
          '<br><span style="color:var(--ink-mute)">' + nice(i.date) + '</span></span>' +
        '<button class="due-check' + (isPaid ? ' on' : '') + '" data-key="' + i.key + '" aria-label="mark paid">✓</button>' +
        '</div>';
    }).join('') : '<div class="due-empty">clear for the next two weeks. rare, enjoy it.</div>';

    $('due-later').innerHTML = later.length
      ? 'after that — ' + later.map(i => i.it.name.toLowerCase() + ' ' + peso(i.amount) + ' on ' + nice(i.date)).join(' · ') : '';

    $('due-list').querySelectorAll('.due-check').forEach(btn => btn.addEventListener('click', () => {
      const k = btn.dataset.key;
      if(paid[k]) delete paid[k]; else paid[k] = true;
      writeJSON(PAID_KEY, paid); renderAll();
    }));

    // overview mini
    const mini = $('due-mini');
    if(mini){
      const seven = unpaid.filter(i => i.n <= 7);
      const top = (seven.length ? seven : unpaid).slice(0,3);
      mini.innerHTML = top.length
        ? top.map(i => '<div class="r ' + (i.n < 0 ? 'hot' : tone(i.n)) + '"><span>' + i.it.name + ' ' + peso(i.amount) +
            '</span><span>' + phrase(i.n) + '</span></div>').join('')
        : '<div class="r"><span style="color:var(--ink-dim)">nothing due for two weeks</span></div>';
      const t7 = seven.reduce((s,i) => s + i.amount, 0);
      $('due-mini-total').textContent = shown.length ? peso(total) + ' in ' + WINDOW_DAYS + ' days' : 'clear';
      if($('ov-due7')){
        window.animNum($('ov-due7'), t7, peso);
        $('ov-due7-note').textContent = seven.length ? seven.length + (seven.length === 1 ? ' bill' : ' bills') + ' inside a week' : 'nothing this week';
        $('ov-due7-note').className = 's ' + (seven.some(i => i.n < 3) ? 'hot' : seven.length ? 'warm' : 'calm');
      }
    }
    return {unpaid, late};
  }

  /* ---------- editor ---------- */
  function openEditor(){
    $('due-edit').classList.add('open');
    $('due-edit-toggle').textContent = 'done editing';
  }
  function buildEditor(){
    $('due-edit').innerHTML = ITEMS.map(it =>
      '<label class="de"><span>' + it.name + (isDead(it) ? ' <span style="color:var(--ink-mute)">(done)</span>' : '') + '</span>' +
      '<span style="display:flex;gap:6px">' +
        (it.save ? '<span style="font-family:var(--mono);font-size:0.72rem;color:var(--ink-mute);align-self:center">set above</span>'
                 : '<input type="number" min="0" step="50" data-amt="' + it.id + '" value="' + amountOf(it) + '" style="width:88px" aria-label="' + it.name + ' amount">') +
        (it.spread ? '<span style="font-family:var(--mono);font-size:0.72rem;color:var(--ink-mute);align-self:center;width:66px;text-align:center">spread</span>'
                   : '<input type="number" min="1" max="31" data-day="' + it.id + '" value="' + dayOf(it) + '" aria-label="' + it.name + ' due day">') +
      '</span></label>').join('');
    $('due-edit').querySelectorAll('input').forEach(inp => inp.addEventListener('input', () => {
      const id = inp.dataset.day || inp.dataset.amt;
      edits[id] = edits[id] || {};
      if(inp.dataset.day) edits[id].day = Math.min(31, Math.max(1, +inp.value || 1));
      else edits[id].amount = Math.max(0, +inp.value || 0);
      writeJSON(EDIT_KEY, edits); renderAll();
    }));
  }

  /* ---------- payday analyzer ---------- */
  function renderPay(){
    window.animNum($('pay-per'), perPayday(), peso);
    const today = midnight(new Date());
    const late = overdue();
    let html = '';

    for(let i = 0; i < 3; i++){
      const [a,b] = periodBounds(i);
      const lines = [];
      if(i === 0) late.forEach(o => lines.push({name:o.it.name, amount:o.amount, tagged:'was due ' + nice(o.date), overdue:true}));

      live().filter(it => !it.spread).forEach(it => {
        const day = dayOf(it);
        for(let mo = -1; mo <= 2; mo++){
          const d = occurrence(day, a.getFullYear(), a.getMonth() + mo);
          if(d >= a && d < b && !(it.until && d > new Date(it.until + 'T23:59:59'))){
            if(i === 0 && late.some(o => o.it.id === it.id && +o.date === +d)) continue;
            lines.push({name:it.name, amount:amountOf(it), tagged:nice(d), sort:+d});
          }
        }
      });
      lines.sort((x,z) => (x.overdue ? -1 : z.overdue ? 1 : (x.sort||0) - (z.sort||0)));

      const spread = live().filter(it => it.spread);
      const spreadTotal = spread.reduce((s,it) => s + amountOf(it), 0) * 12 / perYear();
      const billTotal = lines.reduce((s,l) => s + l.amount, 0);
      const out = billTotal + spreadTotal;
      const income = perPayday();
      const left = income - out;
      const isNow = i === 0;

      html += '<div class="period' + (isNow ? ' now' : '') + '">' +
        '<div class="period-top"><div class="when">' + (isNow ? '<em>' + nice(a) + '</em>' : nice(a)) +
          ' <span style="color:var(--ink-mute);font-size:0.85rem">→ ' + nice(new Date(b - 86400000)) + '</span></div>' +
          '<div class="badge">' + (isNow ? 'this paycheck · in ' + Math.max(0, dayDiff(a, today)) + ' days' : 'paycheck ' + (i+1)) + '</div></div>' +
        '<div class="period-body">' +
          lines.map(l => '<div class="pl' + (l.overdue ? ' overdue' : '') + '"><span class="nm">' + l.name +
            '<small>' + (l.overdue ? 'OVERDUE · ' + l.tagged : l.tagged) + '</small></span><span class="leader"></span>' +
            '<span class="amt">' + peso(l.amount) + '</span></div>').join('') +
          '<div class="pl"><span class="nm">Day-to-day<small>food, gas, grocery, buffers</small></span><span class="leader"></span>' +
            '<span class="amt">' + peso(spreadTotal) + '</span></div>' +
          '<div class="math">' +
            '<div><div class="k">Comes in</div><div class="v in">' + peso(income) + '</div></div>' +
            '<div><div class="k">Goes out</div><div class="v out">' + peso(out) + '</div></div>' +
            '<div><div class="k">Left over</div><div class="v ' + (left < 0 ? 'neg' : 'left') + '">' + peso(left) + '</div></div>' +
          '</div>' +
          (isNow ? '<div class="verdict' + (left < 0 ? ' bad' : '') + '">' + (left < 0
            ? 'this paycheck is <b>' + peso(-left) + ' short</b>. something has to move: lower the savings transfer, push a bill to the next period, or find the money.'
            : 'from the ' + nice(a) + ' paycheck you need <b>' + peso(out) + '</b> for bills and day-to-day, leaving <b>' + peso(left) + '</b> to actually spend.') +
            '</div>' : '') +
        '</div></div>';
    }
    $('pay-periods').innerHTML = html;
  }

  /* ---------- headline numbers ---------- */
  function renderTop(fixedTotal){
    const income = +pay.income || 0;
    const free = income - fixedTotal;
    const saved = savedSoFar(), pct = Math.min(100, saved / GOAL * 100);
    const set = (id, v) => { const el = $(id); if(el) el.textContent = v; };
    const money = (id, v) => window.animNum($(id), v, peso);
    const pctf = (id, v) => window.animNum($(id), v, x => x.toFixed(x >= 10 ? 0 : 1) + '%');

    money('fin-income', income);
    const el = $('fin-income-note');
    if(el) el.textContent = peso(perPayday()) + ' × ' + perYear() + ' a year';
    money('fin-fixed', fixedTotal);
    set('fin-fixed-note', 'incl. ' + peso(savingsCommit()) + ' savings');
    money('fin-free', free);
    pctf('fin-goal-pct', pct);
    set('fin-goal-note', peso(Math.max(0, GOAL - saved)) + ' to go');

    money('ov-free', free);
    set('ov-free-note', 'after ' + peso(fixedTotal) + ' committed');
    pctf('ov-sav', pct);
    set('ov-sav-note', peso(saved) + ' of ' + peso(GOAL));

    const start = payStart(), d = dayDiff(start, new Date());
    set('ov-payday', nice(start));
    set('ov-payday-note', (d <= 0 ? 'today' : d === 1 ? 'tomorrow' : 'in ' + d + ' days') + ' · ' + peso(perPayday()));
  }

  /* ---------- spend log ---------- */
  function renderSpend(){
    const log = readJSON('karen-spend', []);
    const key = new Date().getFullYear() + '-' + String(new Date().getMonth()+1).padStart(2,'0');
    const mine = log.filter(e => (e.d || '').slice(0,7) === key);
    const total = mine.reduce((s,e) => s + (+e.amt || 0), 0);
    if($('spend-count')) $('spend-count').textContent = mine.length;
    if($('spend-total')) $('spend-total').textContent = peso(total);
    if($('spend-list')) $('spend-list').innerHTML = log.length
      ? log.slice(-25).reverse().map(e => '<div class="expense-row"><span class="nm">' + (e.note || 'spend') +
          '<span class="day">' + e.d + '</span></span><span class="leader"></span><span class="amt">' + peso(e.amt) + '</span></div>').join('')
      : '<p class="note">nothing logged yet. use the quick hands on the Today page.</p>';
  }

  function renderAll(){
    const total = renderExpenses();
    renderDue();
    renderPay();
    renderTop(total);
    renderSpend();
  }

  // inputs
  if(!pay.next) pay.next = iso(defaultNextPayday());
  $('pay-next').value = pay.next;
  $('pay-mode').value = pay.mode;
  $('pay-income').value = pay.income;
  $('pay-next').addEventListener('change', e => { pay.next = e.target.value; writeJSON(PAY_KEY, pay); renderAll(); });
  $('pay-mode').addEventListener('change', e => {
    pay.mode = e.target.value; pay.next = iso(defaultNextPayday());
    $('pay-next').value = pay.next; writeJSON(PAY_KEY, pay); renderAll();
  });
  $('pay-income').addEventListener('input', e => { pay.income = Math.max(0, +e.target.value || 0); writeJSON(PAY_KEY, pay); renderAll(); });
  $('due-edit-toggle').addEventListener('click', () => {
    const open = $('due-edit').classList.toggle('open');
    $('due-edit-toggle').textContent = open ? 'done editing' : 'edit due dates';
  });

  document.addEventListener('money:changed', renderAll);
  window.__ledgerRefresh = renderAll;
  window.__payPerYear = perYear;
  buildEditor();
  renderAll();
  setInterval(renderAll, 60 * 60 * 1000);
})();

/* ============ quick hands ============ */
(function(){
  const $ = id => document.getElementById(id);
  if(!$('qa-panel')) return;
  let mode = null;
  const panel = $('qa-panel');
  const cfg = {
    spend: {title:'Log a spend', hint:'goes to the spend log in the ledger.', note:true},
    save:  {title:'Moved to savings', hint:'adds straight onto your renovation total.', note:false}
  };
  function open(m){
    mode = m; panel.style.display = 'block';
    $('qa-title').textContent = cfg[m].title;
    $('qa-hint').textContent = cfg[m].hint;
    $('qa-note').parentElement.style.display = cfg[m].note ? '' : 'none';
    $('qa-amt').value = ''; $('qa-note').value = '';
    $('qa-amt').focus();
  }
  function close(){ panel.style.display = 'none'; mode = null; }
  document.querySelectorAll('[data-qa]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.qa;
    if(k === 'journal'){ window.gotoTab('journal'); setTimeout(() => { const t = document.getElementById('journal-input'); if(t) t.focus(); }, 350); return; }
    if(k === 'bills'){ window.gotoTab('finances'); setTimeout(() => { const d = document.querySelector('.due-wrap'); if(d) d.scrollIntoView({behavior:'smooth', block:'center'}); }, 350); return; }
    open(k);
  }));
  $('qa-cancel').addEventListener('click', close);
  $('qa-save').addEventListener('click', () => {
    const amt = Math.max(0, +$('qa-amt').value || 0);
    if(!amt) { $('qa-amt').focus(); return; }
    const d = new Date(), stamp = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    if(mode === 'spend'){
      const log = (() => { try { return JSON.parse(localStorage.getItem('karen-spend')) || []; } catch(e){ return []; } })();
      log.push({d:stamp, amt, note:$('qa-note').value.trim() || 'spend'});
      localStorage.setItem('karen-spend', JSON.stringify(log));
    } else {
      const s = (() => { try { return JSON.parse(localStorage.getItem('karen-savings')) || {}; } catch(e){ return {}; } })();
      s.saved = Math.max(0, (Number.isFinite(+s.saved) ? +s.saved : 18000) + amt);
      if(!Number.isFinite(+s.monthly)) s.monthly = 15000;
      localStorage.setItem('karen-savings', JSON.stringify(s));
      if(window.__savingsRefresh) window.__savingsRefresh();
    }
    close();
    document.dispatchEvent(new CustomEvent('money:changed'));
  });
  $('qa-amt').addEventListener('keydown', e => { if(e.key === 'Enter') $('qa-save').click(); });
  $('qa-note').addEventListener('keydown', e => { if(e.key === 'Enter') $('qa-save').click(); });
})();

/* ============ pwa ============ */
if('serviceWorker' in navigator){
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
