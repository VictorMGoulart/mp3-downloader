/**
 * YouTube MP3 Downloader Pro - Client Application
 */

// --- 1. Storage Manager (LocalStorage) ---
const StorageManager = {
    STORAGE_KEY: "yt_downloaded_tracks_v1",

    getHistory() {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            console.error("Erro ao ler localStorage:", e);
            return {};
        }
    },

    saveHistory(history) {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(history));
            this.updateBadge();
        } catch (e) {
            console.error("Erro ao salvar no localStorage:", e);
        }
    },

    isDownloaded(id) {
        if (!id) return false;
        const history = this.getHistory();
        return Boolean(history[id]);
    },

    markAsDownloaded(video) {
        if (!video || !video.id) return;
        const history = this.getHistory();
        history[video.id] = {
            id: video.id,
            title: video.title,
            author: video.author,
            downloadedAt: new Date().toISOString(),
        };
        this.saveHistory(history);
    },

    removeTrack(id) {
        const history = this.getHistory();
        delete history[id];
        this.saveHistory(history);
    },

    clearAll() {
        localStorage.removeItem(this.STORAGE_KEY);
        this.updateBadge();
    },

    getCount() {
        return Object.keys(this.getHistory()).length;
    },

    updateBadge() {
        const badge = document.getElementById("historyCountBadge");
        if (badge) {
            badge.textContent = this.getCount();
        }
    },
};

// --- 2. Application State ---
const state = {
    currentVideos: [],
    selectedIds: new Set(),
    activeJobId: null,
    eventSource: null,
};

// --- 3. DOM Elements ---
const DOM = {
    playlistForm: document.getElementById("playlistForm"),
    playlistUrl: document.getElementById("playlistUrl"),
    btnPaste: document.getElementById("btnPaste"),
    customZipName: document.getElementById("customZipName"),
    btnFetchPlaylist: document.getElementById("btnFetchPlaylist"),
    feedbackBanner: document.getElementById("feedbackBanner"),
    resultsSection: document.getElementById("resultsSection"),
    trackListBody: document.getElementById("trackListBody"),
    totalPill: document.getElementById("totalPill"),
    selectedPill: document.getElementById("selectedPill"),
    downloadedPill: document.getElementById("downloadedPill"),
    trackSearchInput: document.getElementById("trackSearchInput"),
    btnSelectNew: document.getElementById("btnSelectNew"),
    btnSelectAll: document.getElementById("btnSelectAll"),
    btnDeselectAll: document.getElementById("btnDeselectAll"),
    btnDownloadSelected: document.getElementById("btnDownloadSelected"),
    btnSelectedCount: document.getElementById("btnSelectedCount"),
    masterCheckbox: document.getElementById("masterCheckbox"),
    cookiesIndicator: document.getElementById("cookiesIndicator"),
    btnMarkSelectedAsDownloaded: document.getElementById("btnMarkSelectedAsDownloaded"),
    btnMarkAllAsDownloaded: document.getElementById("btnMarkAllAsDownloaded"),
    // Progress Modal
    progressModal: document.getElementById("progressModal"),
    progressStepPill: document.getElementById("progressStepPill"),
    progressCurrentTrack: document.getElementById("progressCurrentTrack"),
    progressOverallPercent: document.getElementById("progressOverallPercent"),
    progressBarFill: document.getElementById("progressBarFill"),
    progressCounter: document.getElementById("progressCounter"),
    progressItemStatus: document.getElementById("progressItemStatus"),
    logTerminal: document.getElementById("logTerminal"),
    progressCompleteActions: document.getElementById("progressCompleteActions"),
    btnCloseProgressModal: document.getElementById("btnCloseProgressModal"),
    // History Modal
    historyModal: document.getElementById("historyModal"),
    btnOpenHistory: document.getElementById("btnOpenHistory"),
    btnCloseHistory: document.getElementById("btnCloseHistory"),
    btnCloseHistoryFooter: document.getElementById("btnCloseHistoryFooter"),
    btnClearAllHistory: document.getElementById("btnClearAllHistory"),
    historyListContainer: document.getElementById("historyListContainer"),
};

// --- 4. Initialization ---
document.addEventListener("DOMContentLoaded", () => {
    StorageManager.updateBadge();
    checkServerStatus();
    setupEventListeners();
});

