// ==UserScript==
// @name          LibreGRAB
// @namespace     http://tampermonkey.net/
// @version       2026-10-31
// @description   Download all the booty!
// @author        PsychedelicPalimpsest
// @license       MIT
// @supportURL    https://github.com/PsychedelicPalimpsest/LibbyRip/issues
// @match         *://*.listen.libbyapp.com/*
// @match         *://*.listen.overdrive.com/*
// @match         *://*.read.libbyapp.com/?*
// @match         *://*.read.overdrive.com/?*
// @run-at        document-start
// @icon          https://www.google.com/s2/favicons?sz=64&domain=libbyapp.com
// @grant         none
// @downloadURL https://update.greasyfork.org/scripts/498782/LibreGRAB.user.js
// @updateURL https://update.greasyfork.org/scripts/498782/LibreGRAB.meta.js
// ==/UserScript==

// Chrome (Tampermonkey/MV3) runs userscripts in an isolated JS world, meaning
// overrides to JSON.parse and Function.prototype.bind never reach the page's
// own execution context. The fix is to inject the main script body into the
// real page world. client-zip is fetched here (where CSP does not apply to the
// extension context) and injected into the page once it is ready.

(function () {
    function mainCode() {
    const EXPORT_VERSION = '2026-10-31';

    // Since the ffmpeg.js file is 50mb, it slows the page down too much
    // to be in a "require" attribute, so we load it in async
    function addFFmpegJs(){
        if (typeof window.createFFmpeg === 'function') return Promise.resolve(window.createFFmpeg);
        return new Promise((resolve, reject) => {
            const tag = document.createElement('script');
            tag.src = 'https://github.com/PsychedelicPalimpsest/FFmpeg-js/releases/download/14/0.12.5.bundle.js';
            const timer = setTimeout(() => finish(new Error('FFmpeg 下载超时，请检查网络后重试。')), 120000);
            function finish(error) {
                clearTimeout(timer);
                tag.onload = tag.onerror = null;
                tag.remove();
                if (error) reject(error);
                else resolve(window.createFFmpeg);
            }
            tag.onerror = () => finish(new Error('无法加载 FFmpeg，浏览器可能阻止了脚本或网络请求。'));
            tag.onload = () => finish(typeof window.createFFmpeg === 'function' ? null : new Error('FFmpeg 脚本未提供 createFFmpeg。'));
            (document.head || document.documentElement).appendChild(tag);
        });
    }

    let downloadElem;
    let BIF;
    let clientZipPromise = null;
    async function getDownloadZip() {
        if (clientZipPromise) return clientZipPromise;
        // Keep the library private and lazy; another script's window.downloadZip
        // must not determine the names written into this export.
        clientZipPromise = new Promise((resolve, reject) => {
            const controller = new AbortController();
            const timer = setTimeout(() => {
                controller.abort();
                finish(new Error('ZIP 库加载超时，请检查网络后重试。'));
            }, 45000);
            let settled = false;
            function finish(error, writer) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                delete window.__libregrabZipReadyV2;
                if (error) reject(error);
                else resolve(writer);
            }
            window.__libregrabZipReadyV2 = writer => {
                if (typeof writer !== 'function') return finish(new Error('ZIP 库未正确初始化。'));
                finish(null, writer);
            };
            fetch('https://unpkg.com/client-zip@2.5.0/worker.js', { signal: controller.signal })
                .then(response => {
                    if (!response.ok) throw new Error('ZIP 库下载失败：HTTP ' + response.status);
                    return response.text();
                })
                .then(code => {
                    if (settled) return;
                    const tag = document.createElement('script');
                    tag.textContent = '(function(){\n' + code + '\nwindow.__libregrabZipReadyV2?.(downloadZip);\n})();';
                    (document.documentElement || document.head).appendChild(tag);
                    tag.remove();
                })
                .catch(error => finish(error));
        }).catch(error => {
            clientZipPromise = null;
            throw error;
        });
        return clientZipPromise;
    }
    const CSS = `
    .pNav{
        background-color: red;
        width: 100%;
        display: flex;
        justify-content: space-between;
    }
    .pLink{
        color: blue;
        text-decoration-line: underline;
        padding: .25em;
        font-size: 1em;
    }
    .foldMenu{
        position: absolute;
        width: 100%;
        height: 0%;
        z-index: 1000;

        background-color: grey;
        color: white;

        overflow-x: hidden;
        overflow-y: scroll;

        transition: height 0.3s
    }
    .active{
        height: 40%;
        border: double;
    }
    .pChapLabel{
        font-size: 2em;
    }`;
    /* =========================================
              BEGIN AUDIOBOOK SECTION!
       =========================================
    */


    // Libby, somewhere, gets the crypto stuff we need for mp3 urls, then removes it before adding it to the BIF.
    // here, we simply hook json parse to get it for us!

    const old_parse = JSON.parse;
    let odreadCmptParams = null;
    JSON.parse = function(...args){
        let ret = old_parse(...args);
        if (typeof(ret) == "object" && ret["b"] != undefined && ret["b"]["-odread-cmpt-params"] != undefined){
            odreadCmptParams = Array.from(ret["b"]["-odread-cmpt-params"]);
        }

        return ret;
    }

    // OverDrive stopped sending -odread-cmpt-params (upstream issue #82), so
    // chapter URLs built from it end in "?undefined" and fetch as 502s. The
    // player itself still requests working URLs, so record the media URLs it
    // requests and prefer those when building chapter URLs. Capture can never
    // break playback: every step is guarded.
    let capturedPlayerUrls = new Map();
    function partKeyFromUrl(u){
        try { return decodeURIComponent(new URL(u, location.href).pathname.split("/").pop()); }
        catch (e) { return null; }
    }
    function recordPlayerUrl(u){
        try {
            if (typeof u !== "string" || u.indexOf(".mp3") === -1) return;
            let key = partKeyFromUrl(u);
            if (key && !capturedPlayerUrls.has(key)) {
                capturedPlayerUrls.set(key, u);
                console.log("[LibreGRAB] Captured player URL for " + key);
            }
        } catch (e) {}
    }
    // No HTMLMediaElement src/setAttribute patch: patching media prototypes
    // is a suspected detection vector (OverDrive navigates to terms when it
    // detects tampering), and capture via mergePerformanceMediaUrls()
    // (performance entries) alone proved sufficient for every part.
    function mergePerformanceMediaUrls(){
        try {
            let entries = performance.getEntriesByType("resource") || [];
            for (let i = 0; i < entries.length; i++) {
                let en = entries[i];
                if ((en.initiatorType === "audio" || en.initiatorType === "media") && en.name) recordPlayerUrl(en.name);
            }
        } catch (e) {}
    }



    const audioBookNav = `
        <a class="pLink" id="chap"> <h1> View chapters </h1> </a>
        <a class="pLink" id="down"> <h1> Export as MP3 </h1> </a>
        <a class="pLink" id="exp"> <h1> Export audiobook </h1> </a>
    `;
    const chaptersMenu = `
        <h2>This book contains {CHAPTERS} chapters.</h2>
        <button class="shibui-button" style="background-color: white" id="dumpAll"> Download all </button><br>
    `;
    let chapterMenuElem;
    let libreShadowHost = null;
    let libreShadowRoot = null;

    function buildPirateUi(){
        // Create the nav
        let nav = document.createElement("div");
        nav.innerHTML = audioBookNav;
        nav.querySelector("#chap").onclick = viewChapters;
        nav.querySelector("#down").onclick = exportMP3;
        nav.querySelector("#exp").onclick = exportChapters;
        nav.classList.add("pNav");
        let pbar = document.querySelector(".nav-progress-bar");
        pbar.insertBefore(libreShadowHost, pbar.children[1]);
        libreShadowRoot.appendChild(nav);

        // Create the chapters menu
        chapterMenuElem = document.createElement("div");
        chapterMenuElem.classList.add("foldMenu");
        chapterMenuElem.setAttribute("tabindex", "-1"); // Don't mess with tab key
        const urls = getUrls();

        chapterMenuElem.innerHTML = chaptersMenu.replace("{CHAPTERS}", urls.length);
        libreShadowRoot.appendChild(chapterMenuElem);

        downloadElem = document.createElement("div");
        downloadElem.classList.add("foldMenu");
        downloadElem.setAttribute("tabindex", "-1"); // Don't mess with tab key
        libreShadowRoot.appendChild(downloadElem);
    }
    function getUrls(){
        let ret = [];
        for (let spine of BIF.objects.spool.components){
            let partFile = null;
            try { partFile = decodeURIComponent(spine.meta.path); } catch (e) { partFile = spine.meta.path; }
            let captured = partFile ? capturedPlayerUrls.get(partFile) : null;
            let data = {

                url: captured || location.origin + "/" + spine.meta.path + "?" + (odreadCmptParams || [])[spine.spinePosition],
                index : spine.meta["-odread-spine-position"],
                // File numbering follows list order, independently of player metadata.
                fileNumber: ret.length + 1,
                duration: spine.meta["audio-duration"],
                size: spine.meta["-odread-file-bytes"],
                type: spine.meta["media-type"]
            };
            ret.push(data);
        }
        return ret;
    }
    function getAudioPartFilename(part, totalParts) {
        // padStart keeps large numbers intact; all files use the same width.
        const width = Math.max(3, String(totalParts).length);
        const number = String(part.fileNumber).padStart(width, '0');
        const title = [getAuthorString(), BIF.map.title.main].filter(Boolean).join(' - ')
            .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
            .trim().replace(/[. ]+$/g, '') || 'Audiobook';
        // Leave room for the prefix and extension without splitting Unicode pairs.
        const titleLimit = 240 - number.length - ' - '.length - '.mp3'.length;
        let safeTitle = '';
        for (const character of title) {
            if (safeTitle.length + character.length > titleLimit) break;
            safeTitle += character;
        }
        return `${number} - ${safeTitle.replace(/[. ]+$/g, '')}.mp3`;
    }
    function getBookOutputFilename(extension) {
        let base = getAudioPartFilename({ fileNumber: 1 }, 1).slice(6, -4);
        if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base)) base = '_' + base;
        return base + '.' + extension;
    }
    function appendExportMessage(message) {
        const line = document.createElement('div');
        line.style.whiteSpace = 'pre-wrap';
        line.textContent = String(message);
        downloadElem.appendChild(line);
        downloadElem.scrollTo(0, downloadElem.scrollHeight);
    }
    let lastExportObjectUrl = null;
    function startExport(label) {
        if (lastExportObjectUrl) URL.revokeObjectURL(lastExportObjectUrl);
        lastExportObjectUrl = null;
        downloadElem.innerHTML = '';
        downloadElem.classList.add('active');
        appendExportMessage(`LibreGRAB ${EXPORT_VERSION} — ${label}`);
    }
    async function chooseExportHandle(filename, extension) {
        if (typeof window.showSaveFilePicker !== 'function') return null;
        try {
            // This call must happen in the initial click, before fetching audio.
            return await window.showSaveFilePicker({
                suggestedName: filename,
                types: [{ description: extension === 'zip' ? 'ZIP Archive' : 'MP3 Audio',
                    accept: { [extension === 'zip' ? 'application/zip' : 'audio/mpeg']: ['.' + extension] } }],
            });
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            if (error.name !== 'SecurityError') throw error;
            appendExportMessage('当前页面不允许打开保存对话框，生成后将显示手动保存链接。');
            return null;
        }
    }
    async function saveExportBlob(blob, filename, handle) {
        // Keep the result available for a real user click; do not discard it
        // after an automatic download that the browser may silently block.
        const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
        if (handle) {
            let writable;
            try {
                writable = await handle.createWritable();
                await writable.write(file);
                await writable.close();
                appendExportMessage('已保存：' + handle.name);
                return;
            } catch (error) {
                if (writable) { try { await writable.abort(); } catch (_) {} }
                appendExportMessage('写入所选文件失败：' + error.message + '。可用下方链接重试保存。');
            }
        }
        if (lastExportObjectUrl) URL.revokeObjectURL(lastExportObjectUrl);
        lastExportObjectUrl = URL.createObjectURL(file);
        const link = document.createElement('a');
        link.href = lastExportObjectUrl;
        link.download = filename;
        link.className = 'pLink';
        link.style.display = 'block';
        link.textContent = '点击保存：' + filename;
        downloadElem.appendChild(link);
        appendExportMessage('文件已生成，尚待保存。请点击上面的链接；链接会保留到下一次导出。');
    }
    async function verifyZipFileNames(blob, expectedNames) {
        // Read the actual central directory, independently of the writer API.
        const tailStart = Math.max(0, blob.size - 65557);
        const tail = new DataView(await blob.slice(tailStart).arrayBuffer());
        let end = -1;
        for (let at = tail.byteLength - 22; at >= 0; at--) {
            if (tail.getUint32(at, true) === 0x06054b50 && at + 22 + tail.getUint16(at + 20, true) === tail.byteLength) {
                end = at;
                break;
            }
        }
        if (end < 0) throw new Error('ZIP 不完整：未找到目录结尾。');
        let count = tail.getUint16(end + 10, true);
        let size = tail.getUint32(end + 12, true);
        let offset = tail.getUint32(end + 16, true);
        if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
            const locatorAt = tailStart + end - 20;
            const locator = new DataView(await blob.slice(locatorAt, locatorAt + 20).arrayBuffer());
            if (locator.byteLength !== 20 || locator.getUint32(0, true) !== 0x07064b50) throw new Error('ZIP64 目录无效。');
            const zip64Offset = Number(locator.getBigUint64(8, true));
            if (!Number.isSafeInteger(zip64Offset)) throw new Error('ZIP64 目录位置过大。');
            const zip64 = new DataView(await blob.slice(zip64Offset, zip64Offset + 56).arrayBuffer());
            if (zip64.byteLength !== 56 || zip64.getUint32(0, true) !== 0x06064b50) throw new Error('ZIP64 目录结尾无效。');
            count = Number(zip64.getBigUint64(32, true));
            size = Number(zip64.getBigUint64(40, true));
            offset = Number(zip64.getBigUint64(48, true));
        }
        if (count !== expectedNames.length || !Number.isSafeInteger(size) || !Number.isSafeInteger(offset) || offset + size > blob.size) {
            throw new Error('ZIP 文件数量或目录位置与预期不符。');
        }
        const bytes = new Uint8Array(await blob.slice(offset, offset + size).arrayBuffer());
        const directory = new DataView(bytes.buffer);
        const decoder = new TextDecoder('utf-8', { fatal: true });
        let at = 0;
        for (const expected of expectedNames) {
            if (at + 46 > bytes.length || directory.getUint32(at, true) !== 0x02014b50) throw new Error('ZIP 文件目录损坏。');
            const nameLength = directory.getUint16(at + 28, true);
            const next = at + 46 + nameLength + directory.getUint16(at + 30, true) + directory.getUint16(at + 32, true);
            if (next > bytes.length) throw new Error('ZIP 文件目录被截断。');
            const actual = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
            if (actual !== expected) throw new Error(`ZIP 文件名校验失败：预期 ${expected}，实际 ${actual}`);
            at = next;
        }
    }
    async function downloadAudioPart(part, totalParts) {
        const filename = getAudioPartFilename(part, totalParts);
        const response = await fetch(part.url);
        if (!response.ok) throw new Error(`${filename}: HTTP ${response.status}`);
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = filename;
        document.body.appendChild(link);
        try {
            link.click();
        } finally {
            link.remove();
            // Give the browser time to start saving before releasing the blob.
            setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
        }
    }
    let firstChapClick = true;
    function viewChapters(){
        // Populate chapters ONLY after first viewing
        if (firstChapClick){
            firstChapClick = false;
            for (let url of getUrls()){
                let span = document.createElement("span");
                span.classList.add("pChapLabel")
                span.textContent = "#" + url.fileNumber;

                let audio = document.createElement("audio");
                audio.setAttribute("controls", "");
                // Native media downloads do not use our numbered filenames.
                audio.setAttribute("controlsList", "nodownload");
                let source = document.createElement("source");
                source.setAttribute("src", url.url);
                source.setAttribute("type", url.type);
                audio.appendChild(source);

                const downloadButton = document.createElement("button");
                downloadButton.type = "button";
                downloadButton.className = "shibui-button";
                downloadButton.style.backgroundColor = "white";
                downloadButton.style.color = "black";
                downloadButton.textContent = "Download MP3 #" + url.fileNumber;
                downloadButton.onclick = async function () {
                    downloadButton.disabled = true;
                    try {
                        const parts = getUrls();
                        const part = parts.find(item => item.fileNumber === url.fileNumber);
                        if (!part) throw new Error("Audio part is no longer available. Refresh the page.");
                        await downloadAudioPart(part, parts.length);
                    } catch (error) {
                        console.error("LibreGRAB: audio download failed", error);
                        alert("Download failed: " + error.message);
                    } finally {
                        downloadButton.disabled = false;
                    }
                };

                chapterMenuElem.appendChild(span);
                chapterMenuElem.appendChild(document.createElement("br"));
                chapterMenuElem.appendChild(audio);
                chapterMenuElem.appendChild(downloadButton);
                chapterMenuElem.appendChild(document.createElement("br"));
            }
        }
        if (chapterMenuElem.classList.contains("active"))
            chapterMenuElem.classList.remove("active");
        else
            chapterMenuElem.classList.add("active");
        chapterMenuElem.querySelector("#dumpAll").onclick = async function(){

            const button = chapterMenuElem.querySelector("#dumpAll");
            button.disabled = true;
            try {
                const parts = getUrls();
                const results = await Promise.allSettled(parts.map(part => downloadAudioPart(part, parts.length)));
                const failures = results.filter(result => result.status === "rejected");
                if (failures.length) {
                    console.error("LibreGRAB: audio downloads failed", failures);
                    alert(`${failures.length} audio download(s) failed.\n${failures.map(result => result.reason.message).join('\n')}`);
                }
            } catch (error) {
                console.error("LibreGRAB: audio download failed", error);
                alert("Download failed: " + error.message);
            } finally {
                button.disabled = false;
            }
        };
    }
    function getAuthorString(){
        return (BIF.map.creator || []).filter(creator => creator.role === 'author').map(creator => creator.name).filter(Boolean).join(", ");
    }

    function getMetadata(){
        let spineToIndex = BIF.map.spine.map((x)=>x["-odread-original-path"]);
        const cover = BIF.root?.querySelector?.('image');
        let metadata = {
            title: BIF.map.title.main,
            description: BIF.map.description,
            coverUrl: cover?.getAttribute('href') || cover?.getAttribute('xlink:href') || null,
            creator: BIF.map.creator,
            spine: BIF.map.spine.map((x)=>{return {
                duration: x["audio-duration"],
                type: x["media-type"],
                bitrate: x["audio-bitrate"],
            }})
        };
        if (Array.isArray(BIF.map.nav?.toc)){
            metadata.chapters = BIF.map.nav.toc.map((rChap)=>{
                const [path, fragment] = String(rChap.path || '').split('#');
                return {
                    title: rChap.title,
                    spine: spineToIndex.indexOf(path),
                    offset: fragment == null ? 0 : Number.parseFloat(fragment)
                };
            });
        }
        return metadata;

    }

    async function createMetadata(){
        let metadata = getMetadata();
        const files = [{
                name: "metadata/metadata.json",
                input: JSON.stringify(metadata, null, 2)
        }];
        if (metadata.coverUrl) {
            try {
                const response = await fetch(metadata.coverUrl);
                if (!response.ok) throw new Error('HTTP ' + response.status);
                const blob = await response.blob();
                const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
                const extension = extensions[blob.type.split(';')[0]];
                if (extension) files.unshift({ name: 'metadata/cover.' + extension, input: blob });
            } catch (error) {
                appendExportMessage('封面未能下载，继续导出音频：' + error.message);
            }
        }
        return files;
    }
    function generateTOCFFmpeg(metadata) {
        if (!Array.isArray(metadata.chapters) || !metadata.chapters.length ||
            !Array.isArray(metadata.spine) || !metadata.spine.length) return null;

        const durations = metadata.spine.map(part => Number(part.duration));
        // An unknown part length makes every following chapter offset unreliable.
        if (durations.some(duration => !Number.isFinite(duration) || duration < 0)) return null;
        const offsets = [];
        let totalSeconds = 0;
        for (const duration of durations) {
            offsets.push(totalSeconds);
            totalSeconds += duration;
        }
        const totalMilliseconds = Math.round(totalSeconds * 1000);
        if (!Number.isSafeInteger(totalMilliseconds) || totalMilliseconds <= 0) return null;

        const entries = [];
        for (const chapter of metadata.chapters) {
            if (!chapter) continue;
            const spine = Number(chapter.spine);
            const offset = Number(chapter.offset);
            if (!Number.isInteger(spine) || spine < 0 || spine >= durations.length ||
                !Number.isFinite(offset) || offset < 0 || offset > durations[spine]) continue;
            const start = Math.round((offsets[spine] + offset) * 1000);
            if (!Number.isSafeInteger(start) || start < 0 || start >= totalMilliseconds) continue;
            const title = String(chapter.title || 'Chapter').replace(/[\r\n]+/g, ' ');
            entries.push({ title, start });
        }
        entries.sort((left, right) => left.start - right.start);

        const chapters = [];
        for (const entry of entries) {
            const previous = chapters[chapters.length - 1];
            // The same chapter may continue across several source MP3 parts.
            if (previous && (previous.title === entry.title || previous.start === entry.start)) continue;
            chapters.push(entry);
        }
        if (!chapters.length) return null;

        let toc = ';FFMETADATA1\n';
        for (let index = 0; index < chapters.length; index++) {
            const chapter = chapters[index];
            const end = index + 1 < chapters.length ? chapters[index + 1].start : totalMilliseconds;
            if (end <= chapter.start) continue;
            const title = chapter.title.replace(/([\\#;=])/g, '\\$1');
            toc += `\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=${chapter.start}\nEND=${end}\ntitle=${title}\n`;
        }
        return toc;
    }

    let downloadState = -1;
    let ffmpeg = null;
    let ffmpegInitPromise = null;
    let ffmpegLastLog = [];

    function resetFFmpeg() {
        const instance = ffmpeg;
        ffmpeg = null;
        ffmpegInitPromise = null;
        // This FFmpeg-js bundle exposes its worker, not a terminate() API.
        if (instance && instance.worker && typeof instance.worker.terminate === 'function') {
            try { instance.worker.terminate(); } catch (error) { console.warn('LibreGRAB: worker cleanup', error); }
        }
    }

    function runFFmpegStep(action, label, timeoutMs = 120000, instance = ffmpeg) {
        return new Promise((resolve, reject) => {
            const worker = instance && instance.worker;
            let finished = false;
            let timer;
            const cleanup = () => {
                clearTimeout(timer);
                if (worker && typeof worker.removeEventListener === 'function') {
                    worker.removeEventListener('error', onWorkerError);
                    worker.removeEventListener('messageerror', onWorkerError);
                }
            };
            const settle = (error, result) => {
                if (finished) return;
                finished = true;
                cleanup();
                if (error) reject(error);
                else resolve(result);
            };
            const onWorkerError = event => settle(new Error(
                `${label}: FFmpeg worker failed${event && event.message ? ': ' + event.message : '.'}`
            ));
            if (worker && typeof worker.addEventListener === 'function') {
                worker.addEventListener('error', onWorkerError);
                worker.addEventListener('messageerror', onWorkerError);
            }
            timer = setTimeout(() => settle(new Error(
                `${label}: no completion after ${Math.round(timeoutMs / 1000)} seconds. Try exporting the separate MP3 files.`
            )), timeoutMs);
            // Catch both synchronous API errors and rejected worker requests.
            Promise.resolve().then(action).then(
                result => settle(null, result),
                error => settle(new Error(`${label}: ${error && error.message ? error.message : String(error)}`))
            );
        });
    }

    async function fetchMp3ExportBlob(url, label, timeoutMs = 120000) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, { signal: controller.signal });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const blob = await response.blob();
            if (!blob.size) throw new Error('the response was empty');
            return blob;
        } catch (error) {
            throw new Error(`${label}: ${controller.signal.aborted ? 'download timed out' : error.message}`);
        } finally {
            clearTimeout(timer);
        }
    }

    async function writeMp3ExportBlob(instance, filename, blob) {
        const blobUrl = URL.createObjectURL(blob);
        try {
            await runFFmpegStep(() => instance.writeFileFromUrl(filename, blobUrl), `Loading ${filename}`, 120000, instance);
        } finally {
            URL.revokeObjectURL(blobUrl);
        }
    }

    async function getMp3CoverExtension(blob) {
        const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
        if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return 'jpg';
        const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
        if (header.length >= pngSignature.length && pngSignature.every((value, index) => header[index] === value)) return 'png';
        return null;
    }

    async function createAndDownloadMp3(urls, saveHandle, outputFilename) {
        if (!Array.isArray(urls) || !urls.length) throw new Error('No MP3 parts are available.');
        ffmpegLastLog = [];
        let outputBlob;
        try {
            const metadata = getMetadata();
            await initFFmpeg();
            const instance = ffmpeg;
            const files = [];
            appendExportMessage(`Downloading ${urls.length} MP3 parts for merging...`);
            // Process one response at a time, avoiding an extra in-memory copy of the whole book.
            for (let index = 0; index < urls.length; index++) {
                const filename = `${index + 1}.mp3`;
                const blob = await fetchMp3ExportBlob(urls[index].url, `MP3 part ${index + 1}`);
                if (/^(text\/|application\/(json|xml|xhtml\+xml))/i.test(blob.type)) {
                    throw new Error(`MP3 part ${index + 1}: the server returned ${blob.type} instead of audio.`);
                }
                await writeMp3ExportBlob(instance, filename, blob);
                files.push(`file '${filename}'`);
                appendExportMessage(`MP3 part ${index + 1} of ${urls.length} downloaded.`);
            }
            await writeMp3ExportBlob(instance, 'files.txt', new Blob([files.join('\n') + '\n']));

            const toc = generateTOCFFmpeg(metadata);
            if (toc) {
                await writeMp3ExportBlob(instance, 'chapters.txt', new Blob([toc]));
            } else {
                appendExportMessage('No valid chapter markers; the complete MP3 will still be created.');
            }

            let coverName = null;
            let coverBlob = null;
            if (metadata.coverUrl) {
                // Artwork is optional. Invalid artwork must not stop the audio export.
                try {
                    const candidate = await fetchMp3ExportBlob(metadata.coverUrl, 'Cover image', 30000);
                    const extension = await getMp3CoverExtension(candidate);
                    if (extension) {
                        coverName = `cover.${extension}`;
                        coverBlob = candidate;
                    } else {
                        appendExportMessage('Cover image skipped: MP3 artwork must be JPEG or PNG.');
                    }
                } catch (error) {
                    appendExportMessage(`Cover image skipped: ${error.message}`);
                }
            }
            // A worker failure is fatal even for artwork; do not reuse a possibly broken core.
            if (coverBlob) await writeMp3ExportBlob(instance, coverName, coverBlob);
            coverBlob = null;

            const args = ['-y', '-f', 'concat', '-safe', '0', '-i', 'files.txt'];
            let nextInput = 1;
            let tocInput = null;
            let coverInput = null;
            if (toc) {
                args.push('-f', 'ffmetadata', '-i', 'chapters.txt');
                tocInput = nextInput++;
            }
            if (coverName) {
                args.push('-i', coverName);
                coverInput = nextInput++;
            }
            args.push('-map', '0:a:0', '-c:a', 'copy', '-map_metadata', tocInput !== null ? String(tocInput) : '-1');
            if (tocInput !== null) args.push('-map_chapters', String(tocInput));
            else args.push('-map_chapters', '-1');
            args.push(
                '-metadata', `title=${metadata.title || 'Audiobook'}`,
                '-metadata', `album=${metadata.title || 'Audiobook'}`,
                '-metadata', `artist=${getAuthorString()}`,
                '-metadata', 'encoded_by=LibreGRAB'
            );
            if (coverInput !== null) {
                args.push(
                    '-map', `${coverInput}:v:0`, '-c:v', 'copy', '-disposition:v:0', 'attached_pic',
                    '-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)'
                );
            }
            args.push('-id3v2_version', '3', '-f', 'mp3', 'out.mp3');

            let lastProgressUpdate = 0;
            instance.setProgress(progress => {
                const seconds = Number(progress && progress.time) / 1000000;
                const now = Date.now();
                if (Number.isFinite(seconds) && seconds >= 0 && now - lastProgressUpdate >= 5000) {
                    lastProgressUpdate = now;
                    appendExportMessage(`Merging: ${(seconds / 3600).toFixed(2)} audio hours processed.`);
                }
            });
            appendExportMessage('Downloads complete. Combining MP3 parts without re-encoding...');
            const exitCode = await runFFmpegStep(() => instance.exec(args), 'Merging MP3', 600000, instance);
            if (typeof exitCode === 'number' && exitCode !== 0) {
                throw new Error(`FFmpeg could not create the MP3 (exit code ${exitCode}).`);
            }

            let workerUrl = null;
            try {
                workerUrl = await runFFmpegStep(() => instance.readFileToUrl('out.mp3'), 'Reading the merged MP3', 120000, instance);
                if (typeof workerUrl !== 'string' || !workerUrl.startsWith('blob:')) {
                    throw new Error('FFmpeg did not return a valid MP3 output URL.');
                }
                const blob = await fetchMp3ExportBlob(workerUrl, 'Reading the merged MP3');
                // Own the output on the page before terminating the worker that created its URL.
                outputBlob = new Blob([blob], { type: 'audio/mpeg' });
            } finally {
                if (workerUrl) URL.revokeObjectURL(workerUrl);
            }
            appendExportMessage(`MP3 ready (${(outputBlob.size / 1024 / 1024).toFixed(1)} MB). Saving...`);
        } catch (error) {
            console.error('LibreGRAB: MP3 export failed', error, ffmpegLastLog);
            const logs = ffmpegLastLog.slice(-12).join('\n');
            throw new Error(`${error && error.message ? error.message : String(error)}${logs ? '\nFFmpeg log:\n' + logs : ''}`);
        } finally {
            // Release all virtual input/output files and WASM memory, including on failure.
            // Keep ffmpegLastLog for diagnosis until the next MP3 export.
            resetFFmpeg();
        }
        await saveExportBlob(outputBlob, outputFilename, saveHandle);
    }

    async function initFFmpeg() {
        if (ffmpeg) return ffmpeg;
        if (ffmpegInitPromise) return ffmpegInitPromise;
        const pending = (async () => {
            if (typeof window.createFFmpeg !== 'function') {
                appendExportMessage('Downloading FFmpeg.wasm (about 50 MB)...');
                await addFFmpegJs();
            }
            if (typeof window.createFFmpeg !== 'function') throw new Error('FFmpeg did not load.');
            appendExportMessage('Initializing FFmpeg.wasm...');
            const creation = Promise.resolve().then(() => window.createFFmpeg());
            let instance;
            try {
                instance = await runFFmpegStep(() => creation, 'Initializing FFmpeg', 120000, null);
            } catch (error) {
                // The factory only exposes the worker once initialization resolves.
                creation.then(lateInstance => {
                    if (lateInstance && lateInstance.worker) lateInstance.worker.terminate();
                }, () => {});
                throw error;
            }
            ffmpeg = instance;
            for (const method of ['writeFile', 'writeFileFromUrl', 'readFileToUrl', 'exec', 'setProgress', 'setLogger']) {
                if (!instance || typeof instance[method] !== 'function') throw new Error(`FFmpeg is missing ${method}().`);
            }
            instance.setLogger(log => {
                const message = String(log && log.message !== undefined ? log.message : log);
                ffmpegLastLog.push(message);
                if (ffmpegLastLog.length > 80) ffmpegLastLog.shift();
                console.log('[LibreGRAB FFmpeg]', message);
            });
            appendExportMessage('FFmpeg.wasm initialized.');
            return instance;
        })();
        ffmpegInitPromise = pending;
        try {
            return await pending;
        } catch (error) {
            resetFFmpeg();
            throw error;
        }
    }

    // Fill in any chapter URLs the player has not provided yet by driving the
    // player itself through the missing parts: seeking to a part makes the
    // player set that part's working URL on its audio element, which the
    // capture hook records. No manual seeking needed. Parts whose URLs
    // already carry a query are left alone, so players with working params
    // (e.g. Libby) are untouched. The original position is always restored.
    function hasWorkingUrl(u){
        return /\?.+=/.test(u.url);
    }
    async function ensurePlayerUrls(urls){
        mergePerformanceMediaUrls();
        urls = getUrls();
        let missing = urls.filter(function(u){ return !hasWorkingUrl(u); });
        if (!missing.length) return getUrls();
        let spool = BIF.objects && BIF.objects.spool;
        let compass = BIF.objects && BIF.objects.compass;
        if (!spool || !compass || typeof compass.at !== "function") return getUrls();
        let origFloc = spool.focus ? spool.focus.floc : 0;
        downloadElem.innerHTML += "Gathering audio <span id=\"sweepAcc\"></span><br>";
        try {
            for (let i = 0; i < missing.length; i++) {
                let u = missing[i];
                let sweepSpan = downloadElem.querySelector("span#sweepAcc"); if (sweepSpan) sweepSpan.textContent = "part " + (u.index + 1) + " of " + urls.length + "…";
                try {
                    let fracUsed = (u.index === urls.length - 1) ? (0.25 + Math.random() * 0.5) : (0.01 + Math.random() * 0.98); let place = compass.at({ floc: u.index + fracUsed });
                    if (place && typeof place.seek === "function") place.seek();
                } catch (e) {}
                let waited = 0;
                while (waited < 2000) {
                    mergePerformanceMediaUrls();
                    if (hasWorkingUrl(getUrls().filter(function(x){ return x.index === u.index; })[0] || u)) break;
                    await new Promise(function(r){ setTimeout(r, 100); });
                    waited += 100;
                }
                if (i < missing.length - 1) {
                    await new Promise(function(r){ setTimeout(r, 400 + Math.random() * 1200); });
                }
            }
            let settled = 0;
            while (settled < 20000) {
                mergePerformanceMediaUrls();
                if (!getUrls().filter(function(x){ return !hasWorkingUrl(x); }).length) break;
                await new Promise(function(r){ setTimeout(r, 500); });
                settled += 500;
            }
        } finally {
            try {
                let back = compass.at({ floc: origFloc });
                if (back && typeof back.seek === "function") back.seek();
            } catch (e) {}
            let sweepDone = downloadElem.querySelector("span#sweepAcc"); if (sweepDone) sweepDone.textContent = "complete";
        }
        mergePerformanceMediaUrls();
        return getUrls();
    }

    async function exportMP3(){
        if (downloadState != -1)
            return;
        downloadState = 0;
        let stage = '选择保存位置';
        try {
            startExport('合并 MP3');
            const filename = getBookOutputFilename('mp3');
            const handle = await chooseExportHandle(filename, 'mp3');
            stage = '准备音频';
            const urls = await ensurePlayerUrls(getUrls());
            const bad = urls.filter(url => !hasWorkingUrl(url));
            if (bad.length) {
                throw new Error('无法获取第 ' + bad.map(url => url.fileNumber).join(', ') + ' 部分的音频地址，请先播放这些部分后重试。');
            }
            stage = '合并 MP3';
            await createAndDownloadMp3(urls, handle, filename);
        } catch (error) {
            console.error('[LibreGRAB ' + EXPORT_VERSION + '] MP3 export failed', error);
            appendExportMessage(error.name === 'AbortError' && stage === '选择保存位置'
                ? '已取消保存。' : stage + '失败：' + error.message);
        } finally {
            downloadState = -1;
        }
    }



    // Helper function for fallback blob download (older browsers)
    async function fallbackBlobDownload(files, filename) {
        downloadElem.innerHTML += "Using fallback download method...<br>";
        downloadElem.scrollTo(0, downloadElem.scrollHeight);

        const zipBlob = await (await getDownloadZip())(files).blob();

        downloadElem.innerHTML += "Generated zip file! <br>";
        downloadElem.scrollTo(0, downloadElem.scrollHeight);

        const downloadUrl = URL.createObjectURL(zipBlob);

        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();

        setTimeout(() => URL.revokeObjectURL(downloadUrl), 100);
    }

    async function createAndDownloadZip(urls, addMeta, saveHandle, outputFilename) {
        const files = [];
        if (!urls.length) throw new Error('没有可导出的音频。');
        // Assign names at the final archive boundary, never from URLs or headers.
        // Sequential fetching also avoids other downloads continuing after failure.
        for (const [index, url] of urls.entries()) {
            const filename = getAudioPartFilename({ fileNumber: index + 1 }, urls.length);
            const response = await fetch(url.url);
            if (!response.ok) throw new Error(`${filename}: HTTP ${response.status}`);
            const blob = await response.blob();
            if (!blob.size) throw new Error(filename + ' 是空文件。');
            files.push({ name: filename, input: new File([blob], filename, { type: 'audio/mpeg' }) });
            appendExportMessage(`已下载 ${index + 1}/${urls.length}：${filename}`);
        }
        files.push({
            name: 'LibreGRAB-v2-files.txt',
            input: `LibreGRAB ${EXPORT_VERSION}\n${files.map(file => file.name).join('\n')}\n`,
        });
        if (addMeta) files.push(...await createMetadata());
        const expectedNames = files.map(file => file.name);
        const writer = await getDownloadZip();
        appendExportMessage('正在生成 ZIP，并核对压缩包内的实际文件名……');
        if (saveHandle) {
            let writable;
            try {
                const zipStream = writer(files).body;
                writable = await saveHandle.createWritable();
                await zipStream.pipeTo(writable);
            } catch (error) {
                if (writable) { try { await writable.abort(); } catch (_) {} }
                appendExportMessage('直接写入 ZIP 失败：' + error.message + '。正在准备手动保存链接。');
                const blob = await writer(files).blob();
                await verifyZipFileNames(blob, expectedNames);
                await saveExportBlob(blob, outputFilename, null);
                return;
            }
            await verifyZipFileNames(await saveHandle.getFile(), expectedNames);
            appendExportMessage(`已保存 ${saveHandle.name}；已核对 ${urls.length} 个带序号的 MP3 文件。`);
        } else {
            const blob = await writer(files).blob();
            await verifyZipFileNames(blob, expectedNames);
            appendExportMessage(`已核对 ${urls.length} 个带序号的 MP3 文件。`);
            await saveExportBlob(blob, outputFilename, null);
        }
    }

    async function exportChapters(){
        if (downloadState != -1)
            return;
        downloadState = 0;
        let stage = '选择保存位置';
        try {
            startExport('ZIP 导出');
            const filename = getBookOutputFilename('zip');
            const handle = await chooseExportHandle(filename, 'zip');
            stage = '准备音频';
            const urls = await ensurePlayerUrls(getUrls());
            const bad = urls.filter(url => !hasWorkingUrl(url));
            if (bad.length) {
                throw new Error('无法获取第 ' + bad.map(url => url.fileNumber).join(', ') + ' 部分的音频地址，请先播放这些部分后重试。');
            }
            stage = '生成 ZIP';
            await createAndDownloadZip(urls, true, handle, filename);
        } catch (error) {
            console.error('[LibreGRAB ' + EXPORT_VERSION + '] ZIP export failed', error);
            appendExportMessage(error.name === 'AbortError' && stage === '选择保存位置'
                ? '已取消保存。' : stage + '失败：' + error.message);
        } finally {
            downloadState = -1;
        }
    }

    // Main entry point for audiobooks
    function bifFoundAudiobook(){
        // New global style info
        libreShadowHost = document.createElement("div");
        libreShadowHost.style.display = "contents";
        libreShadowRoot = libreShadowHost.attachShadow({mode: "closed"});
        let s = document.createElement("style");
        s.innerHTML = CSS;
        libreShadowRoot.appendChild(s)
        if (odreadCmptParams == null){
            alert("odreadCmptParams not set, so cannot resolve book urls! Please try refreshing.")
            return;
        }

        buildPirateUi();
        // FFmpeg is loaded only when merging, so ZIP export never depends on it.
    }



    /* =========================================
              END AUDIOBOOK SECTION!
       =========================================
    */

    /* =========================================
              BEGIN BOOK SECTION!
       =========================================
    */
    const bookNav = `
        <div style="text-align: center; width: 100%;">
           <a class="pLink" id="download"> <h1> Download EPUB </h1> </a>
        </div>
    `;
    const pages = window.pages = {};

    // Libby used the bind method as a way to "safely" expose
    // the decryption module. THIS IS THEIR DOWNFALL.
    // As we can hook bind, allowing us to obtain the
    // decryption function
    const originalBind = Function.prototype.bind;
    Function.prototype.bind = function(...args) {
        const boundFn = originalBind.apply(this, args);

        // Store bound arguments (excluding `this`) for potential decryption function
        boundFn.__boundArgs = args.slice(1);

        // Also store the original function for debugging
        boundFn.__originalFunction = this;

        // If this looks like a decryption function, store it globally
        if (this.toString().includes('decryption') ||
            args.some(arg => typeof arg === 'function' && arg.toString().includes('decryption'))) {
            console.log("Decryption function detected:", this);
            window.__libregrab_decryption_fn = args.find(arg => typeof arg === 'function');
        }

        return boundFn;
    };


    async function waitForChapters(callback){
        let components = getBookComponents();
        // Force all the chapters to load in.
        components.forEach(page =>{
            if (undefined != window.pages[page.id]) return;
            page._loadContent({callback: ()=>{}})
        });
        // But its not instant, so we need to wait until they are all set (see: bifFound())
        while (components.filter((page)=>undefined==window.pages[page.id]).length){
            await new Promise(r => setTimeout(r, 100));
            callback();
            console.log(components.filter((page)=>undefined==window.pages[page.id]).length);
        }
    }
    function getBookComponents(){
        return BIF.objects.reader._.context.spine._.components.filter(p => "hidden" != (p.block || {}).behavior)
    }
    function truncate(path){
        return path.substring(path.lastIndexOf('/') + 1);
    }
    function goOneLevelUp(url) {
        let u = new URL(url);
        if (u.pathname === "/") return url; // Already at root


        u.pathname = u.pathname.replace(/\/[^/]*\/?$/, "/");
        return u.toString();
    }
    function getFilenameFromURL(url) {
        const parsedUrl = new URL(url);
        const pathname = parsedUrl.pathname;
        return pathname.substring(pathname.lastIndexOf('/') + 1);
    }
    async function createContent(files, imgAssests){

        let cssRegistry = {};

        let components = getBookComponents();
        let totComp = components.length;
        downloadElem.innerHTML += `Gathering chapters <span id="chapAcc"> 0/${totComp} </span><br>`
        downloadElem.scrollTo(0, downloadElem.scrollHeight);

        let gc = 0;
        await waitForChapters(()=>{
            gc+=1;
            downloadElem.querySelector("span#chapAcc").innerHTML = ` ${components.filter((page)=>undefined!=window.pages[page.id]).length}/${totComp}`;
        });

        downloadElem.innerHTML += `Chapter gathering complete<br>`
        downloadElem.scrollTo(0, downloadElem.scrollHeight);

        let idToIfram = {};
        let idToMetaId = {};
        components.forEach(c=>{
            // Nothing that can be done here...
            if (c.sheetBox.querySelector("iframe") == null){
                console.warn("!!!" + window.pages[c.id]);
                return;
            }
            c.meta.id = c.meta.id || crypto.randomUUID()
            idToMetaId[c.id] = c.meta.id;
            idToIfram[c.id] = c.sheetBox.querySelector("iframe");

            c.sheetBox.querySelector("iframe").contentWindow.document.querySelectorAll("link").forEach(link=>{
                cssRegistry[c.id] = cssRegistry[c.id] || [];
                cssRegistry[c.id].push(link.href);

                if (imgAssests.includes(link.href)) return;
                imgAssests.push(link.href);


            });
        });
        let url = location.origin;
        for (let i of Object.keys(window.pages)){
            if (idToIfram[i])
                url = idToIfram[i].src;
            files.push({
                name: "OEBPS/" + truncate(i),
                input: fixXhtml(idToMetaId[i], url, window.pages[i], imgAssests, cssRegistry[i] || [])
            });
        }

        downloadElem.innerHTML += `Downloading assets <span id="assetGath"> 0/${imgAssests.length} </span><br>`
        downloadElem.scrollTo(0, downloadElem.scrollHeight);


        gc = 0;
        await Promise.all(imgAssests.map(name=>(async function(){
            const response = await fetch(name.startsWith("http") ? name : location.origin + "/" + name);
            if (response.status != 200) {
                downloadElem.innerHTML += `<b>WARNING:</b> Could not fetch ${name}<br>`
                downloadElem.scrollTo(0, downloadElem.scrollHeight);
                return;
            }
            const blob = await response.blob();

            files.push({
                name: "OEBPS/" + (name.startsWith("http") ? getFilenameFromURL(name) : name),
                input: blob
            });

            gc+=1;
            downloadElem.querySelector("span#assetGath").innerHTML = ` ${gc}/${imgAssests.length} `;
        })()));
    }
    function enforceEpubXHTML(metaId, url, htmlString, assetRegistry, links) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlString, 'text/html');
        const bod = doc.querySelector("body");
        if (bod){
            bod.setAttribute("id", metaId);
        }

        // Convert all elements to lowercase tag names
        const elements = doc.getElementsByTagName('*');
        for (let el of elements) {
            const newElement = doc.createElement(el.tagName.toLowerCase());

            // Copy attributes to the new element
            for (let attr of el.attributes) {
                newElement.setAttribute(attr.name, attr.value);
            }

            // Move child nodes to the new element
            while (el.firstChild) {
                newElement.appendChild(el.firstChild);
            }

            // Replace old element with the new one
            el.parentNode.replaceChild(newElement, el);
        }

        for (let el of elements) {
            if (el.tagName.toLowerCase() == "img" || el.tagName.toLowerCase() == "image"){
                let src = el.getAttribute("src") || el.getAttribute("xlink:href");
                if (!src) continue;

                if (!(src.startsWith("http://") ||  src.startsWith("https://"))){
                    src = (new URL(src, new URL(url))).toString();
                }
                if (!assetRegistry.includes(src))
                    assetRegistry.push(src);

                if (el.getAttribute("src"))
                    el.setAttribute("src", truncate(src));
                if (el.getAttribute("xlink:href"))
                    el.setAttribute("xlink:href", truncate(src));
            }
        }


        // Ensure the <head> element exists with a <title>
        let head = doc.querySelector('head');
        if (!head) {
            head = doc.createElement('head');
            doc.documentElement.insertBefore(head, doc.documentElement.firstChild);
        }

        let title = head.querySelector('title');
        if (!title) {
            title = doc.createElement('title');
            title.textContent = BIF.map.title.main; // Default title
            head.appendChild(title);
        }

        for (let link of links){
            let src = link;
            if (!(src.startsWith("http://") || src.startsWith("https://"))) {
              src = (new URL(src, new URL(url))).toString();
            }
            let linkElement = doc.createElement('link');
            linkElement.setAttribute("href", truncate(src));
            linkElement.setAttribute("rel", "stylesheet");
            linkElement.setAttribute("type", "text/css");
            head.appendChild(linkElement);
        }

        // Get the serialized XHTML string
        const serializer = new XMLSerializer();
        let xhtmlString = serializer.serializeToString(doc);

        // Ensure proper namespaces (if not already present)
        if (!xhtmlString.includes('xmlns="http://www.w3.org/1999/xhtml"')) {
            xhtmlString = xhtmlString.replace('<html>', '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:m="http://www.w3.org/1998/Math/MathML" xmlns:pls="http://www.w3.org/2005/01/pronunciation-lexicon" xmlns:ssml="http://www.w3.org/2001/10/synthesis" xmlns:svg="http://www.w3.org/2000/svg">');
        }

        return xhtmlString;
    }
    function fixXhtml(metaId, url, html, assetRegistry, links){
        html = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
` + enforceEpubXHTML(metaId, url, `<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:m="http://www.w3.org/1998/Math/MathML" xmlns:pls="http://www.w3.org/2005/01/pronunciation-lexicon" xmlns:ssml="http://www.w3.org/2001/10/synthesis" xmlns:svg="http://www.w3.org/2000/svg">`
            + html + `</html>`, assetRegistry, links);



        return html;
    }
    function getMimeTypeFromFileName(fileName) {
        const mimeTypes = {
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            png: 'image/png',
            gif: 'image/gif',
            bmp: 'image/bmp',
            webp: 'image/webp',
            mp4: 'video/mp4',
            mp3: 'audio/mp3',
            pdf: 'application/pdf',
            txt: 'text/plain',
            html: 'text/html',
            css: 'text/css',
            json: 'application/json',
            // Add more extensions as needed
        };

        const ext = fileName.split('.').pop().toLowerCase();
        return mimeTypes[ext] || 'application/octet-stream';
    }
    function makePackage(files, assetRegistry){
        const idStore = [];
        const doc = document.implementation.createDocument(
            'http://www.idpf.org/2007/opf', // default namespace
            'package', // root element name
            null // do not specify a doctype
        );

        // Step 2: Set attributes for the root element
        const packageElement = doc.documentElement;
        packageElement.setAttribute('version', '2.0');
        packageElement.setAttribute('xml:lang', 'en');
        packageElement.setAttribute('unique-identifier', 'pub-identifier');
        packageElement.setAttribute('xmlns', 'http://www.idpf.org/2007/opf');
        packageElement.setAttribute('xmlns:dc', 'http://purl.org/dc/elements/1.1/');
        packageElement.setAttribute('xmlns:dcterms', 'http://purl.org/dc/terms/');
        packageElement.setAttribute('xmlns:xsi', 'http://www.w3.org/2001/XMLSchema-instance');

        // Step 3: Create and append child elements to the root
        const metadata = doc.createElementNS('http://www.idpf.org/2007/opf', 'metadata');
        packageElement.appendChild(metadata);

        // Create child elements for metadata
        const dcIdentifier = doc.createElementNS('http://purl.org/dc/elements/1.1/', 'dc:identifier');
        dcIdentifier.setAttribute('id', 'pub-identifier');
        dcIdentifier.textContent = "" + BIF.map["-odread-buid"];
        metadata.appendChild(dcIdentifier);

        // Language
        if (BIF.map.language.length){
            const dcLanguage = doc.createElementNS('http://purl.org/dc/elements/1.1/', 'dc:language');
            dcLanguage.setAttribute('xsi:type', 'dcterms:RFC4646');
            dcLanguage.textContent = BIF.map.language[0];
            packageElement.setAttribute('xml:lang', BIF.map.language[0]);
            metadata.appendChild(dcLanguage);
        }

        // Identifier
        const metaIdentifier = doc.createElementNS('http://www.idpf.org/2007/opf', 'meta');
        metaIdentifier.setAttribute('id', 'meta-identifier');
        metaIdentifier.setAttribute('property', 'dcterms:identifier');
        metaIdentifier.textContent = "" + BIF.map["-odread-buid"];
        metadata.appendChild(metaIdentifier);

        // Title
        const dcTitle = doc.createElementNS('http://purl.org/dc/elements/1.1/', 'dc:title');
        dcTitle.setAttribute('id', 'pub-title');
        dcTitle.textContent = BIF.map.title.main;
        metadata.appendChild(dcTitle);


        // Creator (Author)
        if(BIF.map.creator.length){
            const dcCreator = doc.createElementNS('http://purl.org/dc/elements/1.1/', 'dc:creator');
            dcCreator.textContent = BIF.map.creator[0].name;
            metadata.appendChild(dcCreator);
        }

        // Description
        if(BIF.map.description){
            // Remove HTML tags
            let p = document.createElement("p");
            p.innerHTML = BIF.map.description.full;


            const dcDescription = doc.createElementNS('http://purl.org/dc/elements/1.1/', 'dc:description');
            dcDescription.textContent = p.textContent;
            metadata.appendChild(dcDescription);
        }

        // Step 4: Create the manifest, spine, guide, and other sections...
        const manifest = doc.createElementNS('http://www.idpf.org/2007/opf', 'manifest');
        packageElement.appendChild(manifest);

        const spine = doc.createElementNS('http://www.idpf.org/2007/opf', 'spine');
        spine.setAttribute("toc", "ncx");
        packageElement.appendChild(spine);


        const item = doc.createElementNS('http://www.idpf.org/2007/opf', 'item');
        item.setAttribute('id', 'ncx');
        item.setAttribute('href', 'toc.ncx');
        item.setAttribute('media-type', 'application/x-dtbncx+xml');
        manifest.appendChild(item);


        // Generate out the manifest
        let components = getBookComponents();
        components.forEach(chapter =>{
            const item = doc.createElementNS('http://www.idpf.org/2007/opf', 'item');
            let id = chapter.meta.id || crypto.randomUUID();
            while (idStore.includes(id)) {
              id = id + "-" + crypto.randomUUID();
            }
            item.setAttribute('id', id);
            idStore.push(id);
            item.setAttribute('href', truncate(chapter.meta.path));
            item.setAttribute('media-type', 'application/xhtml+xml');
            manifest.appendChild(item);


            const itemref = doc.createElementNS('http://www.idpf.org/2007/opf', 'itemref');
            itemref.setAttribute('idref', id); // Use the same id as the manifest item
            itemref.setAttribute('linear', "yes");
            spine.appendChild(itemref);
        });

        assetRegistry.forEach(asset => {
            const item = doc.createElementNS('http://www.idpf.org/2007/opf', 'item');
            let aname = asset.startsWith("http") ? getFilenameFromURL(asset) : asset;
            let id = aname.split(".")[0];
            while (idStore.includes(id)) {
              id = id + "-" + crypto.randomUUID();
            }
            item.setAttribute('id', id);
            idStore.push(id);
            item.setAttribute('href', aname);
            item.setAttribute('media-type', getMimeTypeFromFileName(aname));
            manifest.appendChild(item);
        });

        // Step 5: Serialize the document to a string
        const serializer = new XMLSerializer();
        const xmlString = serializer.serializeToString(doc);

        files.push({
            name: "OEBPS/content.opf",
            input: `<?xml version="1.0" encoding="utf-8" standalone="no"?>\n` + xmlString
        });
    }
    function makeToc(files){
        // Step 1: Create the document with a default namespace
        const doc = document.implementation.createDocument(
            'http://www.daisy.org/z3986/2005/ncx/', // default namespace
            'ncx', // root element name
            null // do not specify a doctype
        );

        // Step 2: Set attributes for the root element
        const ncxElement = doc.documentElement;
        ncxElement.setAttribute('version', '2005-1');

        // Step 3: Create and append child elements to the root
        const head = doc.createElementNS('http://www.daisy.org/z3986/2005/ncx/', 'head');
        ncxElement.appendChild(head);

        const uidMeta = doc.createElementNS('http://www.daisy.org/z3986/2005/ncx/', 'meta');
        uidMeta.setAttribute('name', 'dtb:uid');
        uidMeta.setAttribute('content', "" + BIF.map["-odread-buid"]);
        head.appendChild(uidMeta);

        // Step 4: Create docTitle and add text
        const docTitle = doc.createElementNS('http://www.daisy.org/z3986/2005/ncx/', 'docTitle');
        ncxElement.appendChild(docTitle);

        const textElement = doc.createElementNS('http://www.daisy.org/z3986/2005/ncx/', 'text');
        textElement.textContent = BIF.map.title.main;
        docTitle.appendChild(textElement);

        // Step 5: Create navMap and append navPoint elements
        const navMap = doc.createElementNS('http://www.daisy.org/z3986/2005/ncx/', 'navMap');
        ncxElement.appendChild(navMap);


        let components = getBookComponents();

        components.forEach(chapter =>{
            // First navPoint
            const navPoint1 = doc.createElementNS('http://www.daisy.org/z3986/2005/ncx/', 'navPoint');
            navPoint1.setAttribute('id', chapter.meta.id);
            navPoint1.setAttribute('playOrder', '' + (1+chapter.index));
            navMap.appendChild(navPoint1);

            const navLabel1 = doc.createElementNS('http://www.daisy.org/z3986/2005/ncx/', 'navLabel');
            navPoint1.appendChild(navLabel1);

            const text1 = doc.createElementNS('http://www.daisy.org/z3986/2005/ncx/', 'text');
            text1.textContent = BIF.map.title.main;
            navLabel1.appendChild(text1);

            const content1 = doc.createElementNS('http://www.daisy.org/z3986/2005/ncx/', 'content');
            content1.setAttribute('src', truncate(chapter.meta.path));
            navPoint1.appendChild(content1);
        });


        // Step 6: Serialize the document to a string
        const serializer = new XMLSerializer();
        const xmlString = serializer.serializeToString(doc);

        files.push({
            name: "OEBPS/toc.ncx",
            input: `<?xml version="1.0" encoding="utf-8" standalone="no"?>\n` + xmlString
        });
    }
    async function downloadEPUB(){
        let imageAssets = new Array();
        const files = [];

        // Add mimetype file (must be first and uncompressed for EPUB spec)
        files.push({
            name: "mimetype",
            input: "application/epub+zip"
        });

        // Add META-INF files
        files.push({
            name: "META-INF/container.xml",
            input: `<?xml version="1.0" encoding="UTF-8"?>
                <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
                    <rootfiles>
                        <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
                    </rootfiles>
                </container>
        `
        });

        // Add required encryption file for DRM compliance (required by EPUB spec)
        files.push({
            name: "META-INF/encryption.xml",
            input: `<?xml version="1.0" encoding="UTF-8"?>
                <encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"/>
        `
        });

        await createContent(files, imageAssets);

        makePackage(files, imageAssets);
        makeToc(files);


        downloadElem.innerHTML += "<br><b>Downloads complete!</b> Starting EPUB generation and download...<br>";
        downloadElem.scrollTo(0, downloadElem.scrollHeight);

        const filename = BIF.map.title.main + '.epub';

        // Try using File System Access API for streaming (much faster)
        if ('showSaveFilePicker' in window) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: filename,
                    types: [{
                        description: 'EPUB eBook',
                        accept: {'application/epub+zip': ['.epub']},
                    }],
                });

                downloadElem.innerHTML += "Streaming EPUB file to disk...<br>";
                downloadElem.scrollTo(0, downloadElem.scrollHeight);

                const writable = await handle.createWritable();
                const zipStream = (await getDownloadZip())(files).body;

                await zipStream.pipeTo(writable);

                downloadElem.innerHTML += "Download complete!<br>";
                downloadElem.scrollTo(0, downloadElem.scrollHeight);
            } catch (err) {
                if (err.name === 'AbortError') {
                    // User cancelled the save dialog
                    downloadElem.innerHTML += "Download cancelled by user.<br>";
                } else {
                    console.error('Streaming download failed:', err);
                    downloadElem.innerHTML += "Streaming failed, using fallback...<br>";
                    // Fall back to blob method
                    await fallbackBlobDownload(files, filename);
                }
            }
        } else {
            // Fall back to blob method for older browsers
            await fallbackBlobDownload(files, filename);
        }

        downloadState = -1;
    }

    // Main entry point for books
    function bifFoundBook(){
        // New global style info
        let s = document.createElement("style");
        s.innerHTML = CSS;
        document.head.appendChild(s)

        if (!window.__bif_cfc1){
            alert("Injection failed! __bif_cfc1 not found");
            return;
        }

        // Debug: Log the original function structure
        console.log("Original __bif_cfc1:", window.__bif_cfc1);
        console.log("__bif_cfc1.__boundArgs:", window.__bif_cfc1.__boundArgs);
        const old_crf1 = window.__bif_cfc1;
        window.__bif_cfc1 = (win, edata)=>{
            // If the bind hook succeeds, then the first element of bound args
            // will be the decryption function. So we just passivly build up an
            // index of the pages!
            if (old_crf1.__boundArgs && old_crf1.__boundArgs[0]) {
                pages[win.name] = old_crf1.__boundArgs[0](edata);
            } else {
                console.warn("Bind args not found, trying alternative decryption method");
                // Try global decryption function if available
                if (window.__libregrab_decryption_fn) {
                    try {
                        pages[win.name] = window.__libregrab_decryption_fn(edata);
                    } catch (error) {
                        console.error("Global decryption function failed:", error);
                    }
                }
                // Final fallback: try to extract decrypted content directly
                try {
                    pages[win.name] = old_crf1(win, edata);
                } catch (error) {
                    console.error("Failed to decrypt content:", error);
                    console.log("Attempting raw edata extraction");
                    pages[win.name] = edata; // Sometimes the edata is already decrypted
                }
            }
            return old_crf1(win, edata);
        };

        buildBookPirateUi();
    }

    function downloadEPUBBBtn(){
        if (downloadState != -1)
            return;

        downloadState = 0;
        downloadElem.classList.add("active");
        downloadElem.innerHTML = "<b>Starting download</b><br>";

        downloadEPUB().then(()=>{});
    }
    function buildBookPirateUi(){
        // Create the nav
        let nav = document.createElement("div");
        nav.innerHTML = bookNav;
        nav.querySelector("#download").onclick = downloadEPUBBBtn;
        nav.classList.add("pNav");
        let pbar = document.querySelector(".nav-progress-bar");
        pbar.insertBefore(nav, pbar.children[1]);



        downloadElem = document.createElement("div");
        downloadElem.classList.add("foldMenu");
        downloadElem.setAttribute("tabindex", "-1"); // Don't mess with tab key
        document.body.appendChild(downloadElem);
    }

    /* =========================================
              END BOOK SECTION!
       =========================================
    */

    /* =========================================
              BEGIN INITIALIZER SECTION!
       =========================================
    */

    // The "BIF" contains all the info we need to download
    // stuff, so we wait until the page is loaded, and the
    // BIF is present, to inject the pirate menu.
    // Delay audiobook UI until the player has fully initialized: building
    // during load races the player's own setup and redirects to terms.
    // Readiness = BIF + spool components + bootstrap params + a progress
    // bar whose child count is stable across polls. Ebooks keep the old
    // trigger untouched. A throw while checking never escapes: keep polling.
    let __pbarCount = -1, __stablePolls = 0;
    let intr = setInterval(()=>{
        try {
            const pbar = document.querySelector(".nav-progress-bar");
            if (window.BIF == undefined || pbar == undefined) { __pbarCount = -1; __stablePolls = 0; return; }
            let mode = location.hostname.split(".")[1];
            if (mode != "listen") {
                clearInterval(intr);
                BIF = window.BIF;
                bifFoundBook();
                return;
            }
            const spool = window.BIF.objects && window.BIF.objects.spool;
            const ready = spool && Array.isArray(spool.components) && spool.components.length > 0 &&
                odreadCmptParams != null;
            if (!ready) { __pbarCount = -1; __stablePolls = 0; return; }
            if (pbar.children.length !== __pbarCount) { __pbarCount = pbar.children.length; __stablePolls = 0; return; }
            if (++__stablePolls < 2) return;
            clearInterval(intr);
            BIF = window.BIF;
            bifFoundAudiobook();
        } catch (e) { __pbarCount = -1; __stablePolls = 0; }
    }, 500);
    }

    function injectPageScript(code) {
        const script = document.createElement('script');
        script.textContent = code;
        (document.documentElement || document.head || document.body).appendChild(script);
        script.remove();
    }

    injectPageScript(`(${mainCode.toString()})();`);

})();
