// ==UserScript==
// @name         محرر وتنزيل الصور - WebP 1200x628 بدون طلب نطاق لكل صورة
// @namespace    https://tampermonkey.net/
// @version      2.2.0
// @description  تحميل الصور من أي نطاق متاح، اقتصاص 1200x728، وتحويلها إلى WebP
// @author       you
// @match        *://*/*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const OUT_W = 1200;
  const OUT_H = 728;
  const RATIO = OUT_W / OUT_H;
  const MAX_BYTES = 100 * 1024;
  const MIN_SOURCE_BYTES = 50 * 1024;

  let menu = null;
  let closeEditor = null;

  GM_addStyle(`
    #tm-img-menu{position:fixed;z-index:2147483647;background:#202124;color:#fff;padding:4px;border-radius:8px;box-shadow:0 5px 25px #0008;font:14px Tahoma,Arial;direction:rtl}
    #tm-img-menu button{display:block;width:100%;border:0;background:transparent;color:#fff;padding:9px 14px;cursor:pointer;border-radius:6px;font:inherit;text-align:right;white-space:nowrap}
    #tm-img-menu button:hover{background:#356be8}
    #tm-img-overlay{position:fixed;inset:0;z-index:2147483647;background:#000b;display:flex;align-items:center;justify-content:center;direction:rtl;font:13px Tahoma,Arial}
    #tm-img-modal{background:#fff;width:min(95vw,1000px);max-height:95vh;overflow:auto;border-radius:12px;box-shadow:0 10px 50px #000;display:flex;flex-direction:column}
    .tm-title{position:sticky;top:0;z-index:3;background:#111;color:#fff;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;font-weight:bold}
    .tm-title button{background:none;border:0;color:#fff;font-size:20px;cursor:pointer}
    .tm-content{display:flex;gap:18px;flex-wrap:wrap;padding:16px;align-items:flex-start}
    #tm-stage{position:relative;display:inline-block;line-height:0;background:#eee;overflow:hidden;max-width:min(65vw,720px);max-height:72vh;touch-action:none;user-select:none}
    #tm-preview{display:block;max-width:min(65vw,720px);max-height:72vh;width:auto;height:auto}
    #tm-selection{position:absolute;border:2px solid #2878f0;background:#2878f033;box-sizing:border-box;touch-action:none;cursor:move}
    #tm-selection:after{content:'';position:absolute;right:-10px;bottom:-10px;width:18px;height:18px;border:2px solid white;background:#2878f0;border-radius:50%;box-sizing:border-box;cursor:nwse-resize}
    .tm-side{min-width:250px;flex:1;display:flex;flex-direction:column;gap:10px}
    .tm-side label{display:flex;flex-direction:column;gap:4px}
    .tm-side input{padding:8px;border:1px solid #bbb;border-radius:6px;font-size:14px}
    .tm-info{background:#fff8dc;border:1px solid #ead47b;border-radius:7px;padding:9px;line-height:1.7}
    #tm-reset,#tm-save{border:0;border-radius:7px;padding:11px;cursor:pointer;font-weight:bold;font-size:14px}
    #tm-reset{background:#eee;color:#111} #tm-save{background:#2878f0;color:#fff} #tm-save:disabled{opacity:.6;cursor:progress}
    .tm-error{color:#a40000;background:#fff0f0;border:1px solid #e0a0a0;border-radius:7px;padding:9px;line-height:1.7}
  `);

  document.addEventListener('contextmenu', function (e) {
    const img = e.target.closest?.('img');
    const url = img && imageUrl(img);
    if (!url) return;
    // نستبدل قائمة Google/المتصفح بقائمة مخصصة حتى تظهر خيارات السكريبت في المقدمة.
    e.preventDefault();
    removeMenu();
    menu = document.createElement('div');
    menu.id = 'tm-img-menu';
    menu.innerHTML = `
      <button type="button" data-action="edit">تعديل وتنزيل الصورة</button>
      <button type="button" data-action="open-image">فتح الصورة في علامة تبويب جديدة</button>
      <button type="button" data-action="copy-image">نسخ رابط الصورة</button>
      <button type="button" data-action="download-original">حفظ الصورة الأصلية</button>`;
    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.max(3, Math.min(e.clientX, innerWidth - r.width - 3)) + 'px';
    menu.style.top = Math.max(3, Math.min(e.clientY, innerHeight - r.height - 3)) + 'px';
    menu.querySelectorAll('button').forEach(button => {
      button.onclick = async function () {
        const action = button.dataset.action;
        removeMenu();
        if (action === 'edit') showEditor(url);
        else if (action === 'open-image') window.open(url, '_blank', 'noopener');
        else if (action === 'copy-image') await copyText(url);
        else if (action === 'download-original') downloadOriginal(url);
      };
    });
  }, true);

  document.addEventListener('click', e => { if (!e.target.closest('#tm-img-menu')) removeMenu(); });
  document.addEventListener('scroll', removeMenu, true);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { removeMenu(); if (closeEditor) closeEditor(); }
  });

  function removeMenu() { if (menu) { menu.remove(); menu = null; } }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      alert('تم نسخ رابط الصورة');
    } catch (_) {
      const area = document.createElement('textarea');
      area.value = text; area.style.position = 'fixed'; area.style.opacity = '0';
      document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove();
      alert('تم نسخ رابط الصورة');
    }
  }

  function downloadOriginal(url) {
    const a = document.createElement('a');
    a.href = url; a.download = ''; a.target = '_blank'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
  }

  function imageUrl(img) {
    // نختار أكبر مصدر موجود بدل الاعتماد على thumbnail الذي تستخدمه Google.
    const candidates = [];
    const add = (url, score = 0) => {
      if (!url || url.startsWith('data:')) return;
      try { candidates.push({ url: new URL(url, location.href).href, score }); } catch (_) {}
    };
    const addSrcset = value => {
      if (!value) return;
      value.split(',').forEach(item => {
        const p = item.trim().split(/\s+/), width = parseInt((p[1] || '').replace('w', ''), 10);
        add(p[0], Number.isFinite(width) ? width : 1);
      });
    };

    addSrcset(img.getAttribute('srcset'));
    addSrcset(img.getAttribute('data-srcset'));
    add(img.getAttribute('data-original'), 9000);
    add(img.getAttribute('data-original-src'), 9000);
    add(img.getAttribute('data-full-src'), 9000);
    add(img.getAttribute('data-image-url'), 9000);
    add(img.currentSrc, 5000);
    add(img.src, 4000);

    // بعض مواقع نتائج الصور تضع الرابط الأصلي في imgurl أو mediaurl.
    let node = img;
    for (let i = 0; i < 4 && node; i++, node = node.parentElement) {
      const href = node.getAttribute?.('href');
      if (!href) continue;
      add(href, 100);
      try {
        const u = new URL(href, location.href);
        ['imgurl', 'mediaurl', 'imageurl', 'url'].forEach(key => {
          const value = u.searchParams.get(key);
          if (value && /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(value)) add(value, 12000);
        });
      } catch (_) {}
    }
    if (!candidates.length) return '';
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].url;
  }

  // مهم: @connect * موجود عمدًا حتى لا تظهر نافذة إضافة كل نطاق جديد.
  // هذا الطلب من Tampermonkey قد يظهر مرة واحدة بعد تثبيت السكريبت، ولا يمكن للسكريبت الضغط عليه آليًا.
  function getBlob(url) {
    if (url.startsWith('data:') || url.startsWith('blob:')) {
      return fetch(url).then(r => { if (!r.ok) throw new Error('فشل قراءة الصورة'); return r.blob(); });
    }
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET', url: url, responseType: 'blob', timeout: 45000,
        anonymous: true,
        onload: r => {
          if (r.status >= 200 && r.status < 300 && r.response) resolve(r.response);
          else reject(new Error('الموقع رفض تحميل الصورة (HTTP ' + r.status + ')'));
        },
        ontimeout: () => reject(new Error('انتهت مهلة تحميل الصورة')),
        onerror: () => reject(new Error('تعذر تحميل مصدر الصورة'))
      });
    });
  }

  async function showEditor(url) {
    let blob;
    try { blob = await getBlob(url); }
    catch (err) { showFailure(err.message); return; }
    if (blob.size < MIN_SOURCE_BYTES) {
      showFailure(`الصورة صغيرة جدًا: حجمها ${(blob.size / 1024).toFixed(1)}KB فقط.\nالحد الأدنى المسموح هو 50KB.`);
      return;
    }

    const objectUrl = URL.createObjectURL(blob);
    const overlay = document.createElement('div');
    overlay.id = 'tm-img-overlay';
    overlay.innerHTML = `<div id="tm-img-modal">
      <div class="tm-title"><span>تحرير الصورة — الناتج ${OUT_W}×${OUT_H}</span><button id="tm-x">×</button></div>
      <div class="tm-content">
        <div id="tm-stage"><img id="tm-preview" alt="الصورة"><div id="tm-selection"></div></div>
        <div class="tm-side">
          <label>اكتب اسمًا جديدًا للملف (إجباري)<input id="tm-name" maxlength="120" value="" placeholder="اكتب الاسم هنا"></label>
          <div class="tm-info">سيتم إخراج الملف دائمًا بمقاس <b>${OUT_W}×${OUT_H}</b> بكسل، بصيغة WebP، مع محاولة جعله أقل من 100KB. لا يمكن التنزيل قبل كتابة اسم جديد.</div>
          <button id="tm-reset">إعادة ضبط الاقتصاص</button>
          <div id="tm-status">حرّك الإطار الأزرق لاختيار الجزء المطلوب.</div>
          <button id="tm-save">تنزيل WebP</button>
        </div>
      </div></div>`;
    document.body.appendChild(overlay);

    const preview = overlay.querySelector('#tm-preview');
    const stage = overlay.querySelector('#tm-stage');
    const selection = overlay.querySelector('#tm-selection');
    const name = overlay.querySelector('#tm-name');
    const status = overlay.querySelector('#tm-status');
    const save = overlay.querySelector('#tm-save');
    preview.src = objectUrl;

    const cleanup = () => { URL.revokeObjectURL(objectUrl); overlay.remove(); if (closeEditor === cleanup) closeEditor = null; };
    closeEditor = cleanup;
    overlay.querySelector('#tm-x').onclick = cleanup;
    overlay.onclick = e => { if (e.target === overlay) cleanup(); };

    function reset() {
      const sw = stage.clientWidth, sh = stage.clientHeight;
      if (!sw || !sh) return;
      let w = Math.min(sw, sh * RATIO), h = w / RATIO;
      if (h > sh) { h = sh; w = h * RATIO; }
      selection.style.width = w + 'px'; selection.style.height = h + 'px';
      selection.style.left = (sw - w) / 2 + 'px'; selection.style.top = (sh - h) / 2 + 'px';
    }
    preview.onload = reset;
    overlay.querySelector('#tm-reset').onclick = reset;

    let action = '', startX, startY, startL, startT, startW;
    selection.onpointerdown = e => {
      selection.setPointerCapture(e.pointerId); action = e.target === selection ? 'move' : 'resize';
      startX = e.clientX; startY = e.clientY; startL = selection.offsetLeft; startT = selection.offsetTop; startW = selection.offsetWidth; e.preventDefault();
    };
    selection.onpointermove = e => {
      if (!action) return;
      const dx = e.clientX - startX, dy = e.clientY - startY, sw = stage.clientWidth, sh = stage.clientHeight;
      if (action === 'move') {
        selection.style.left = Math.max(0, Math.min(sw - selection.offsetWidth, startL + dx)) + 'px';
        selection.style.top = Math.max(0, Math.min(sh - selection.offsetHeight, startT + dy)) + 'px';
      } else {
        let w = Math.max(40, Math.min(sw - startL, startW + dx));
        let h = w / RATIO;
        if (h > sh - startT) { h = sh - startT; w = h * RATIO; }
        selection.style.width = w + 'px'; selection.style.height = h + 'px';
      }
      e.preventDefault();
    };
    selection.onpointerup = () => { action = ''; };
    selection.onpointercancel = () => { action = ''; };

    save.onclick = async () => {
      save.disabled = true; save.textContent = 'جاري المعالجة...';
      try {
        const scaleX = preview.naturalWidth / preview.clientWidth;
        const scaleY = preview.naturalHeight / preview.clientHeight;
        const c = document.createElement('canvas'); c.width = OUT_W; c.height = OUT_H;
        const ctx = c.getContext('2d', { alpha: false });
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, OUT_W, OUT_H);
        ctx.drawImage(preview, selection.offsetLeft * scaleX, selection.offsetTop * scaleY, selection.offsetWidth * scaleX, selection.offsetHeight * scaleY, 0, 0, OUT_W, OUT_H);
        const result = await encodeUnderLimit(c, MAX_BYTES);
        if (!result) throw new Error('المتصفح لم يستطع إنشاء WebP');
        const enteredName = name.value.trim();
        if (!enteredName) throw new Error('يجب كتابة اسم جديد للصورة قبل التنزيل');
        status.textContent = `تم تجهيز ${OUT_W}×${OUT_H} — الحجم ${(result.size / 1024).toFixed(1)}KB`;
        let n = enteredName.replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_').replace(/\.+$/, '').replace(/\.(webp|png|jpg|jpeg)$/i, '');
        if (!n) throw new Error('اسم الملف غير صالح؛ اكتب اسمًا مختلفًا');
        const downloadUrl = URL.createObjectURL(result), a = document.createElement('a'); a.href = downloadUrl; a.download = n + '.webp'; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 5000); save.textContent = 'تم التنزيل ✓'; setTimeout(cleanup, 900);
      } catch (err) { status.textContent = 'خطأ: ' + err.message; save.disabled = false; save.textContent = 'تنزيل WebP'; }
    };
  }

  function showFailure(message) {
    // لا نطلب من المستخدم تعديل السكريبت لكل صورة؛ نعرض سبب الفشل فقط.
    alert('تعذر تحميل هذه الصورة.\n\n' + message + '\n\nقد يكون الموقع مانعًا للتحميل المباشر أو أن الرابط صورة مصغرة مؤقتة.');
  }

  function toBlob(canvas, quality) {
    return new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
  }

  async function encodeUnderLimit(canvas, limit) {
    let work = canvas, best = null;
    for (let pass = 0; pass < 8; pass++) {
      // نبدأ بأعلى جودة، ثم نبحث عن أعلى جودة لا تتجاوز 100KB.
      const highest = await toBlob(work, 0.98);
      if (!highest) return null;
      if (!best || highest.size < best.size) best = highest;
      if (highest.size <= limit) return highest;

      let low = 0.03, high = 0.98;
      for (let i = 0; i < 12; i++) {
        const q = (low + high) / 2, blob = await toBlob(work, q);
        if (!blob) return null;
        if (blob.size <= limit) { best = blob; low = q; } else high = q;
      }
      if (best && best.size <= limit) return best;
      const next = document.createElement('canvas');
      next.width = Math.max(240, Math.round(work.width * .85)); next.height = Math.max(126, Math.round(work.height * .85));
      next.getContext('2d').drawImage(work, 0, 0, next.width, next.height); work = next;
    }
    return best;
  }
})();