function setupEventListeners() {
    // Paste button
    DOM.btnPaste.addEventListener("click", async () => {
        try {
            const text = await navigator.clipboard.readText();
            if (text) {
                DOM.playlistUrl.value = text.trim();
                DOM.playlistUrl.focus();
            }
        } catch (err) {
            console.warn("Não foi possível acessar a área de transferência", err);
        }
    });

    // Form submit
    DOM.playlistForm.addEventListener("submit", handleFetchPlaylist);

    // Filter input
    DOM.trackSearchInput.addEventListener("input", handleSearchFilter);

    // Selection buttons
    DOM.btnSelectNew.addEventListener("click", selectOnlyNew);
    DOM.btnSelectAll.addEventListener("click", selectAll);
    DOM.btnDeselectAll.addEventListener("click", deselectAll);
    DOM.masterCheckbox.addEventListener("change", handleMasterCheckboxToggle);
    DOM.btnMarkSelectedAsDownloaded.addEventListener("click", markSelectedAsDownloaded);
    DOM.btnMarkAllAsDownloaded.addEventListener("click", markAllAsDownloaded);

    // Download button
    DOM.btnDownloadSelected.addEventListener("click", handleStartDownload);

    // Progress Modal close
    DOM.btnCloseProgressModal.addEventListener("click", () => {
        DOM.progressModal.classList.add("hidden");
    });

    // History Modal handlers
    DOM.btnOpenHistory.addEventListener("click", openHistoryModal);
    DOM.btnCloseHistory.addEventListener("click", closeHistoryModal);
    DOM.btnCloseHistoryFooter.addEventListener("click", closeHistoryModal);
    DOM.btnClearAllHistory.addEventListener("click", handleClearAllHistory);
}

// --- 5. Status & API Calls ---
async function checkServerStatus() {
    try {
        await fetch("/api/status");
    } catch {
        // Server might be offline
    }
}

function showBanner(message, type = "error") {
    DOM.feedbackBanner.className = `feedback-banner ${type}`;
    DOM.feedbackBanner.textContent = message;
    DOM.feedbackBanner.classList.remove("hidden");
}

function hideBanner() {
    DOM.feedbackBanner.classList.add("hidden");
}

function setFetchLoading(isLoading) {
    const spinner = DOM.btnFetchPlaylist.querySelector(".spinner");
    const text = DOM.btnFetchPlaylist.querySelector(".btn-text");

    if (isLoading) {
        spinner.classList.remove("hidden");
        text.textContent = "Extraindo Playlist...";
        DOM.btnFetchPlaylist.disabled = true;
    } else {
        spinner.classList.add("hidden");
        text.textContent = "Listar Músicas";
        DOM.btnFetchPlaylist.disabled = false;
    }
}

// --- 6. Playlist Extraction & Rendering ---
async function handleFetchPlaylist(e) {
    e.preventDefault();
    hideBanner();

    const url = DOM.playlistUrl.value.trim();
    if (!url) return;

    setFetchLoading(true);

    try {
        const response = await fetch("/api/playlist", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url }),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Falha ao buscar a playlist.");
        }

        console.log("=== [yt-dlp Response JSON] ===", data);
        if (data.videos) {
            console.log("=== [yt-dlp Videos Info] ===", data.videos);
        }

        state.currentVideos = data.videos || [];
        renderTrackList();
        DOM.resultsSection.classList.remove("hidden");

        // Scroll smoothly to results
        DOM.resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
        showBanner(err.message, "error");
    } finally {
        setFetchLoading(false);
    }
}

