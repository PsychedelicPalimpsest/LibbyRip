// ==UserScript==
// @name          LibreGRAB
// @namespace     http://tampermonkey.net/
// @version       2026-10-11
// @description   Download all the booty!
// @author        PsychedelicPalimpsest
// @license       MIT
// @supportURL    https://github.com/PsychedelicPalimpsest/LibbyRip/issues
// @match         *://read.libbyapp.com/*
// @match         *://*.read.libbyapp.com/*
// @match         *://read.overdrive.com/*
// @match         *://*.read.overdrive.com/*
// @match         *://listen.libbyapp.com/*
// @match         *://*.listen.libbyapp.com/*
// @match         *://listen.overdrive.com/*
// @match         *://*.listen.overdrive.com/*
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
    const clientZipReadyCode = `
window.__libregrabClientZipReady = new Promise((resolve, reject) => {
    window.__libregrabResolveClientZip = resolve;
    window.__libregrabRejectClientZip = reject;
});
`;
    function mainCode() {

    // Since the ffmpeg.js file is 50mb, it slows the page down too much
    // to be in a "require" attribute, so we load it in async
    function addFFmpegJs(){
        let scriptTag = document.createElement("script");
        scriptTag.setAttribute("type", "text/javascript");
        scriptTag.setAttribute("src", "https://github.com/PsychedelicPalimpsest/FFmpeg-js/releases/download/14/0.12.5.bundle.js");
        document.body.appendChild(scriptTag);

        return new Promise(accept =>{
            let i = setInterval(()=>{
                if (window.createFFmpeg){
                    clearInterval(i);
                    accept(window.createFFmpeg);
                }
            }, 50)
            });
    }

    let downloadElem;
    let BIF;
    async function getDownloadZip() {
        if (window.downloadZip) return window.downloadZip;
        if (window.__libregrabClientZipReady) return window.__libregrabClientZipReady;
        throw new Error("client-zip did not load");
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

    function buildPirateUi(){
        // Create the nav
        let nav = document.createElement("div");
        nav.innerHTML = audioBookNav;
        nav.querySelector("#chap").onclick = viewChapters;
        nav.querySelector("#down").onclick = exportMP3;
        nav.querySelector("#exp").onclick = exportChapters;
        nav.classList.add("pNav");
        let pbar = document.querySelector(".nav-progress-bar");
        pbar.insertBefore(nav, pbar.children[1]);

        // Create the chapters menu
        chapterMenuElem = document.createElement("div");
        chapterMenuElem.classList.add("foldMenu");
        chapterMenuElem.setAttribute("tabindex", "-1"); // Don't mess with tab key
        const urls = getUrls();

        chapterMenuElem.innerHTML = chaptersMenu.replace("{CHAPTERS}", urls.length);
        document.body.appendChild(chapterMenuElem);

        downloadElem = document.createElement("div");
        downloadElem.classList.add("foldMenu");
        downloadElem.setAttribute("tabindex", "-1"); // Don't mess with tab key
        document.body.appendChild(downloadElem);
    }
    function getUrls(){
        let ret = [];
        for (let spine of BIF.objects.spool.components){
            let data = {

                url: location.origin + "/" + spine.meta.path + "?" + odreadCmptParams[spine.spinePosition],
                index : spine.meta["-odread-spine-position"],
                duration: spine.meta["audio-duration"],
                size: spine.meta["-odread-file-bytes"],
                type: spine.meta["media-type"]
            };
            ret.push(data);
        }
        return ret;
    }
    function paddy(num, padlen, padchar) {
        var pad_char = typeof padchar !== 'undefined' ? padchar : '0';
        var pad = new Array(1 + padlen).join(pad_char);
        return (pad + num).slice(-pad.length);
    }
    let firstChapClick = true;
    function viewChapters(){
        // Populate chapters ONLY after first viewing
        if (firstChapClick){
            firstChapClick = false;
            for (let url of getUrls()){
                let span = document.createElement("span");
                span.classList.add("pChapLabel")
                span.textContent = "#" + (1 + url.index);

                let audio = document.createElement("audio");
                audio.setAttribute("controls", "");
                let source = document.createElement("source");
                source.setAttribute("src", url.url);
                source.setAttribute("type", url.type);
                audio.appendChild(source);

                chapterMenuElem.appendChild(span);
                chapterMenuElem.appendChild(document.createElement("br"));
                chapterMenuElem.appendChild(audio);
                chapterMenuElem.appendChild(document.createElement("br"));
            }
        }
        if (chapterMenuElem.classList.contains("active"))
            chapterMenuElem.classList.remove("active");
        else
            chapterMenuElem.classList.add("active");
        chapterMenuElem.querySelector("#dumpAll").onclick = async function(){

            chapterMenuElem.querySelector("#dumpAll").style.display = "none";

            await Promise.all(getUrls().map(async function(url){
                const res = await fetch(url.url);
                const blob = await res.blob();

                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = `${getAuthorString()} - ${BIF.map.title.main}.${url.index}.mp3`;
                link.click();

                URL.revokeObjectURL(link.href);
            }));

            chapterMenuElem.querySelector("#dumpAll").style.display = "";
        };
    }
    function getAuthorString(){
        return BIF.map.creator.filter(creator => creator.role === 'author').map(creator => creator.name).join(", ");
    }

    function getMetadata(){
        let spineToIndex = BIF.map.spine.map((x)=>x["-odread-original-path"]);
        let metadata = {
            title: BIF.map.title.main,
            description: BIF.map.description,
            coverUrl: BIF.root.querySelector("image").getAttribute("href"),
            creator: BIF.map.creator,
            spine: BIF.map.spine.map((x)=>{return {
                duration: x["audio-duration"],
                type: x["media-type"],
                bitrate: x["audio-bitrate"],
            }})
        };
        if (BIF.map.nav.toc != undefined){
            metadata.chapters = BIF.map.nav.toc.map((rChap)=>{
                return {
                    title: rChap.title,
                    spine: spineToIndex.indexOf(rChap.path.split("#")[0]),
                    offset: 1*(rChap.path.split("#")[1] | 0)
                };
            });
        }
        return metadata;

    }

    async function createMetadata(){
        let metadata = getMetadata();
        const response = await fetch(metadata.coverUrl);
        const blob = await response.blob();
        const csplit = metadata.coverUrl.split(".");
        return [
            {
                name: "metadata/cover." + csplit[csplit.length-1],
                input: blob
            },
            {
                name: "metadata/metadata.json",
                input: JSON.stringify(metadata, null, 2)
            }
        ];
    }
    function generateTOCFFmpeg(metadata){
        if (!metadata.chapters) return null;
        let lastTitle = null;

        const duration = Math.round(BIF.map.spine.map((x)=>x["audio-duration"]).reduce((acc, val) => acc + val)) * 1000000000;

        let toc = ";FFMETADATA1\n\n";

        // Get the offset for each spine element
        let temp = 0;
        const spineSpecificOffset = BIF.map.spine.map((x)=>{
            let old = temp;
            temp += x["audio-duration"]*1;
            return old;
        });

        // Libby chapter split over many mp3s have duplicate chapters, so we must filter them
        // then convert them to be in [title, start_in_nanosecs]
        let chapters = metadata.chapters.filter((x)=>{
            let ret = x.title !== lastTitle;
            lastTitle = x.title;
            return ret;
        }).map((x)=>[
            // Escape the title
            x.title.replaceAll("\\", "\\\\").replaceAll("#", "\\#").replaceAll(";", "\\;").replaceAll("=", "\\=").replaceAll("\n", ""),
            // Calculate absolute offset in nanoseconds
            Math.round(spineSpecificOffset[x.spine] + x.offset) * 1000000000
        ]);

        // Transform chapter to be [title, start_in_nanosecs, end_in_nanosecounds]
        let last = duration;
        for (let i = chapters.length - 1; -1 != i; i--){
            chapters[i].push(last);
            last = chapters[i][1];
        }

        chapters.forEach((x)=>{
            toc += "[CHAPTER]\n";
            toc += `START=${x[1]}\n`;
            toc += `END=${x[2]}\n`;
            toc += `title=${x[0]}\n`;
        });

        return toc;
    }

    let downloadState = -1;
    let ffmpeg = null;
    async function createAndDownloadMp3(urls){
        await initFFmpeg();
        let metadata = getMetadata();
        downloadElem.innerHTML += "Downloading mp3 files <br>";
        await ffmpeg.writeFile("chapters.txt", generateTOCFFmpeg(metadata));


        let fetchPromises = urls.map(async (url) => {
            // Download the mp3
            const response = await fetch(url.url);
            const blob = await response.blob();

            // Dump it into ffmpeg (We do the request here as not to bog down the worker thread)
            const blob_url = URL.createObjectURL(blob);
            await ffmpeg.writeFileFromUrl((url.index + 1) + ".mp3", blob_url);
            URL.revokeObjectURL(blob_url);


            downloadElem.innerHTML += `Download of disk ${url.index + 1} complete! <br>`
            downloadElem.scrollTo(0, downloadElem.scrollHeight);
        });

        let coverName = null;

        if (metadata.coverUrl){
            console.log(metadata.coverUrl);
            const csplit = metadata.coverUrl.split(".");
            const response = await fetch(metadata.coverUrl);
            const blob = await response.blob();

            coverName = "cover." + csplit[csplit.length-1];

            const blob_url = URL.createObjectURL(blob);
            await ffmpeg.writeFileFromUrl(coverName, blob_url);
            URL.revokeObjectURL(blob_url);
        }


        await Promise.all(fetchPromises);

        downloadElem.innerHTML += `<br><b>Downloads complete!</b> Now combining them together! (This might take a <b><i>minute</i></b>) <br> Transcode progress: <span id="mp3Progress">0</span> hours in to audiobook<br>`
        downloadElem.scrollTo(0, downloadElem.scrollHeight);

        let files = "";

        for (let i = 0; i < urls.length; i++){
            files += `file '${i+1}.mp3'\n`
        }
        await ffmpeg.writeFile("files.txt", files);

        ffmpeg.setProgress((progress)=>{
            // The progress.time feature seems to be in micro secounds
            downloadElem.querySelector("#mp3Progress").textContent = (progress.time / 1000000 / 3600).toFixed(2);
        });
        ffmpeg.setLogger(console.log);

        await ffmpeg.exec([
                           "-y", "-f", "concat",
                           "-i", "files.txt",
                           "-i", "chapters.txt"]
                          .concat(coverName ? ["-i", coverName] : [])
                          .concat([
                            "-map_metadata", "1",
                            "-codec", "copy",
                            "-map", "0:a",
                            "-metadata", `title=${metadata.title}`,
                            "-metadata", `album=${metadata.title}`,
                            "-metadata", `artist=${getAuthorString()}`,
                            "-metadata", `encoded_by=LibbyRip/LibreGRAB`,
                            "-c:a", "copy"])
                          .concat(coverName ? [
                            "-map", "2:v",
                            "-metadata:s:v", "title=Album cover",
                            "-metadata:s:v", "comment=Cover (front)"]
                            : [])
                            .concat(["out.mp3"]));



        let blob_url = await ffmpeg.readFileToUrl("out.mp3");

        const link = document.createElement('a');
        link.href = blob_url;

        link.download = getAuthorString() + ' - ' + BIF.map.title.main + '.mp3';
        document.body.appendChild(link);
        link.click();
        link.remove();

        downloadState = -1;
        downloadElem.innerHTML = ""
        downloadElem.classList.remove("active");

        // Clean up the object URL
        setTimeout(() => URL.revokeObjectURL(blob_url), 100);

    }

    let ffmpegInitPromise = null;

    async function initFFmpeg() {
        console.log("initFFmpeg");
        if (ffmpegInitPromise) return ffmpegInitPromise;
        ffmpegInitPromise = (async () => {
            if (!window.createFFmpeg) {
                downloadElem.innerHTML += "Downloading FFmpeg.wasm (~50MB)<br>";
                console.log("Downloading FFmpeg.wasm (~50MB)");
                await addFFmpegJs();
                downloadElem.innerHTML += "Completed FFmpeg.wasm download<br>";
                console.log("Completed FFmpeg.wasm download");
            }

            // Initialize FFmpeg if not already done
            if (!ffmpeg) {
                downloadElem.innerHTML += "Initializing FFmpeg.wasm<br>";
                console.log("Initializing FFmpeg.wasm");
                ffmpeg = await window.createFFmpeg({ log: true });
                downloadElem.innerHTML += "FFmpeg.wasm initialized<br>";
                console.log("FFmpeg.wasm initialized");
            }
        })();
        return ffmpegInitPromise;
    }

    function exportMP3(){
        if (downloadState != -1)
            return;

        downloadState = 0;
        downloadElem.classList.add("active");
        downloadElem.innerHTML = "<b>Starting MP3</b><br>";
        createAndDownloadMp3(getUrls()).then((p)=>{});
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

    async function createAndDownloadZip(urls, addMeta) {
        const files = [];

        // Fetch all files and add them to the files array
        const fetchPromises = urls.map(async (url) => {
            const response = await fetch(url.url);
            const blob = await response.blob();
            const filename = "Part " + paddy(url.index + 1, 3) + ".mp3";

            let partElem = document.createElement("div");
            partElem.textContent = "Download of "+ filename + " complete";
            downloadElem.appendChild(partElem);
            downloadElem.scrollTo(0, downloadElem.scrollHeight);

            downloadState += 1;

            return {
                name: filename,
                input: blob
            };
        });

        // Start metadata creation in parallel with file downloads
        const metadataPromise = addMeta ? createMetadata() : Promise.resolve([]);

        // Wait for both file downloads and metadata creation to complete
        const [downloadedFiles, metadataFiles] = await Promise.all([
            Promise.all(fetchPromises),
            metadataPromise
        ]);

        files.push(...downloadedFiles);
        files.push(...metadataFiles);

        downloadElem.innerHTML += "<br><b>Downloads complete!</b> Starting ZIP generation and download...<br>";
        downloadElem.scrollTo(0, downloadElem.scrollHeight);

        const filename = getAuthorString() + ' - ' + BIF.map.title.main + '.zip';

        // Try using File System Access API for streaming (much faster)
        if ('showSaveFilePicker' in window) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: filename,
                    types: [{
                        description: 'ZIP Archive',
                        accept: {'application/zip': ['.zip']},
                    }],
                });

                downloadElem.innerHTML += "Streaming ZIP file to disk...<br>";
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
        downloadElem.innerHTML = ""
        downloadElem.classList.remove("active");
    }

    function exportChapters(){
        if (downloadState != -1)
            return;

        downloadState = 0;
        downloadElem.classList.add("active");
        downloadElem.innerHTML = "<b>Starting export</b><br>";
        createAndDownloadZip(getUrls(), true).then((p)=>{});
    }

    // Main entry point for audiobooks
    function bifFoundAudiobook(){
        // New global style info
        let s = document.createElement("style");
        s.innerHTML = CSS;
        document.head.appendChild(s)
        if (odreadCmptParams == null){
            alert("odreadCmptParams not set, so cannot resolve book urls! Please try refreshing.")
            return;
        }

        buildPirateUi();
        initFFmpeg().catch(console.error);
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

    // NOTE: Libby used to expose chapter decryption client-side (via a
    // Function.prototype.bind hook that captured the decryption function, and
    // a window.__bif_cfc1 callback that fed a window.pages index). As of
    // ~Oct 2026 the libbyapp.com reader serves chapters pre-decrypted from
    // signed URLs, so that whole mechanism was removed (2026-10-11 cleanup).


    // Libby (as of ~Oct 2026 on the libbyapp.com reader) serves every chapter as
    // plain, already-decrypted XHTML from a signed per-chapter URL, so there is
    // no client-side decryption step anymore: a chapter is ready as soon as its
    // iframe has a src.
    function chapterUrl(c){
        const f = c.sheetBox && c.sheetBox.querySelector("iframe");
        return (f && f.src) ? f.src : null;
    }
    // Libby encrypts chapter bodies client-side (bifocal "rumi" module). Each
    // chapter shell is just <head> (styles) + <body><script>
    // parent.__bif_cfc1(self,'<edata>')</script></body>. The edata is base64
    // with every 4-char group's 1st and 4th characters swapped; decoding it
    // yields the real <body>...</body> HTML. This replicates Libby's own
    // __bif_cfc1 decryptor so the download doesn't depend on their globals.
    //
    // Returns {html, status}. Status is one of:
    //   "decrypted"     - payload found and decrypted into a real <body>
    //   "unencrypted"   - no payload and no <script> in the body (cover, title, ...)
    //   "unknown-shell" - no payload match, but the body holds a <script>:
    //                     the shell format changed and we cannot decrypt it
    //   "decrypt-failed"- payload found but the transform threw
    //   "bad-payload"   - payload decrypted to something that is not a <body>
    function decryptChapterShell(shellHtml){
        const m = shellHtml.match(/parent\.__bif_cfc1\(self,'([^']+)'\)/)
               || shellHtml.match(/parent\.__bif_cfc0\(self,'([^']+)'\)/);
        if (!m){
            const hasScript = /<body[^>]*>[\s\S]*<script/i.test(shellHtml);
            return {html: shellHtml, status: hasScript ? "unknown-shell" : "unencrypted"};
        }
        const isCfc1 = shellHtml.includes("__bif_cfc1");
        let decrypted;
        try{
            const raw = m[1];
            decrypted = atob(isCfc1 ? raw.replace(/(.)(.)(.)(.)/g, "$4$2$3$1") : raw);
        }catch(e){
            return {html: shellHtml, status: "decrypt-failed"};
        }
        if (!/^\s*<body/i.test(decrypted)){
            return {html: shellHtml, status: "bad-payload"};
        }
        // Splice the decrypted <body> into the shell, keeping its <head> (styles).
        const spliced = shellHtml.replace(/<body[^>]*>[\s\S]*<\/body>/i, ()=>decrypted);
        return {html: spliced !== shellHtml ? spliced : shellHtml, status: "decrypted"};
    }

    async function waitForChapters(callback){
        let components = getBookComponents();
        // Force all the chapters to load in.
        components.forEach(page =>{
            if (chapterUrl(page)) return;
            page._loadContent({callback: ()=>{}})
        });
        // But its not instant, so we need to wait until they are all set.
        // Give up after 2 minutes rather than hanging forever.
        const deadline = Date.now() + 120000;
        while (components.filter((page)=>!chapterUrl(page)).length){
            if (Date.now() > deadline){
                console.warn("Timed out waiting for chapters: " +
                    components.filter((page)=>!chapterUrl(page)).map(p=>p.id).join(", "));
                break;
            }
            await new Promise(r => setTimeout(r, 100));
            callback();
            console.log(components.filter((page)=>!chapterUrl(page)).length);
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
            downloadElem.querySelector("span#chapAcc").innerHTML = ` ${components.filter((page)=>chapterUrl(page)).length}/${totComp}`;
        });

        downloadElem.innerHTML += `Chapter gathering complete<br>`
        downloadElem.scrollTo(0, downloadElem.scrollHeight);

        let idToIfram = {};
        let idToMetaId = {};
        components.forEach(c=>{
            // Nothing that can be done here...
            if (c.sheetBox.querySelector("iframe") == null){
                console.warn("No iframe for chapter " + c.id);
                return;
            }
            c.meta.id = c.meta.id || crypto.randomUUID()
            idToMetaId[c.id] = c.meta.id;
            idToIfram[c.id] = c.sheetBox.querySelector("iframe");

            try {
                const frameDoc = c.sheetBox.querySelector("iframe").contentWindow.document;
                if (frameDoc) {
                    frameDoc.querySelectorAll("link").forEach(link=>{
                        if (!link.href) return;
                        cssRegistry[c.id] = cssRegistry[c.id] || [];
                        cssRegistry[c.id].push(link.href);

                        if (imgAssests.includes(link.href)) return;
                        imgAssests.push(link.href);
                    });
                }
            } catch (e) {
                console.warn("Could not read iframe link elements for " + c.id, e);
            }
        });
        // Chapters are fetched from their signed iframe URLs, then decrypted
        // client-side (see decryptChapterShell): the served HTML is only a
        // shell holding an encrypted payload.
        let fetched = 0;
        for (let c of components){
            const src = (idToIfram[c.id] && idToIfram[c.id].src) || chapterUrl(c);
            if (!src){
                console.warn("No chapter URL for " + c.id + ", skipping");
                continue;
            }
            let res;
            try {
                res = await fetch(src, {credentials: "include"});
            } catch(e) {
                downloadElem.innerHTML += `<b>WARNING:</b> Could not fetch chapter ${c.id}: ${e}<br>`;
                downloadElem.scrollTo(0, downloadElem.scrollHeight);
                continue;
            }
            if (!res.ok) {
                downloadElem.innerHTML += `<b>WARNING:</b> Could not fetch chapter ${c.id} (HTTP ${res.status})<br>`;
                downloadElem.scrollTo(0, downloadElem.scrollHeight);
                continue;
            }
            const chapter = decryptChapterShell(await res.text());
            if (chapter.status !== "decrypted" && chapter.status !== "unencrypted"){
                const msg = "Chapter " + c.id + ": shell kept as-is (" + chapter.status +
                    ") - page will be empty";
                console.warn(msg);
                downloadElem.innerHTML += `<b>WARNING:</b> ${msg}<br>`;
                downloadElem.scrollTo(0, downloadElem.scrollHeight);
            }
            // Also extract stylesheets directly from chapter shell HTML
            const linkHrefMatches = chapter.html.matchAll(/<link[^>]+href=["']([^"']+)["'][^>]*>/gi);
            for (let m of linkHrefMatches) {
                const rawHref = m[1];
                const absHref = (rawHref.startsWith("http://") || rawHref.startsWith("https://")) ? rawHref : (new URL(rawHref, new URL(src))).toString();
                cssRegistry[c.id] = cssRegistry[c.id] || [];
                if (!cssRegistry[c.id].includes(absHref)) cssRegistry[c.id].push(absHref);
                if (!imgAssests.includes(absHref)) imgAssests.push(absHref);
            }

            files.push({
                name: "OEBPS/" + truncate(c.id),
                input: fixXhtml(idToMetaId[c.id] || c.id, src, chapter.html, imgAssests, cssRegistry[c.id] || [])
            });
            fetched += 1;
            const acc = downloadElem.querySelector("span#chapAcc");
            if (acc) acc.innerHTML = ` ${fetched}/${totComp}`;
        }

        downloadElem.innerHTML += `Downloading assets <span id="assetGath"> 0/${imgAssests.length} </span><br>`
        downloadElem.scrollTo(0, downloadElem.scrollHeight);

        // Download assets with bounded concurrency and retries. Firing off
        // hundreds of requests at once can get throttled (HTTP 429) by the
        // CDN, and a single failed fetch used to mean a broken image/asset
        // with no second chance.
        const ASSET_CONCURRENCY = 6;
        const ASSET_MAX_ATTEMPTS = 3;
        async function fetchAssetWithRetry(url) {
            let lastError = "unknown error";
            for (let attempt = 1; attempt <= ASSET_MAX_ATTEMPTS; attempt++) {
                try {
                    const response = await fetch(url);
                    if (response.status === 200) return response;
                    lastError = "HTTP " + response.status;
                    // Retry throttling and server errors; other 4xx won't recover.
                    if (response.status !== 429 && response.status < 500) break;
                } catch (e) {
                    lastError = (e && e.message) ? e.message : String(e);
                }
                if (attempt < ASSET_MAX_ATTEMPTS) {
                    await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
                }
            }
            throw new Error(lastError);
        }

        gc = 0;
        const assetQueue = imgAssests.slice();
        async function assetWorker() {
            while (assetQueue.length) {
                const name = assetQueue.shift();
                const url = name.startsWith("http") ? name : location.origin + "/" + name;
                try {
                    const response = await fetchAssetWithRetry(url);
                    const isCss = name.includes(".css") || (response.headers.get("content-type") || "").includes("text/css");
                    if (isCss) {
                        let cssText = await response.text();
                        const urlRegex = /url\(\s*["']?([^"'\)]+)["']?\s*\)/g;
                        const matches = Array.from(cssText.matchAll(urlRegex));
                        for (let m of matches) {
                            const fullMatch = m[0];
                            const ref = m[1].trim();
                            if (ref.startsWith("data:")) continue;
                            const absRef = (new URL(ref, new URL(url))).toString();
                            if (!imgAssests.includes(absRef)) {
                                imgAssests.push(absRef);
                                assetQueue.push(absRef);
                            }
                            const localName = getFilenameFromURL(absRef);
                            cssText = cssText.replaceAll(fullMatch, "url('" + localName + "')");
                        }
                        files.push({
                            name: "OEBPS/" + (name.startsWith("http") ? getFilenameFromURL(name) : name),
                            input: cssText
                        });
                    } else {
                        const blob = await response.blob();
                        files.push({
                            name: "OEBPS/" + (name.startsWith("http") ? getFilenameFromURL(name) : name),
                            input: blob
                        });
                    }
                } catch (e) {
                    downloadElem.innerHTML += `<b>WARNING:</b> Could not fetch ${name} (${e.message})<br>`
                    downloadElem.scrollTo(0, downloadElem.scrollHeight);
                }
                gc += 1;
                const assetSpan = downloadElem.querySelector("span#assetGath");
                if (assetSpan) assetSpan.innerHTML = ` ${gc}/${imgAssests.length} `;
            }
        }
        await Promise.all(
            Array.from({length: Math.min(ASSET_CONCURRENCY, assetQueue.length)}, assetWorker)
        );
    }
    function enforceEpubXHTML(metaId, url, htmlString, assetRegistry, links) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlString, 'text/html');
        const bod = doc.querySelector("body");
        if (bod){
            bod.setAttribute("id", metaId);
        }

        // Remove <base> tags: EPUB forbids them and they break relative resource paths
        doc.querySelectorAll("base").forEach(b => b.remove());

        // Rewrite existing stylesheet links in the shell head to local OEBPS files
        doc.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
            const href = link.getAttribute("href");
            if (href) {
                link.setAttribute("href", truncate(href));
            }
        });

        let imgFound = 0;
        const imgElements = doc.querySelectorAll("img, image");
        for (let el of imgElements) {
            let src = el.getAttribute("src") || el.getAttribute("xlink:href");
            if (!src) continue;
            imgFound++;

            if (!(src.startsWith("http://") || src.startsWith("https://"))){
                src = (new URL(src, new URL(url))).toString();
            }
            if (!assetRegistry.includes(src))
                assetRegistry.push(src);

            if (el.getAttribute("src"))
                el.setAttribute("src", truncate(src));
            if (el.getAttribute("xlink:href"))
                el.setAttribute("xlink:href", truncate(src));
        }
        if (imgFound > 0) console.log(`LibreGRAB: ${metaId}: found ${imgFound} images`);


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
            const tr = truncate(src);
            const exists = Array.from(head.querySelectorAll('link[rel="stylesheet"]'))
                .some(l => l.getAttribute("href") === tr);
            if (!exists) {
                let linkElement = doc.createElement('link');
                linkElement.setAttribute("href", tr);
                linkElement.setAttribute("rel", "stylesheet");
                linkElement.setAttribute("type", "text/css");
                head.appendChild(linkElement);
            }
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
            xhtml: 'application/xhtml+xml',
            css: 'text/css',
            json: 'application/json',
            otf: 'font/otf',
            ttf: 'font/ttf',
            woff: 'font/woff',
            woff2: 'font/woff2',
            svg: 'image/svg+xml',
            ncx: 'application/x-dtbncx+xml',
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

        let isFixedLayout = false;
        let originalResolution = null;
        for (const f of files) {
            if (typeof f.input === "string" && /\.(xhtml|html)$/.test(f.name)) {
                const vpMatch = f.input.match(/<meta[^>]*name=["']viewport["'][^>]*content=["']([^"']+)["']/i);
                if (vpMatch) {
                    isFixedLayout = true;
                    const wMatch = vpMatch[1].match(/width\s*=\s*([0-9]+(?:\.[0-9]+)?)/i);
                    const hMatch = vpMatch[1].match(/height\s*=\s*([0-9]+(?:\.[0-9]+)?)/i);
                    if (wMatch && hMatch) {
                        originalResolution = `${Math.round(parseFloat(wMatch[1]))}x${Math.round(parseFloat(hMatch[1]))}`;
                    }
                    break;
                }
            }
        }

        // Step 2: Set attributes for the root element
        const packageElement = doc.documentElement;
        packageElement.setAttribute('version', isFixedLayout ? '3.0' : '2.0');
        packageElement.setAttribute('xml:lang', 'en');
        packageElement.setAttribute('unique-identifier', 'pub-identifier');
        packageElement.setAttribute('xmlns', 'http://www.idpf.org/2007/opf');
        packageElement.setAttribute('xmlns:dc', 'http://purl.org/dc/elements/1.1/');
        packageElement.setAttribute('xmlns:dcterms', 'http://purl.org/dc/terms/');
        packageElement.setAttribute('xmlns:xsi', 'http://www.w3.org/2001/XMLSchema-instance');
        if (isFixedLayout) {
            packageElement.setAttribute('prefix', 'rendition: http://www.idpf.org/vocab/rendition/# ibooks: http://vocabulary.itunes.apple.com/rdf/ibooks/vocabulary-extensions-1.0/');
        }

        // Step 3: Create and append child elements to the root
        const metadata = doc.createElementNS('http://www.idpf.org/2007/opf', 'metadata');
        packageElement.appendChild(metadata);

        // Create child elements for metadata
        const dcIdentifier = doc.createElementNS('http://purl.org/dc/elements/1.1/', 'dc:identifier');
        dcIdentifier.setAttribute('id', 'pub-identifier');
        dcIdentifier.textContent = "" + BIF.map["-odread-buid"];
        metadata.appendChild(dcIdentifier);

        // Language
        if (BIF.map.language){
            const dcLanguage = doc.createElementNS('http://purl.org/dc/elements/1.1/', 'dc:language');
            dcLanguage.setAttribute('xsi:type', 'dcterms:RFC4646');
            let lang = Array.isArray(BIF.map.language) ? BIF.map.language[0] : (BIF.map.language || "en");
            dcLanguage.textContent = lang;
            packageElement.setAttribute('xml:lang', lang);
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

        if (isFixedLayout) {
            const metaRenditionLayout = doc.createElementNS('http://www.idpf.org/2007/opf', 'meta');
            metaRenditionLayout.setAttribute('property', 'rendition:layout');
            metaRenditionLayout.textContent = 'pre-paginated';
            metadata.appendChild(metaRenditionLayout);

            const metaRenditionOrientation = doc.createElementNS('http://www.idpf.org/2007/opf', 'meta');
            metaRenditionOrientation.setAttribute('property', 'rendition:orientation');
            metaRenditionOrientation.textContent = 'auto';
            metadata.appendChild(metaRenditionOrientation);

            const metaRenditionSpread = doc.createElementNS('http://www.idpf.org/2007/opf', 'meta');
            metaRenditionSpread.setAttribute('property', 'rendition:spread');
            metaRenditionSpread.textContent = 'auto';
            metadata.appendChild(metaRenditionSpread);

            const metaIbooksFonts = doc.createElementNS('http://www.idpf.org/2007/opf', 'meta');
            metaIbooksFonts.setAttribute('property', 'ibooks:specified-fonts');
            metaIbooksFonts.textContent = 'true';
            metadata.appendChild(metaIbooksFonts);

            const metaModified = doc.createElementNS('http://www.idpf.org/2007/opf', 'meta');
            metaModified.setAttribute('property', 'dcterms:modified');
            metaModified.textContent = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
            metadata.appendChild(metaModified);

            const metaFixedLayout = doc.createElementNS('http://www.idpf.org/2007/opf', 'meta');
            metaFixedLayout.setAttribute('name', 'fixed-layout');
            metaFixedLayout.setAttribute('content', 'true');
            metadata.appendChild(metaFixedLayout);

            if (originalResolution) {
                const metaOriginalRes = doc.createElementNS('http://www.idpf.org/2007/opf', 'meta');
                metaOriginalRes.setAttribute('name', 'original-resolution');
                metaOriginalRes.setAttribute('content', originalResolution);
                metadata.appendChild(metaOriginalRes);
            }
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

        if (isFixedLayout) {
            const navItem = doc.createElementNS('http://www.idpf.org/2007/opf', 'item');
            navItem.setAttribute('id', 'nav');
            navItem.setAttribute('href', 'nav.xhtml');
            navItem.setAttribute('media-type', 'application/xhtml+xml');
            navItem.setAttribute('properties', 'nav');
            manifest.appendChild(navItem);
        }

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
            if (isFixedLayout) {
                itemref.setAttribute('properties', 'rendition:layout-pre-paginated');
            }
            spine.appendChild(itemref);
        });

        // Identify the cover image so readers pick the right thumbnail
        // (without cover metadata, they guess — sometimes wrongly).
        function imgSrcOf(html, onlyDocCover) {
            const tag = html.match(onlyDocCover
                ? /<img[^>]*role=["']doc-cover["'][^>]*>/i
                : /<img[^>]*>/i);
            if (!tag) return null;
            const src = tag[0].match(/src=["']([^"']+)["']/i);
            return src ? src[1] : null;
        }
        function isChapterFile(f) {
            return typeof f.input === "string" && /\.(xhtml|html)$/.test(f.name);
        }
        let coverHref = null;
        // An image explicitly marked as the cover wins, wherever it is.
        for (const f of files) {
            if (!isChapterFile(f)) continue;
            coverHref = imgSrcOf(f.input, true);
            if (coverHref) break;
        }
        // Otherwise, the first image of the first spine chapter
        // (chapter files are pushed in spine order).
        if (!coverHref) {
            const firstChapter = files.find(isChapterFile);
            if (firstChapter) coverHref = imgSrcOf(firstChapter.input, false);
        }
        let coverId = null;

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
            if (coverHref && aname === coverHref) {
                item.setAttribute('properties', 'cover-image'); // EPUB 3 cover
                coverId = id;
            }
            manifest.appendChild(item);
        });

        if (coverId) {
            const coverMeta = doc.createElementNS('http://www.idpf.org/2007/opf', 'meta');
            coverMeta.setAttribute('name', 'cover'); // EPUB 2 cover
            coverMeta.setAttribute('content', coverId);
            metadata.appendChild(coverMeta);
        }

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

        if (files.some(f => typeof f.input === "string" && /<meta[^>]*name=["']viewport/i.test(f.input))) {
            let navOl = '';
            components.forEach(chapter => {
                const path = truncate(chapter.meta.path);
                const label = chapter.meta.title || BIF.map.title.main;
                navOl += `        <li><a href="${path}">${label}</a></li>\n`;
            });
            const navDoc = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
    <title>${BIF.map.title.main}</title>
</head>
<body>
    <nav epub:type="toc" id="toc">
        <h1>Table of Contents</h1>
        <ol>
${navOl}        </ol>
    </nav>
</body>
</html>`;
            files.push({
                name: "OEBPS/nav.xhtml",
                input: navDoc
            });
        }
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

        const isFixedLayout = files.some(f => typeof f.input === "string" && /<meta[^>]*name=["']viewport/i.test(f.input));
        if (isFixedLayout) {
            files.push({
                name: "META-INF/com.apple.ibooks.display-options.xml",
                input: `<?xml version="1.0" encoding="UTF-8"?>
<display_options>
    <platform name="*">
        <option name="fixed-layout">true</option>
        <option name="specified-fonts">true</option>
    </platform>
</display_options>
`
            });
        }

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
    let intr = setInterval(()=>{
        if (window.BIF != undefined && document.querySelector(".nav-progress-bar") != undefined){
            clearInterval(intr);
            BIF = window.BIF;
            const hostParts = location.hostname.split(".");
            let mode = null;
            if (hostParts.includes("listen") || (window.BIF && window.BIF.objects && window.BIF.objects.spool)) {
                mode = "listen";
            } else if (hostParts.includes("read") || (window.BIF && window.BIF.objects && window.BIF.objects.reader)) {
                mode = "read";
            }
            if (mode == "listen"){
                bifFoundAudiobook();
            } else if (mode == "read"){
                bifFoundBook();
            }
        }
    }, 25);
    }

    function injectPageScript(code) {
        const script = document.createElement('script');
        script.textContent = code;
        (document.documentElement || document.head || document.body).appendChild(script);
        script.remove();
    }

    injectPageScript(`${clientZipReadyCode}(${mainCode.toString()})();`);

    fetch('https://unpkg.com/client-zip@2.5.0/worker.js')
        .then(r => r.text())
        .then(clientZipCode => {
            injectPageScript(clientZipCode + ';\nwindow.__libregrabResolveClientZip?.(window.downloadZip);');
        })
        .catch(error => {
            console.error('LibreGRAB: failed to load client-zip', error);
            injectPageScript('window.__libregrabRejectClientZip?.(new Error("client-zip failed to load"));');
        });
})();
