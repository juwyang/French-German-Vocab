/* 发音 + 配图脚本，所有章节页面共用。 */
(function () {
    'use strict';

    var PIXABAY_API_KEY = '49256357-c30f2f538120ce8d74ff8921d';
    var synth = window.speechSynthesis;
    var voices = [];
    var voicesReady = false;
    var unlocked = false;

    /* ---------- 语音列表加载 ---------- */

    function loadVoices() {
        if (!synth) return false;
        var list = synth.getVoices();
        if (list && list.length) {
            voices = list;
            voicesReady = true;
        }
        return voicesReady;
    }

    // 桌面 Chrome 异步加载语音，安卓 Chrome 多数同步返回，少数机型两者都不灵。
    // 三重保险，谁先到算谁的。
    if (synth) {
        loadVoices();
        if (typeof synth.addEventListener === 'function') {
            synth.addEventListener('voiceschanged', loadVoices);
        } else {
            synth.onvoiceschanged = loadVoices;
        }
        var tries = 0;
        var poll = setInterval(function () {
            if (loadVoices() || ++tries > 40) clearInterval(poll);
        }, 200);
    }

    /* ---------- 选音 ---------- */

    // 安卓返回的 lang 可能是 fr_FR 这种下划线形式，不是合法的 BCP-47，
    // 直接塞进 utterance.lang 会被 Chrome 忽略，从而退回默认嗓音。
    function normLang(s) {
        return (s || '').replace(/_/g, '-').toLowerCase();
    }

    function baseOf(s) {
        return normLang(s).split('-')[0];
    }

    // 按优先级挑：地区完全一致且本地 > 地区一致 > 同语种且本地 > 同语种。
    // 必须挑到同语种的嗓音才发音 —— 用中文引擎念 "Circulation"，
    // 引擎不认识这个词，就会一个字母一个字母拼出来。
    function pickVoice(lang) {
        if (!voices.length) return null;
        var want = normLang(lang), base = baseOf(lang);
        var exactLocal = null, exact = null, langLocal = null, langAny = null;

        for (var i = 0; i < voices.length; i++) {
            var v = voices[i], vl = normLang(v.lang);
            if (baseOf(vl) !== base) continue;
            if (vl === want) {
                if (v.localService) { exactLocal = exactLocal || v; }
                else { exact = exact || v; }
            } else {
                if (v.localService) { langLocal = langLocal || v; }
                else { langAny = langAny || v; }
            }
        }
        return exactLocal || exact || langLocal || langAny;
    }

    function langName(lang) {
        var m = { fr: '法语', de: '德语', en: '英语', zh: '中文' };
        return m[baseOf(lang)] || lang;
    }

    /* ---------- 朗读 ---------- */

    // iOS / 部分安卓需要在第一次用户手势里“解锁”语音合成。
    function unlock() {
        if (unlocked || !synth) return;
        unlocked = true;
        try {
            var u = new SpeechSynthesisUtterance(' ');
            u.volume = 0;
            synth.speak(u);
        } catch (e) { /* 忽略 */ }
    }

    function doSpeak(text, lang) {
        var voice = pickVoice(lang);

        // 宁可不念，也不要用错误的嗓音把单词拼成字母。
        if (!voice) {
            toast('手机里没有' + langName(lang) + '语音包，无法朗读\n' +
                  '请到 设置 → 语言和输入法 → 文字转语音 里下载');
            return;
        }

        var utterance = new SpeechSynthesisUtterance(text);
        utterance.voice = voice;
        // 两个都设：部分安卓机型只认 lang，部分只认 voice。
        utterance.lang = normLang(voice.lang);
        utterance.rate = 0.9;

        // 安卓 Chrome 的老 bug：cancel() 之后紧接着 speak()，新语句会被吞掉。
        if (synth.speaking || synth.pending) {
            synth.cancel();
            setTimeout(function () { synth.speak(utterance); }, 120);
        } else {
            synth.speak(utterance);
        }

        if (synth.paused) synth.resume();
    }

    function speak(text, lang) {
        if (!synth || !text) return;

        // 语音列表还没加载完就发音，会用系统默认嗓音（多半是中文）念外语，
        // 结果就是逐字母拼读。这里等一下再念。
        if (!loadVoices()) {
            var waited = 0;
            var wait = setInterval(function () {
                waited += 100;
                if (loadVoices()) {
                    clearInterval(wait);
                    doSpeak(text, lang);
                } else if (waited >= 2000) {
                    clearInterval(wait);
                    toast('浏览器没有可用的语音引擎');
                }
            }, 100);
            return;
        }
        doSpeak(text, lang);
    }

    /* ---------- 提示条 ---------- */

    var toastTimer = null;
    function toast(msg) {
        var el = document.getElementById('speechToast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'speechToast';
            el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);' +
                'background:rgba(0,0,0,.85);color:#fff;padding:10px 16px;border-radius:14px;' +
                'font-size:14px;line-height:1.5;z-index:2000;max-width:84vw;text-align:center;' +
                'white-space:pre-line;';
            document.body.appendChild(el);
        }
        el.textContent = msg;
        el.style.display = 'block';
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { el.style.display = 'none'; }, 3500);
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
        speak(cell.textContent.trim(), langOf(cell));
        flash(cell);
        addBackgroundImage(cell, cell.dataset.word);
    }

    function init() {
        // 事件委托：不依赖语音列表是否加载完，新加的单词行也自动生效。
        document.addEventListener('click', handleActivate);
        document.addEventListener('touchstart', unlock, { once: true, passive: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