function renderTrackList() {
    DOM.trackListBody.innerHTML = "";
    state.selectedIds.clear();

    let downloadedCount = 0;

    state.currentVideos.forEach((video) => {
        const isDownloaded = StorageManager.isDownloaded(video.id);

        if (isDownloaded) {
            downloadedCount++;
        } else {
            // New songs are selected by default
            state.selectedIds.add(video.id);
        }

        const tr = document.createElement("tr");
        tr.className = `track-row ${!isDownloaded ? "selected" : ""}`;
        tr.dataset.id = video.id;

        tr.innerHTML = `
            <td class="col-check">
                <input type="checkbox" class="track-checkbox" ${!isDownloaded ? "checked" : ""} data-id="${video.id}">
            </td>
            <td class="col-thumb">
                <a href="${video.url}" target="_blank" rel="noopener noreferrer" class="thumb-wrapper" title="Ouvir no YouTube">
                    <img src="${video.thumbnail || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='68' height='44' fill='%23222'%3E%3Crect width='100%25' height='100%25'/%3E%3C/svg%3E"}" alt="Capa" loading="lazy">
                </a>
            </td>
            <td class="col-title">
                <div class="editable-cell-wrapper">
                    <input type="text" class="cell-transparent-input input-track-title" value="${escapeHtml(video.title || "")}" data-id="${video.id}" placeholder="Título da música" title="Clique para editar o título">
                    <a href="${video.url}" target="_blank" rel="noopener noreferrer" class="track-link-icon" title="Ouvir no YouTube">
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                            <polyline points="15 3 21 3 21 9"></polyline>
                            <line x1="10" y1="14" x2="21" y2="3"></line>
                        </svg>
                    </a>
                </div>
            </td>
            <td class="col-artist">
                <div class="editable-cell-wrapper">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" class="artist-icon-prefix">
                        <circle cx="12" cy="7" r="4"></circle>
                        <path d="M5.5 21a6.5 6.5 0 0 1 13 0"></path>
                    </svg>
                    <input type="text" class="cell-transparent-input input-track-artist" value="${escapeHtml(video.author || "")}" data-id="${video.id}" placeholder="Artista" title="Clique para editar o artista">
                </div>
            </td>
            <td class="col-album">
                <div class="editable-cell-wrapper">
                    <input type="text" class="cell-transparent-input input-track-album" value="${escapeHtml(video.rawAlbum || "")}" data-id="${video.id}" placeholder="Álbum (opcional)" title="Clique para editar o álbum">
                </div>
            </td>
            <td class="col-status">
                ${
                    isDownloaded
                        ? `<span class="badge-downloaded clickable" title="Clique para desmarcar do histórico (marcar como nova)">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                            Já baixada
                           </span>`
                        : `<span class="badge-new clickable" title="Clique para salvar como já baixada no histórico">Nova</span>`
                }
            </td>
        `;

        // Direct input binding for real-time edits
        const inputTitle = tr.querySelector(".input-track-title");
        const inputArtist = tr.querySelector(".input-track-artist");
        const inputAlbum = tr.querySelector(".input-track-album");

        inputTitle.addEventListener("input", (e) => {
            video.title = e.target.value;
        });
        inputTitle.addEventListener("blur", (e) => {
            video.title = e.target.value.trim();
            e.target.value = video.title;
        });

        inputArtist.addEventListener("input", (e) => {
            video.author = e.target.value;
        });
        inputArtist.addEventListener("blur", (e) => {
            video.author = e.target.value.trim();
            e.target.value = video.author;
        });

        inputAlbum.addEventListener("input", (e) => {
            video.rawAlbum = e.target.value;
        });
        inputAlbum.addEventListener("blur", (e) => {
            video.rawAlbum = e.target.value.trim();
            e.target.value = video.rawAlbum;
        });

        [inputTitle, inputArtist, inputAlbum].forEach((input) => {
            input.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    input.blur();
                }
            });
            input.addEventListener("click", (e) => {
                e.stopPropagation();
            });
        });

        // Status badge click (toggle downloaded status directly)
        const badge = tr.querySelector(".clickable");
        if (badge) {
            badge.addEventListener("click", (e) => {
                e.stopPropagation();
                toggleTrackDownloaded(video, tr);
            });
        }

        // Checkbox click listener
        const checkbox = tr.querySelector(".track-checkbox");
        checkbox.addEventListener("change", (e) => {
            handleRowToggle(video.id, e.target.checked, tr);
        });

        // Row click (toggle checkbox if clicking on row outside inputs/links)
        tr.addEventListener("click", (e) => {
            if (
                e.target.tagName !== "INPUT" &&
                e.target.tagName !== "BUTTON" &&
                e.target.tagName !== "A" &&
                !e.target.closest("a") &&
                !e.target.classList.contains("clickable")
            ) {
                checkbox.checked = !checkbox.checked;
                handleRowToggle(video.id, checkbox.checked, tr);
            }
        });

        DOM.trackListBody.appendChild(tr);
    });

    updateCounters(downloadedCount);
}

function handleRowToggle(id, isChecked, rowElement) {
    if (isChecked) {
        state.selectedIds.add(id);
        rowElement.classList.add("selected");
    } else {
        state.selectedIds.delete(id);
        rowElement.classList.remove("selected");
    }
    updateSelectionCounter();
}

function updateCounters(downloadedCount) {
    const total = state.currentVideos.length;
    DOM.totalPill.innerHTML = `Total: <strong>${total}</strong>`;
    DOM.downloadedPill.innerHTML = `Já Baixadas: <strong>${downloadedCount}</strong>`;
    updateSelectionCounter();
}

