/* 发音 + 配图脚本，所有章节页面共用。
   修复要点：手机版 Chrome 上 speechSynthesis.onvoiceschanged 往往不会触发，
   原来的代码把点击事件绑定写在了这个回调里，导致手机上根本没有绑定监听器。 */
(function () {
    'use strict';

    var PIXABAY_API_KEY = '49256357-c30f2f538120ce8d74ff8921d';
    var synth = window.speechSynthesis;
    var voices = [];
    var unlocked = false;

    /* ---------- 语音 ---------- */

    function loadVoices() {
        if (!synth) return;
        var list = synth.getVoices();
        if (list && list.length) voices = list;
    }

    // 两条腿走路：立刻取一次（安卓 Chrome 是同步返回的），
    // 同时监听 onvoiceschanged（桌面 Chrome 是异步加载的）。
    if (synth) {
        loadVoices();
        if (typeof synth.addEventListener === 'function') {
            synth.addEventListener('voiceschanged', loadVoices);
        } else {
            synth.onvoiceschanged = loadVoices;
        }
        // 少数安卓机型两者都不灵，兜底轮询几次。
        var tries = 0;
        var poll = setInterval(function () {
            loadVoices();
            if (voices.length || ++tries > 20) clearInterval(poll);
        }, 250);
    }

    // 挑一个和目标语言匹配的声音。安卓上只设 utterance.lang 经常被忽略，
    // 会用系统默认声音念，或者干脆不出声，所以必须显式指定 voice。
    function pickVoice(lang) {
        if (!voices.length) return null;
        var base = lang.split('-')[0].toLowerCase();
        var exact = null, sameLang = null;
        for (var i = 0; i < voices.length; i++) {
            var v = voices[i];
            var vl = (v.lang || '').replace('_', '-').toLowerCase();
            if (vl === lang.toLowerCase()) { exact = exact || v; }
            else if (vl.split('-')[0] === base) { sameLang = sameLang || v; }
        }
        return exact || sameLang;
    }

    // iOS / 部分安卓需要在第一次用户手势里"解锁"语音合成。
    function unlock() {
        if (unlocked || !synth) return;
        unlocked = true;
        try {
            var u = new SpeechSynthesisUtterance('');
            u.volume = 0;
            synth.speak(u);
        } catch (e) { /* 忽略 */ }
    }

    function speak(text, lang) {
        if (!synth || !text) return;

        var utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = lang;
        utterance.rate = 0.9;
        var voice = pickVoice(lang);
        if (voice) {
            utterance.voice = voice;
            utterance.lang = voice.lang;
        } else if (voices.length) {
            // 手机上没装对应语言包时是彻底静音的，给个提示而不是无声失败。
            toast('手机未安装 ' + lang + ' 语音包，无法朗读');
            return;
        }

        // 安卓 Chrome 的老 bug：cancel() 之后紧接着 speak()，新的语句会被吞掉。
        // 所以只在真的还在说话时才 cancel，并且让出一帧再 speak。
        if (synth.speaking || synth.pending) {
            synth.cancel();
            setTimeout(function () { synth.speak(utterance); }, 120);
        } else {
            synth.speak(utterance);
        }

        // 某些机型息屏/切后台回来后会卡在 paused 状态。
        if (synth.paused) synth.resume();
    }

    /* ---------- 提示条 ---------- */

    var toastTimer = null;
    function toast(msg) {
        var el = document.getElementById('speechToast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'speechToast';
            el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);' +
                'background:rgba(0,0,0,.8);color:#fff;padding:10px 16px;border-radius:20px;' +
                'font-size:14px;z-index:2000;max-width:80vw;text-align:center;';
            document.body.appendChild(el);
        }
        el.textContent = msg;
        el.style.display = 'block';
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { el.style.display = 'none'; }, 2500);
    }

    /* ---------- 配图 ---------- */

    var currentImageTimeout = null;

    function clearBackgroundImages() {
        if (currentImageTimeout) {
            clearTimeout(currentImageTimeout);
            currentImageTimeout = null;
        }
        document.querySelectorAll('.background-image').forEach(function (img) {
            img.style.opacity = '0';
            setTimeout(function () { img.remove(); }, 300);
        });
    }

    function addBackgroundImage(cell, searchTerm) {
        clearBackgroundImages();
        if (!searchTerm) return;

        var apiUrl = 'https://pixabay.com/api/?key=' + PIXABAY_API_KEY +
            '&q=' + encodeURIComponent(searchTerm) + '&per_page=4&safesearch=true';

        fetch(apiUrl).then(function (response) {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.json();
        }).then(function (data) {
            if (!data.hits || !data.hits.length) return;
            var idx = Math.floor(Math.random() * Math.min(4, data.hits.length));
            var img = document.createElement('img');
            img.className = 'background-image';
            img.alt = searchTerm;
            img.onload = function () {
                setTimeout(function () { img.style.opacity = '0.9'; }, 50);
            };
            img.src = data.hits[idx].previewURL;

            var row = cell.closest('tr');
            if (!row) return;
            var firstCell = row.querySelector('td:first-child');
            if (!firstCell) return;
            firstCell.appendChild(img);

            currentImageTimeout = setTimeout(clearBackgroundImages, 3000);
        }).catch(function (error) {
            console.error('Error fetching image:', error);
        });
    }

    /* ---------- 点击 ---------- */

    function langOf(cell) {
        switch (cell.dataset.lang) {
            case 'fr': return 'fr-FR';
            case 'de': return 'de-DE';
            case 'zh':
                var sel = document.getElementById('chineseDialect');
                return sel ? sel.value : 'zh-CN';
            default: return 'en-US';
        }
    }

    function flash(cell) {
        cell.style.backgroundColor = '#c8e6c9';
        if (cell.resetTimeout) clearTimeout(cell.resetTimeout);
        cell.resetTimeout = setTimeout(function () {
            cell.style.backgroundColor = '';
            cell.resetTimeout = null;
        }, 500);
    }

    function handleActivate(event) {
        var cell = event.target.closest('.clickable');
        if (!cell) return;

        unlock();
        // 必须在用户手势的同步执行栈里调用 speak，
        // 否则安卓 Chrome 会当成"非用户触发"而拒绝播放。
        speak(cell.textContent.trim(), langOf(cell));
        flash(cell);
        addBackgroundImage(cell, cell.dataset.word);
    }

    function init() {
        // 事件委托绑在 document 上：不依赖语音列表是否加载完，
        // 后续动态加进表格的新行也自动生效。
        document.addEventListener('click', handleActivate);
        // 手机上先来一次 touchstart 解锁，真正发音仍走 click。
        document.addEventListener('touchstart', unlock, { once: true, passive: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