function toggleTrackDownloaded(video, rowElement) {
    const isDownloaded = StorageManager.isDownloaded(video.id);
    const checkbox = rowElement.querySelector(".track-checkbox");
    const statusCell = rowElement.querySelector(".col-status");

    if (isDownloaded) {
        // Unmark from history (now it's "Nova")
        StorageManager.removeTrack(video.id);
        checkbox.checked = true;
        state.selectedIds.add(video.id);
        rowElement.classList.add("selected");
        statusCell.innerHTML = `<span class="badge-new clickable" title="Clique para salvar como já baixada no histórico">Nova</span>`;
    } else {
        // Mark as downloaded
        StorageManager.markAsDownloaded(video);
        checkbox.checked = false;
        state.selectedIds.delete(video.id);
        rowElement.classList.remove("selected");
        statusCell.innerHTML = `
            <span class="badge-downloaded clickable" title="Clique para desmarcar do histórico (marcar como nova)">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                Já baixada
            </span>
        `;
    }

    // Reattach click listener to newly rendered badge
    statusCell.querySelector(".clickable").addEventListener("click", (e) => {
        e.stopPropagation();
        toggleTrackDownloaded(video, rowElement);
    });

    // Update counters
    let downloadedCount = 0;
    state.currentVideos.forEach((v) => {
        if (StorageManager.isDownloaded(v.id)) downloadedCount++;
    });
    updateCounters(downloadedCount);
}

function markSelectedAsDownloaded() {
    if (state.selectedIds.size === 0) {
        showBanner("Selecione pelo menos uma música para marcar como já baixada.", "error");
        return;
    }

    const count = state.selectedIds.size;
    const selectedVideos = state.currentVideos.filter((v) => state.selectedIds.has(v.id));

    selectedVideos.forEach((video) => {
        StorageManager.markAsDownloaded(video);
        const row = document.querySelector(`.track-row[data-id="${video.id}"]`);
        if (row) {
            const checkbox = row.querySelector(".track-checkbox");
            checkbox.checked = false;
            row.classList.remove("selected");

            const statusCell = row.querySelector(".col-status");
            statusCell.innerHTML = `
                <span class="badge-downloaded clickable" title="Clique para desmarcar do histórico (marcar como nova)">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                    Já baixada
                </span>
            `;

            statusCell.querySelector(".clickable").addEventListener("click", (e) => {
                e.stopPropagation();
                toggleTrackDownloaded(video, row);
            });
        }
    });

    state.selectedIds.clear();

    let downloadedCount = 0;
    state.currentVideos.forEach((v) => {
        if (StorageManager.isDownloaded(v.id)) downloadedCount++;
    });
    updateCounters(downloadedCount);

    showBanner(`✅ ${count} música(s) marcada(s) como já baixada(s)!`, "success");
}

function markAllAsDownloaded() {
    if (!state.currentVideos || state.currentVideos.length === 0) return;

    state.currentVideos.forEach((video) => {
        StorageManager.markAsDownloaded(video);
    });

    renderTrackList();
    showBanner("✅ Todas as músicas da playlist foram marcadas como já baixadas!", "success");
}

function updateSelectionCounter() {
    const selected = state.selectedIds.size;
    DOM.selectedPill.innerHTML = `Selecionadas: <strong>${selected}</strong>`;
    DOM.btnSelectedCount.textContent = selected;
    DOM.btnDownloadSelected.disabled = selected === 0;

    // Sync master checkbox
    const visibleCheckboxes = document.querySelectorAll(".track-row:not(.hidden) .track-checkbox");
    if (visibleCheckboxes.length > 0) {
        const allChecked = Array.from(visibleCheckboxes).every((cb) => cb.checked);
        DOM.masterCheckbox.checked = allChecked;
    }
}

// --- 7. Bulk Selection Actions ---
function selectOnlyNew() {
    state.selectedIds.clear();
    const rows = document.querySelectorAll(".track-row");

    rows.forEach((row) => {
        const id = row.dataset.id;
        const isDownloaded = StorageManager.isDownloaded(id);
        const checkbox = row.querySelector(".track-checkbox");

        if (!isDownloaded) {
            checkbox.checked = true;
            state.selectedIds.add(id);
            row.classList.add("selected");
        } else {
            checkbox.checked = false;
            row.classList.remove("selected");
        }
    });

    updateSelectionCounter();
}

function selectAll() {
    state.selectedIds.clear();
    const rows = document.querySelectorAll(".track-row:not(.hidden)");

    rows.forEach((row) => {
        const id = row.dataset.id;
        const checkbox = row.querySelector(".track-checkbox");
        checkbox.checked = true;
        state.selectedIds.add(id);
        row.classList.add("selected");
    });

    updateSelectionCounter();
}

function deselectAll() {
    state.selectedIds.clear();
    const rows = document.querySelectorAll(".track-row");

    rows.forEach((row) => {
        const checkbox = row.querySelector(".track-checkbox");
        checkbox.checked = false;
        row.classList.remove("selected");
    });

    updateSelectionCounter();
}

function handleMasterCheckboxToggle(e) {
    if (e.target.checked) {
        selectAll();
    } else {
        deselectAll();
    }
}

function handleSearchFilter(e) {
    const query = e.target.value.toLowerCase().trim();
    const rows = document.querySelectorAll(".track-row");

    rows.forEach((row) => {
        const titleInput = row.querySelector(".input-track-title");
        const artistInput = row.querySelector(".input-track-artist");
        const albumInput = row.querySelector(".input-track-album");

        const title = (titleInput ? titleInput.value : "").toLowerCase();
        const artist = (artistInput ? artistInput.value : "").toLowerCase();
        const album = (albumInput ? albumInput.value : "").toLowerCase();

        if (!query || title.includes(query) || artist.includes(query) || album.includes(query)) {
            row.classList.remove("hidden");
        } else {
            row.classList.add("hidden");
        }
    });

    updateSelectionCounter();
}

// --- 8. Download Flow with SSE Progress ---
async function handleStartDownload() {
    if (state.selectedIds.size === 0) return;

    const selectedVideos = state.currentVideos.filter((v) => state.selectedIds.has(v.id));
    const customZip = DOM.customZipName.value.trim() || undefined;

    // Open progress modal
    DOM.progressModal.classList.remove("hidden");
    DOM.progressCompleteActions.classList.add("hidden");
    DOM.progressBarFill.style.width = "0%";
    DOM.progressOverallPercent.textContent = "0%";
    DOM.progressCurrentTrack.textContent = "Solicitando início do download...";
    DOM.progressCounter.textContent = `0 de ${selectedVideos.length}`;
    DOM.logTerminal.innerHTML = "";
    addLog(`Iniciando download de ${selectedVideos.length} músicas selecionadas...`);

    try {
        const response = await fetch("/api/download", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                videos: selectedVideos,
                zipName: customZip,
            }),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Falha ao iniciar processamento.");
        }

        state.activeJobId = data.jobId;
        connectSSEProgress(data.jobId, selectedVideos);
    } catch (err) {
        addLog(`Erro: ${err.message}`, "error");
        DOM.progressCurrentTrack.textContent = "Falha ao iniciar processo";
    }
}

function connectSSEProgress(jobId, selectedVideos) {
    if (state.eventSource) {
        state.eventSource.close();
    }

    const eventSource = new EventSource(`/api/progress/${jobId}`);
    state.eventSource = eventSource;

    eventSource.onmessage = (e) => {
        try {
            const data = JSON.parse(e.data);
            handleProgressUpdate(data, selectedVideos);
        } catch (err) {
            console.error("Erro ao decodificar SSE:", err);
        }
    };

    eventSource.onerror = () => {
        console.warn("Conexão SSE encerrada ou instável.");
    };
}

function handleProgressUpdate(data, selectedVideos) {
    if (data.message) {
        addLog(data.message);
    }

    if (data.status === "downloading") {
        DOM.progressStepPill.textContent = "Baixando";
        DOM.progressStepPill.className = "pill pill-selected";

        const currentIdx = data.currentIndex || 1;
        const total = data.totalCount || selectedVideos.length;
        const overallPercent = Math.round(((currentIdx - 1) / total) * 100 + (data.percent || 0) / total);

        DOM.progressBarFill.style.width = `${overallPercent}%`;
        DOM.progressOverallPercent.textContent = `${overallPercent}%`;
        DOM.progressCounter.textContent = `Música ${currentIdx} de ${total}`;

        if (data.currentVideo) {
            DOM.progressCurrentTrack.textContent = `${data.currentVideo.author} - ${data.currentVideo.title}`;
        }
    } else if (data.status === "zipping") {
        DOM.progressStepPill.textContent = "Compactando";
        DOM.progressStepPill.className = "pill pill-history";
        DOM.progressCurrentTrack.textContent = "Gerando arquivo ZIP final...";
        DOM.progressBarFill.style.width = "98%";
        DOM.progressOverallPercent.textContent = "98%";
    } else if (data.status === "completed") {
        DOM.progressStepPill.textContent = "Concluído";
        DOM.progressStepPill.className = "pill pill-history";
        DOM.progressBarFill.style.width = "100%";
        DOM.progressOverallPercent.textContent = "100%";
        DOM.progressCurrentTrack.textContent = "Download pronto!";
        DOM.progressCompleteActions.classList.remove("hidden");

        addLog("✅ Sucesso! Todas as músicas foram baixadas e compactadas.", "success");

        // Mark downloaded tracks in LocalStorage
        selectedVideos.forEach((v) => {
            StorageManager.markAsDownloaded(v);
        });

        // Update list status to show "Já baixada" and uncheck them
        updateListAfterDownload(selectedVideos);

        // Close SSE
        if (state.eventSource) {
            state.eventSource.close();
            state.eventSource = null;
        }

        // Trigger automatic ZIP download in the browser
        if (data.downloadUrl) {
            triggerBrowserDownload(data.downloadUrl);
        }
    } else if (data.status === "error") {
        DOM.progressStepPill.textContent = "Erro";
        DOM.progressStepPill.className = "pill pill-danger";
        addLog(`Erro: ${data.message || "Falha durante o download."}`, "error");

        if (state.eventSource) {
            state.eventSource.close();
            state.eventSource = null;
        }
    }
}

function updateListAfterDownload(downloadedVideos) {
    downloadedVideos.forEach((video) => {
        const row = document.querySelector(`.track-row[data-id="${video.id}"]`);
        if (row) {
            const checkbox = row.querySelector(".track-checkbox");
            checkbox.checked = false;
            row.classList.remove("selected");
            state.selectedIds.delete(video.id);

            const statusCell = row.querySelector(".col-status");
            statusCell.innerHTML = `
                <span class="badge-downloaded">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                    Já baixada
                </span>
            `;
        }
    });

    let downloadedCount = 0;
    state.currentVideos.forEach((v) => {
        if (StorageManager.isDownloaded(v.id)) downloadedCount++;
    });

    updateCounters(downloadedCount);
}

function triggerBrowserDownload(url) {
    const a = document.createElement("a");
    a.href = url;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    addLog("Iniciando transferência do arquivo ZIP no seu navegador...", "success");
}

function addLog(text, type = "normal") {
    const line = document.createElement("div");
    line.className = `log-line ${type === "success" ? "log-success" : type === "error" ? "log-warning" : ""}`;
    const time = new Date().toLocaleTimeString();
    line.textContent = `[${time}] ${text}`;
    DOM.logTerminal.appendChild(line);
    DOM.logTerminal.scrollTop = DOM.logTerminal.scrollHeight;
}

// --- 9. History Modal Logic ---
function openHistoryModal() {
    renderHistoryList();
    DOM.historyModal.classList.remove("hidden");
}

function closeHistoryModal() {
    DOM.historyModal.classList.add("hidden");
}

function renderHistoryList() {
    const history = StorageManager.getHistory();
    const items = Object.values(history);
    DOM.historyListContainer.innerHTML = "";

    if (items.length === 0) {
        DOM.historyListContainer.innerHTML = `
            <div class="log-line text-muted" style="text-align: center; padding: 24px;">
                Nenhuma música baixada ainda.
            </div>
        `;
        return;
    }

    // Sort descending by date
    items.sort((a, b) => new Date(b.downloadedAt) - new Date(a.downloadedAt));

    items.forEach((item) => {
        const div = document.createElement("div");
        div.className = "history-item";
        div.innerHTML = `
            <div class="history-info">
                <span class="history-title">${escapeHtml(item.title)}</span>
                <span class="history-artist">${escapeHtml(item.author)}</span>
            </div>
            <button class="btn-remove-history" title="Remover do histórico" data-id="${item.id}">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
            </button>
        `;

        div.querySelector(".btn-remove-history").addEventListener("click", () => {
            StorageManager.removeTrack(item.id);
            renderHistoryList();
            if (state.currentVideos.length > 0) {
                renderTrackList();
            }
        });

        DOM.historyListContainer.appendChild(div);
    });
}

function handleClearAllHistory() {
    if (confirm("Tem certeza que deseja limpar todo o histórico?")) {
        StorageManager.clearAll();
        renderHistoryList();
        if (state.currentVideos.length > 0) {
            renderTrackList();
        }
    }
}

function escapeHtml(str) {
    if (!str) return "";
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
