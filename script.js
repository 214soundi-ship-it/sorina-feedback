let pdfDoc = null;
let pageNum = 1;
let pageRendering = false;
let pageNumPending = null;
let currentScale = 1.0;
let originalFileName = "소리나는피드백";

// Elements
const pdfRenderCanvas = document.getElementById('pdf-render-canvas');
const pdfCtx = pdfRenderCanvas.getContext('2d');
const drawingCanvas = document.getElementById('drawing-canvas');
const drawCtx = drawingCanvas.getContext('2d', { willReadFrequently: true });
const pdfContainer = document.getElementById('pdf-container');
const emptyState = document.querySelector('.empty-state');
const pageControls = document.getElementById('page-controls');
const workspace = document.querySelector('.workspace');

// Declare pauseBtn globally but assign it later to ensure DOM is ready
let pauseBtn; 

// Modals / Buttons
const modeProfBtn = document.getElementById('mode-professor-btn');
const modeLearnBtn = document.getElementById('mode-learner-btn');
const profSidebar = document.getElementById('professor-sidebar');
const learnSidebar = document.getElementById('learner-sidebar');
const profRecordTools = document.getElementById('prof-record-tools');
const profDrawingTools = document.getElementById('prof-drawing-tools');
const learnerPlayerTools = document.getElementById('learner-player-tools');
const exportPackageBtn = document.getElementById('export-package-btn');
const loadFeedbackBtn = document.getElementById('load-feedback-btn');
const downloadZipBtn = document.getElementById('download-zip-btn');
const headerBetaBadge = document.getElementById('header-beta-badge');

// Mode State
let currentMode = 'professor'; // 'professor' | 'learner'
let isLearnerContentLoaded = false; // Isolation flag for professional/learner workspace

// Interactive Data Structure
let feedbackData = {
  version: "1.0",
  strokes: [],
  pages: 1 // For future multi-page support
};

let currentStroke = null;
let strokeIdCounter = 0;

// Recording State
let mediaRecorder;
let audioChunks = [];
let isMicArmed = false;
let isPaused = false;
let totalPausedTime = 0;
let pauseStartTime = 0;
const learnerAudio = document.getElementById('learner-audio');
let recordedAudioBlob = null; // Store pure blob reference for export

// Custom Audio Player Elements
const playPauseBtn = document.getElementById('play-pause-btn');
const audioProgress = document.getElementById('audio-progress');
const currentTimeDisplay = document.getElementById('current-time');
const durationTimeDisplay = document.getElementById('duration-time');
const playbackSpeedSelect = document.getElementById('playback-speed');
const timelineMarkersContainer = document.getElementById('timeline-markers');

// Audio File for Learner
let learnerAudioUrl = null;
let isAudioUnlocked = false; // Flag for iOS Safari Audio Unlock

// Drawing State
let isDrawing = false;
let currentToolType = 'pen'; // 'pen' | 'highlighter' | 'eraser'
let currentStyle = {
  color: '#1c1c1e',
  size: 3
};
let lastX = 0;
let lastY = 0;

// Missing State Variables (CRITICAL FIX)
let isRecording = false;
let startTime = null;
let timerInterval = null;
let isInputBlocked = false; // Flag to prevent accidental strokes during page transitions

// Initialization
document.addEventListener('DOMContentLoaded', () => {
  pauseBtn = document.getElementById('pause-btn'); // Initialize here
  setupModeSwitch();
  setupDrawingTools();
  setupAudio();
  setupLearnerInputs();
  setupWelcomeModal();
  setupResetAction();
  setupLearnerResetAction(); // Add learner reset listener
  
  // Initialize Lucide Icons
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }

  // Handle Resize
  window.addEventListener('resize', debounce(() => {
    if (pdfDoc) renderPage(pageNum);
  }, 300));
});

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Global Unlock: Any first touch/click on window will signal to iOS that audio is desired
const globalUnlock = () => {
  unlockAudio();
  window.removeEventListener('click', globalUnlock);
  window.removeEventListener('touchstart', globalUnlock);
};
window.addEventListener('click', globalUnlock, { once: true });
window.addEventListener('touchstart', globalUnlock, { once: true });

function setupWelcomeModal() {
  const modal = document.getElementById('welcome-modal');
  const closeBtn = document.getElementById('close-modal-btn');
  const startBtn = document.getElementById('start-app-btn');
  const dontShowCheck = document.getElementById('do-not-show-check');

  // Check LocalStorage - Temporarily disabled check to show for user once more
  if (true || localStorage.getItem('sorinaFeedBetaHideWelcome') !== 'true') {
    // Show modal
    setTimeout(() => {
      modal.classList.add('show');
    }, 300); // Slight delay for smooth entrance
  }

  const closeModal = () => {
    modal.classList.remove('show');
    if (dontShowCheck.checked) {
      localStorage.setItem('sorinaFeedBetaHideWelcome', 'true');
    }
  };

  closeBtn.addEventListener('click', () => {
    closeModal();
    unlockAudio(); // Unlock on user interaction
  });
  startBtn.addEventListener('click', () => {
    closeModal();
    unlockAudio(); // Unlock on user interaction
  });
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
      unlockAudio();
    }
  });
}

// iOS Safari Audio Unlock Mechanism
function unlockAudio() {
  if (isAudioUnlocked || !learnerAudio) return;
  
  // Use a tiny 0.1s silent base64 audio to "warm up" the audio context
  // This is more reliable than playing an empty source on iOS
  const silentSrc = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA== ";
  
  const originalSrc = learnerAudio.src;
  const originalTime = learnerAudio.currentTime;

  learnerAudio.src = silentSrc;
  learnerAudio.play().then(() => {
    learnerAudio.pause();
    isAudioUnlocked = true;
    console.log("Audio Unlocked with Silent Buffer");
    
    // Restore original state if it existed
    if (originalSrc && originalSrc !== silentSrc) {
      learnerAudio.src = originalSrc;
      learnerAudio.currentTime = originalTime;
      learnerAudio.load(); 
    }
  }).catch(e => {
    console.warn("Audio unlock attempt failed", e);
  });
}

// Mode Switch
function setupModeSwitch() {
  modeProfBtn.addEventListener('click', () => {
    currentMode = 'professor';
    modeProfBtn.classList.add('active');
    modeLearnBtn.classList.remove('active');
    profSidebar.classList.remove('hidden');
    learnSidebar.classList.add('hidden');
    document.getElementById('prof-empty-action').classList.remove('hidden');
    document.getElementById('learn-empty-action').classList.add('hidden');
    
    // In Professor mode, the container is "empty" only if no PDF is loaded
    if (!pdfDoc) {
      pdfContainer.classList.add('empty');
    } else {
      pdfContainer.classList.remove('empty');
    }
    
    drawingCanvas.style.pointerEvents = 'auto'; // Enable drawing
    renderStrokes(); // Re-render without hit detection highlights
  });

  modeLearnBtn.addEventListener('click', () => {
    currentMode = 'learner';
    modeLearnBtn.classList.add('active');
    modeLearnBtn.classList.remove('glow-btn'); // Remove glow when clicked
    modeProfBtn.classList.remove('active');
    learnSidebar.classList.remove('hidden');
    profSidebar.classList.add('hidden');
    
    // Isolation Control: 
    if (!isLearnerContentLoaded) {
      document.getElementById('learn-empty-action').classList.remove('hidden');
      document.getElementById('prof-empty-action').classList.add('hidden');
      pdfContainer.classList.add('empty'); // This will trigger .empty-state display via CSS
      
      drawingCanvas.style.display = 'none'; 
      pdfRenderCanvas.style.display = 'none'; 
      pageControls.classList.add('hidden');
    } else {
      document.getElementById('learn-empty-action').classList.add('hidden');
      document.getElementById('prof-empty-action').classList.add('hidden');
      pdfContainer.classList.remove('empty'); // Hide empty state
      
      drawingCanvas.style.display = 'block';
      pdfRenderCanvas.style.display = 'block';
      pageControls.classList.remove('hidden');
      renderStrokes(); 
    }
  });
}

function setupResetAction() {
  const newFeedbackBtn = document.getElementById('new-feedback-btn');
  if (newFeedbackBtn) {
    newFeedbackBtn.addEventListener('click', () => {
      if (confirm('모든 기록(PDF, 필기, 음성)을 지우고 새로 시작하시겠습니까?')) {
        resetAppState();
      }
    });
  }
  
  const previewBtn = document.getElementById('preview-mode-btn');
  if (previewBtn) {
    previewBtn.addEventListener('click', () => {
      // Bridge current state to learner mode
      if (recordedAudioBlob) {
        const audioUrl = URL.createObjectURL(recordedAudioBlob);
        learnerAudio.src = audioUrl;
        learnerAudioUrl = audioUrl;
        learnerPlayerTools.classList.remove('disabled');
      }
      
      isLearnerContentLoaded = true; // Temporary flag for local session
      modeLearnBtn.click();
    });
  }
}

function setupLearnerResetAction() {
  const learnerResetBtn = document.getElementById('learner-reset-btn');
  if (learnerResetBtn) {
    learnerResetBtn.addEventListener('click', () => {
      if (confirm('현재 피드백을 닫고 초기 화면으로 돌아가시겠습니까?')) {
        // Use a slight variation of reset that preserves current mode
        resetAppState(true); 
      }
    });
  }
}

function resetAppState(preserveMode = false) {
  // 1. Clear Data
  pdfDoc = null;
  pdfBytes = null;
  feedbackData.strokes = [];
  feedbackData.pages = 1;
  recordedAudioBlob = null;
  learnerAudioUrl = null;
  if (learnerAudio) learnerAudio.src = '';
  pageNum = 1;
  isLearnerContentLoaded = false;

  // 2. Reset UI
  pdfContainer.classList.add('empty');
  pdfRenderCanvas.style.display = 'none';
  drawingCanvas.style.display = 'none';
  pageControls.classList.add('hidden');
  
  // Hide Share Link Card
  const shareContainer = document.getElementById('share-link-container');
  if (shareContainer) {
    shareContainer.classList.add('hidden');
    shareContainer.classList.remove('show');
  }

  // Restore Action Areas based on current mode
  if (currentMode === 'learner' || preserveMode) {
    document.getElementById('prof-empty-action').classList.add('hidden');
    document.getElementById('learn-empty-action').classList.remove('hidden');
  } else {
    document.getElementById('prof-empty-action').classList.remove('hidden');
    document.getElementById('learn-empty-action').classList.add('hidden');
  }

  // Disable Tools
  if (profRecordTools) profRecordTools.classList.add('disabled');
  if (profDrawingTools) profDrawingTools.classList.add('disabled');
  if (exportPackageBtn) exportPackageBtn.disabled = true;
  if (downloadZipBtn) downloadZipBtn.disabled = true;
  if (document.getElementById('preview-mode-btn')) {
    document.getElementById('preview-mode-btn').disabled = true;
  }
  if (learnerPlayerTools) learnerPlayerTools.classList.add('disabled');
  
  // Reset Audio UI
  if (timerDisplay) timerDisplay.textContent = '00:00';
  if (currentTimeDisplay) currentTimeDisplay.textContent = '0:00';
  if (durationTimeDisplay) durationTimeDisplay.textContent = '0:00';
  if (audioProgress) audioProgress.value = 0;
  if (timelineMarkersContainer) timelineMarkersContainer.innerHTML = '';

  // Return to Initial Mode state
  if (preserveMode) {
    // If we're keeping the mode, we just need to trigger the mode's click logic to refresh UI visibility
    if (currentMode === 'professor') modeProfBtn.click();
    else modeLearnBtn.click();
  } else {
    if (modeProfBtn) modeProfBtn.click();
  }
  
  // Clear file inputs
  if (document.getElementById('pdf-upload')) document.getElementById('pdf-upload').value = '';
  if (document.getElementById('package-upload')) document.getElementById('package-upload').value = '';
  if (document.getElementById('feedback-link-input')) document.getElementById('feedback-link-input').value = '';
  
  console.log("App state reset successfully.");
}

// ==========================================
// 1. PDF.js Document Rendering
// ==========================================

document.getElementById('pdf-upload').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file && file.type === 'application/pdf') {
    // Store original filename without extension
    originalFileName = file.name.replace(/\.[^/.]+$/, "");
    
    const fileReader = new FileReader();
    fileReader.onload = function (event) {
      const typedarray = new Uint8Array(event.target.result);
      loadPdf(typedarray);
    };
    fileReader.readAsArrayBuffer(file);
  }
});

let pdfBytes = null; // Store original PDF bytes for export

function loadPdf(data) {
  // Save a fresh clone of the bytes so PDF.js Web Worker doesn't detach our export copy
  pdfBytes = new Uint8Array(data);

  // Pass another clean clone to PDF.js
  const pdfjsData = new Uint8Array(data);

  pdfjsLib.getDocument(pdfjsData).promise.then(pdfDoc_ => {
    pdfDoc = pdfDoc_;
    document.getElementById('page-count').textContent = pdfDoc.numPages;
    feedbackData.pages = pdfDoc.numPages;

    // UI Update
    emptyState.style.display = 'none';
    pdfContainer.classList.remove('empty');
    pdfRenderCanvas.style.display = 'block';
    drawingCanvas.style.display = 'block';
    pageControls.classList.remove('hidden');

    // Enable Tools
    if (currentMode === 'professor') {
      profRecordTools.classList.remove('disabled');
      profDrawingTools.classList.remove('disabled');
      exportPackageBtn.disabled = false;
      downloadZipBtn.disabled = false;
      document.getElementById('preview-mode-btn').disabled = false;
      headerBetaBadge.style.cursor = 'pointer';
    }

    renderPage(pageNum);
  }).catch(err => {
    console.error('Error loading PDF:', err);
    alert('PDF 로드 중 오류가 발생했습니다: ' + err.message);
  });
}

function renderPage(num) {
  if (pageRendering) {
    pageNumPending = num;
    return;
  }
  pageRendering = true;
  isInputBlocked = true; // Block input during page render

  pdfDoc.getPage(num).then(page => {
    // Dynamic Scaling logic
    const viewport_orig = page.getViewport({ scale: 1.0 });
    const containerWidth = workspace.clientWidth - 80; // 40px margin on each side
    const scaleToFit = containerWidth / viewport_orig.width;
    currentScale = Math.min(scaleToFit, 1.8); // Max scale 1.8 for quality

    const viewport = page.getViewport({ scale: currentScale });

    pdfRenderCanvas.height = viewport.height;
    pdfRenderCanvas.width = viewport.width;
    drawingCanvas.height = viewport.height;
    drawingCanvas.width = viewport.width;

    // Center container based on PDF width
    pdfContainer.style.width = `${viewport.width}px`;
    pdfContainer.style.height = `${viewport.height}px`;

    const renderContext = {
      canvasContext: pdfCtx,
      viewport: viewport
    };
    const renderTask = page.render(renderContext);

    renderTask.promise.then(() => {
      pageRendering = false;
      if (pageNumPending !== null) {
        renderPage(pageNumPending);
        pageNumPending = null;
      }
      // Re-render strokes if any exist for this page
      renderStrokes();

      // Unblock input after a short delay to prevent accidental pens
      setTimeout(() => {
        isInputBlocked = false;
      }, 500);
    });
  });

  document.getElementById('page-num').textContent = num;
}

document.getElementById('prev-page').addEventListener('click', (e) => {
  e.stopPropagation(); // Prevent pen trigger
  if (pageNum <= 1) return;
  pageNum--;
  queueRenderPage(pageNum);
});

document.getElementById('next-page').addEventListener('click', (e) => {
  e.stopPropagation(); // Prevent pen trigger
  if (pageNum >= pdfDoc.numPages) return;
  pageNum++;
  queueRenderPage(pageNum);
});

function queueRenderPage(num) {
  if (pageRendering) {
    pageNumPending = num;
  } else {
    renderPage(num);
  }
}

// ==========================================
// 2. Professor Mode: Drawing & Sync Data
// ==========================================

function setupDrawingTools() {
  const toolBtns = document.querySelectorAll('.tool-btn');
  toolBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      toolBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentToolType = btn.dataset.tool;

      // Smart Arming: If not recording and user chooses a tool, arm the mic
      if (currentMode === 'professor' && !isRecording && !isMicArmed && (currentToolType === 'pen' || currentToolType === 'highlighter')) {
        const recordBtn = document.getElementById('record-btn');
        if (recordBtn) {
          recordBtn.click(); // Trigger arming
          showToast("녹음이 준비되었습니다. 화면에 필기를 하면 자동으로 녹음이 시작됩니다.");
        }
      }
    });
  });

  const colorBtns = document.querySelectorAll('.color-btn');
  colorBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      colorBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentStyle.color = btn.dataset.color;
    });
  });

  const customColorPicker = document.getElementById('custom-color-picker');
  customColorPicker.addEventListener('input', (e) => {
    colorBtns.forEach(b => b.classList.remove('active'));
    currentStyle.color = e.target.value;
  });

  const sizeSlider = document.getElementById('pen-size');
  sizeSlider.addEventListener('input', (e) => {
    currentStyle.size = parseInt(e.target.value);
  });

  // Pointer Events for Cross-platform support (Mouse, Touch, Pen)
  // UX FIX: For iOS Safari, we use pointerdown but ensure it's treated as a valid gesture
  drawingCanvas.addEventListener('pointerdown', (e) => {
    unlockAudio(); // Ensure unlocked on interaction
    startDrawing(e);
  });
  drawingCanvas.addEventListener('pointermove', draw);
  drawingCanvas.addEventListener('pointerup', stopDrawing);
  drawingCanvas.addEventListener('pointercancel', stopDrawing);
  drawingCanvas.addEventListener('pointerout', stopDrawing);

  // Undo Feature
  const undoBtn = document.getElementById('undo-btn');
  if (undoBtn) {
    undoBtn.addEventListener('click', performUndo);
  }

  // Keyboard shortcut for Undo (Ctrl+Z or Cmd+Z)
  document.addEventListener('keydown', (e) => {
    if (currentMode === 'professor' && (e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      performUndo();
    }
  });

  // Setup Sidebar Button Protection
  setupSidebarActions();
}

function setupSidebarActions() {
  const exportBtn = document.getElementById('export-package-btn');
  const zipBtn = document.getElementById('download-zip-btn');

  const showDisabledWarning = () => {
    if (!pdfDoc) {
      showToast("먼저 PDF 과제를 불러와주세요");
    }
  };

  // Add click listeners to containers or directly to buttons handles the toast when disabled
  exportBtn.parentElement.addEventListener('click', (e) => {
    if (exportBtn.disabled) showDisabledWarning();
  }, true);
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

function performUndo() {
  if (currentMode !== 'professor') return;
  if (!feedbackData.strokes || feedbackData.strokes.length === 0) return;

  // Remove the very last stroke from the array
  feedbackData.strokes.pop();

  // Re-render the canvas to reflect the removed stroke
  renderStrokes();
}

function getAudioCurrentTime() {
  if (currentMode === 'professor') {
    if (isRecording) {
      if (isPaused) {
        return (pauseStartTime - startTime - totalPausedTime) / 1000;
      }
      return (Date.now() - startTime - totalPausedTime) / 1000;
    }
    return 0;
  } else {
    return learnerAudio.currentTime;
  }
}

function startDrawing(e) {
  if (isInputBlocked) return; // Prevent strokes during transitions or UI usage
  if (currentMode === 'learner') {
    handleLearnerClick(e);
    return;
  }

  if (!pdfDoc) return;
  e.preventDefault();

  // Auto Record Logic (Mic Armed)
  if (isMicArmed && !isRecording && currentMode === 'professor') {
    startActualRecording();
    // Remove pulse hint once recording actually starts
    const recordBtnLocal = document.getElementById('record-btn');
    if (recordBtnLocal) recordBtnLocal.classList.remove('pulse-hint');
    showToast("필기를 인식하여 목소리 녹음을 시작합니다.");
  }

  isDrawing = true;
  const { x, y } = getMousePos(drawingCanvas, e);
  [lastX, lastY] = [x, y];

  // Start new Stroke Data
  currentStroke = {
    id: strokeIdCounter++,
    page: pageNum,
    startTime: getAudioCurrentTime(),
    endTime: null,
    tool: currentToolType,
    color: currentStyle.color,
    thickness: currentStyle.size,
    points: [{ x: Math.round(x), y: Math.round(y) }]
  };
}

function draw(e) {
  if (!isDrawing || currentMode !== 'professor') return;
  e.preventDefault();

  const { x, y } = getMousePos(drawingCanvas, e);

  drawCtx.beginPath();
  drawCtx.moveTo(lastX, lastY);
  drawCtx.lineTo(x, y);

  if (currentToolType === 'eraser') {
    drawCtx.globalCompositeOperation = 'destination-out';
    drawCtx.lineWidth = currentStyle.size * 5 + 10;
    drawCtx.strokeStyle = 'rgba(0,0,0,1)';
  } else if (currentToolType === 'highlighter') {
    drawCtx.globalCompositeOperation = 'source-over';
    drawCtx.lineWidth = currentStyle.size * 3 + 10;
    let hex = currentStyle.color;
    let r = parseInt(hex.slice(1, 3), 16);
    let g = parseInt(hex.slice(3, 5), 16);
    let b = parseInt(hex.slice(5, 7), 16);
    drawCtx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.15)`;
  } else {
    drawCtx.globalCompositeOperation = 'source-over';
    drawCtx.lineWidth = currentStyle.size;
    drawCtx.strokeStyle = currentStyle.color;
  }

  drawCtx.lineCap = 'round';
  drawCtx.lineJoin = 'round';
  drawCtx.stroke();
  drawCtx.globalCompositeOperation = 'source-over'; // Reset

  // Add points to data structure (sampling for performance optimization can be added here)
  currentStroke.points.push({ x: Math.round(x), y: Math.round(y) });

  [lastX, lastY] = [x, y];
}

function stopDrawing() {
  if (!isDrawing || currentMode !== 'professor') return;
  isDrawing = false;

  if (currentStroke && currentStroke.points.length > 1) {
    currentStroke.endTime = getAudioCurrentTime();
    feedbackData.strokes.push(currentStroke);
    
    // Pulse the Preview button to encourage review
    if (feedbackData.strokes.length > 0) {
      modeLearnBtn.classList.add('glow-btn');
    }
  }
  currentStroke = null;
}

function getMousePos(canvas, evt) {
  const rect = canvas.getBoundingClientRect();
  
  // Safety check: Avoid division by zero or NaN
  if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };

  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  // Pointer Events (and falling back to MouseEvent) use clientX/clientY directly
  const clientX = evt.clientX;
  const clientY = evt.clientY;

  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY
  };
}

function renderStrokes(highlightId = null) {
  if (!drawingCanvas) return;
  drawCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);

  const pageStrokes = feedbackData.strokes.filter(s => s.page === pageNum);
  const currentTime = currentMode === 'learner' ? learnerAudio.currentTime : 0;
  const isInitialState = currentMode === 'learner' && learnerAudio.paused && learnerAudio.currentTime === 0;

  const setStyle = (stroke, isFaint) => {
    drawCtx.lineCap = 'round';
    drawCtx.lineJoin = 'round';
    if (stroke.tool === 'highlighter') {
      drawCtx.globalCompositeOperation = 'source-over';
      let hex = stroke.color || '#ff3b30';
      let r = parseInt(hex.slice(1, 3), 16); let g = parseInt(hex.slice(3, 5), 16); let b = parseInt(hex.slice(5, 7), 16);
      let alpha = isFaint ? 0.08 : 0.15; // Decreased highlighter opacity to prevent obscuring text
      drawCtx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      drawCtx.lineWidth = stroke.thickness * 3 + 10;
    } else if (stroke.tool === 'eraser') {
      drawCtx.globalCompositeOperation = 'destination-out';
      drawCtx.strokeStyle = isFaint ? 'rgba(0,0,0,0)' : 'rgba(0,0,0,1)';
      drawCtx.lineWidth = stroke.thickness * 5 + 10;
    } else {
      drawCtx.globalCompositeOperation = 'source-over';
      let hex = stroke.color || '#1c1c1e';
      let r = parseInt(hex.slice(1, 3), 16); let g = parseInt(hex.slice(3, 5), 16); let b = parseInt(hex.slice(5, 7), 16);
      let alpha = isFaint ? 0.4 : 1.0; // Increased faint background visibility
      drawCtx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      drawCtx.lineWidth = stroke.thickness;
    }
  };

  if (currentMode === 'learner') {
    pageStrokes.forEach(stroke => {
      if (stroke.points.length === 0) return;
      let ratio = 0;
      let solidCount = 0;

      if (isInitialState) {
        ratio = 1;
        solidCount = stroke.points.length;
      } else if (currentTime < stroke.startTime) {
        ratio = 0;
        solidCount = 0;
      } else if (!stroke.endTime || currentTime >= stroke.endTime) {
        ratio = 1;
        solidCount = stroke.points.length;
      } else {
        ratio = (currentTime - stroke.startTime) / (stroke.endTime - stroke.startTime);
        solidCount = Math.floor(stroke.points.length * ratio);
      }

      // 1. Draw Faint Background Stroke
      if (stroke.tool !== 'eraser') {
        drawCtx.beginPath();
        drawCtx.moveTo(stroke.points[0].x, stroke.points[0].y);
        for (let i = 1; i < stroke.points.length; i++) {
          drawCtx.lineTo(stroke.points[i].x, stroke.points[i].y);
        }
        setStyle(stroke, true);
        drawCtx.stroke();
      }

      // 2. Draw Solid Animated Writing
      if (solidCount > 0) {
        drawCtx.beginPath();
        drawCtx.moveTo(stroke.points[0].x, stroke.points[0].y);
        for (let i = 1; i < solidCount; i++) {
          drawCtx.lineTo(stroke.points[i].x, stroke.points[i].y);
        }
        setStyle(stroke, false);
        drawCtx.stroke();
      }

      // Draw Highlight Overlay if clicked
      if (highlightId === stroke.id && stroke.tool !== 'eraser') {
        drawCtx.beginPath();
        drawCtx.moveTo(stroke.points[0].x, stroke.points[0].y);
        for (let i = 1; i < stroke.points.length; i++) {
          drawCtx.lineTo(stroke.points[i].x, stroke.points[i].y);
        }
        drawCtx.strokeStyle = 'rgba(255, 204, 0, 0.5)'; // subtle highlight
        drawCtx.lineWidth = stroke.tool === 'highlighter' ? stroke.thickness * 3 + 14 : stroke.thickness + 6;
        drawCtx.stroke();
      }
      drawCtx.globalCompositeOperation = 'source-over';
    });
    return;
  }

  // Professor Mode Logic
  pageStrokes.forEach(stroke => {
    if (stroke.points.length === 0) return;

    drawCtx.beginPath();
    drawCtx.moveTo(stroke.points[0].x, stroke.points[0].y);

    for (let i = 1; i < stroke.points.length; i++) {
      drawCtx.lineTo(stroke.points[i].x, stroke.points[i].y);
    }

    if (stroke.tool === 'eraser') {
      drawCtx.globalCompositeOperation = 'destination-out';
      drawCtx.strokeStyle = 'rgba(0,0,0,1)';
      drawCtx.lineWidth = stroke.thickness * 5 + 10;
    } else if (stroke.tool === 'highlighter') {
      drawCtx.globalCompositeOperation = 'source-over';
      let hex = stroke.color || '#ff3b30';
      let r = parseInt(hex.slice(1, 3), 16);
      let g = parseInt(hex.slice(3, 5), 16);
      let b = parseInt(hex.slice(5, 7), 16);
      drawCtx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.25)`;
      drawCtx.lineWidth = stroke.thickness * 3 + 10;
    } else {
      drawCtx.globalCompositeOperation = 'source-over';
      drawCtx.strokeStyle = stroke.color;
      drawCtx.lineWidth = stroke.thickness;
    }

    drawCtx.lineCap = 'round';
    drawCtx.lineJoin = 'round';
    drawCtx.stroke();
    drawCtx.globalCompositeOperation = 'source-over'; // Reset
  });
}

// ==========================================
// 3. Audio Recording & Export
// ==========================================

let stream = null;
const recordBtn = document.getElementById('record-btn');
const stopBtn = document.getElementById('stop-btn');
const timerDisplay = document.getElementById('record-timer');

async function setupAudio() {
  recordBtn.addEventListener('click', async () => {
    if (isMicArmed) {
      startActualRecording();
      return;
    }

    if (!isMicArmed && !isRecording) {
      // Stream check/get
      if (!stream) {
        try {
          if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          } else {
            throw new Error('mediaDevices API cannot be used');
          }
        } catch (err) {
          console.warn('Mic error or not available:', err);
          const AudioContext = window.AudioContext || window.webkitAudioContext;
          if (AudioContext) {
            const ctx = new AudioContext();
            const dest = ctx.createMediaStreamDestination();
            stream = dest.stream;
          } else {
            alert('오디오를 지원하지 않는 브라우저입니다.');
            return;
          }
        }
      }

      isMicArmed = true;
      recordBtn.classList.add('armed');
      recordBtn.innerHTML = '<i class="fa-solid fa-microphone"></i><span style="font-size:10px;display:block;">대기중</span>';
      recordBtn.style.color = '#ff9500'; // Show armed state
    }
  });

  stopBtn.addEventListener('click', () => {
    if (!isRecording && !isMicArmed) return;

    if (isRecording) {
      mediaRecorder.stop();
    }

    isRecording = false;
    isMicArmed = false;
    
    // Hide floating finish button
    const floatBtn = document.getElementById('floating-finish-btn');
    if (floatBtn) floatBtn.classList.add('hidden');

    recordBtn.classList.remove('recording');
    recordBtn.classList.remove('armed');
    recordBtn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
    recordBtn.style.color = '';
    timerDisplay.classList.remove('recording');
    stopBtn.disabled = true;
    
    // Reset pause button state
    if (pauseBtn) {
      pauseBtn.disabled = true;
      pauseBtn.classList.remove('active');
      pauseBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
    }

    clearInterval(timerInterval);
    // Don't reset timerDisplay.textContent to '00:00' here!
    // Keep the final time visible.

    // UX FIX: Guide to next step
    showToast("피드백 작성이 완료되었습니다! 이제 버튼을 눌러 공유해보세요.");
    const exportBtn = document.getElementById('export-package-btn');
    if (exportBtn) exportBtn.classList.add('pulse-hint');
  });

  pauseBtn.addEventListener('click', () => {
    if (!isRecording) return;

    if (!isPaused) {
      // Pause
      isPaused = true;
      pauseStartTime = Date.now();
      mediaRecorder.pause();
      pauseBtn.classList.add('active');
      pauseBtn.innerHTML = '<i class="fa-solid fa-play"></i>'; // Change to play icon to resume
      showToast("녹화가 일시정지되었습니다.");
    } else {
      // Resume
      isPaused = false;
      totalPausedTime += (Date.now() - pauseStartTime);
      mediaRecorder.resume();
      pauseBtn.classList.remove('active');
      pauseBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
      showToast("녹화를 재개합니다.");
    }
  });
}

function startActualRecording() {
  if (!stream || isRecording) return; // Guard: don't start if stream missing or already recording
  
  try {
    // Re-create MediaRecorder for every new recording session (fix for "cannot reuse after stop")
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];
    
    mediaRecorder.ondataavailable = (e) => {
      audioChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      recordedAudioBlob = audioBlob; 
      const audioUrl = URL.createObjectURL(audioBlob);
      learnerAudioUrl = audioUrl; 
      audioChunks = [];
      exportPackageBtn.disabled = false;
      
      // Pulse the ZIP download button
      if (downloadZipBtn) downloadZipBtn.classList.add('pulse-hint');
    };

    startTime = Date.now();
    mediaRecorder.start();
    isRecording = true;
    isMicArmed = false;
    isPaused = false;
    totalPausedTime = 0;

    // UI
    if (recordBtn) {
      recordBtn.classList.remove('armed');
      recordBtn.classList.add('recording');
      recordBtn.innerHTML = '<i class="fa-solid fa-circle-dot"></i>';
      recordBtn.style.color = ''; 
      recordBtn.disabled = true;
    }
    
    if (timerDisplay) timerDisplay.classList.add('recording');
    if (stopBtn) stopBtn.disabled = false;

    // Enable pause button
    if (pauseBtn) {
      pauseBtn.disabled = false;
      pauseBtn.classList.remove('active');
      pauseBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
    }

    timerInterval = setInterval(updateTimer, 100);

    // Show floating finish button
    const floatBtn = document.getElementById('floating-finish-btn');
    if (floatBtn) {
      floatBtn.classList.remove('hidden');
      floatBtn.onclick = () => {
        if (stopBtn) stopBtn.click();
      };
    }
  } catch (err) {
    console.error("Recording start failed:", err);
    showToast("녹음을 시작할 수 없습니다. 마이크 권한을 확인해 주세요.");
    isRecording = false;
    isMicArmed = true; // Stay armed to try again
  }
}

function updateTimer() {
  if (isPaused) return;
  const elapsedMs = Date.now() - startTime - totalPausedTime;
  const totalSec = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSec / 60).toString().padStart(2, '0');
  const seconds = (totalSec % 60).toString().padStart(2, '0');
  timerDisplay.textContent = `${minutes}:${seconds}`;
}

// ==========================================
// IndexedDB Mock Database Setup
// ==========================================
const DB_NAME = "SorinaFeedbackMockDB";
const STORE_NAME = "feedbacks";

// Fallback toggle if IndexedDB is blocked (e.g. running from file:// locally)
let useFallbackStorage = false;

// Helper functions for fallback storage
function blobToBase64(blob) {
  return new Promise((resolve, _) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = error => resolve(null);
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64) {
  if (!base64) return null;
  const arr = base64.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

function getMockDB() {
  return new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = (e) => {
        e.target.result.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = (e) => {
        useFallbackStorage = true;
        reject(request.error || new Error("IndexedDB Blocked"));
      };
    } catch (err) {
      useFallbackStorage = true;
      reject(err);
    }
  });
}

function saveToMockDB(id, data) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await getMockDB();
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put(data, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    } catch (err) {
      useFallbackStorage = true;
      reject(err);
    }
  });
}

function loadFromMockDB(id) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await getMockDB();
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    } catch (err) {
      useFallbackStorage = true;
      reject(err);
    }
  });
}

// Save Package (IndexedDB Link Generator)
exportPackageBtn.addEventListener('click', async () => {
  exportPackageBtn.disabled = true;
  const originalText = exportPackageBtn.innerHTML;
  exportPackageBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 링크 생성 중...';

  try {
    const feedbackId = Math.floor(10000 + Math.random() * 90000).toString();
    
    // Remove all hints when sharing starts
    exportPackageBtn.classList.remove('pulse-hint');

    let audioBlobInfo = null;
    let base64Audio = null;
    let base64Pdf = null;

    if (typeof recordedAudioBlob !== 'undefined' && recordedAudioBlob) {
      audioBlobInfo = recordedAudioBlob;
      base64Audio = await blobToBase64(audioBlobInfo); // prepare for fallback just in case
    } else if (learnerAudioUrl) {
      // (Fallback for ZIP loaded states where we only have the learnerAudioUrl)
      try {
        const response = await fetch(learnerAudioUrl);
        audioBlobInfo = await response.blob();
        base64Audio = await blobToBase64(audioBlobInfo);
      } catch (e) {
        console.error("Audio fetch failed", e);
      }
    }

    if (pdfBytes) {
      const pdfBlobFallback = new Blob([pdfBytes], { type: 'application/pdf' });
      base64Pdf = await blobToBase64(pdfBlobFallback);
    }

    try {
      // 1. Try Native Record Support in IndexedDB First
      const mockDbRecord = {
        pdf: pdfBytes,
        strokes: feedbackData.strokes,
        audio: audioBlobInfo,
        timestamp: Date.now()
      };
      await saveToMockDB(feedbackId, mockDbRecord);
    } catch (err) {
      // 2. Fallback to LocalStorage if indexedDB blocked (Local file:// execution)
      console.warn("IndexedDB failed, falling back to Local/Session Storage", err);
      const fallbackRecord = {
        pdf: base64Pdf,
        strokes: feedbackData.strokes,
        audio: base64Audio,
        timestamp: Date.now()
      };

      try {
        localStorage.setItem(`sf_${feedbackId}`, JSON.stringify(fallbackRecord));
      } catch (storageErr) {
        try {
          sessionStorage.setItem(`sf_${feedbackId}`, JSON.stringify(fallbackRecord));
        } catch (sessionErr) {
          alert("저장 공간(IndexedDB, LocalStorage) 생성이 차단되었거나 용량이 부족합니다.");
          exportPackageBtn.disabled = false;
          exportPackageBtn.innerHTML = originalText;
          return;
        }
      }
    }

    setTimeout(() => {
      exportPackageBtn.disabled = false;
      exportPackageBtn.innerHTML = originalText;
      const shareContainer = document.getElementById('share-link-container');
      const shareInput = document.getElementById('share-link-input');
      const shareUrl = `${window.location.origin}${window.location.pathname}?fid=${feedbackId}`;
      shareInput.value = shareUrl;
      shareContainer.classList.remove('hidden');
      // Trigger slide-up animation
      requestAnimationFrame(() => {
        shareContainer.classList.add('show');
        if (typeof lucide !== 'undefined') {
          lucide.createIcons();
        }
      });
    }, 800);

  } catch (error) {
    console.error("Export Error:", error);
    exportPackageBtn.disabled = false;
    exportPackageBtn.innerHTML = originalText;
    alert('링크 생성 중 오류가 발생했습니다.');
  }
});

// Setup Link Copy Button
document.getElementById('copy-link-btn').addEventListener('click', () => {
  const shareInput = document.getElementById('share-link-input');
  shareInput.select();
  navigator.clipboard.writeText(shareInput.value).then(() => {
    const copyBtn = document.getElementById('copy-link-btn');
    const origHtml = copyBtn.innerHTML;
    
    copyBtn.innerHTML = '<i class="fa-solid fa-check"></i> 복사 완료!';
    copyBtn.classList.add('copied');
    
    setTimeout(() => {
      copyBtn.innerHTML = origHtml;
      copyBtn.classList.remove('copied');
    }, 2000);
  });
});

// ==========================================
// 4. Learner Mode: Magic Hit Detection 
// ==========================================

let loadedFeedbackId = null;

async function loadMockDbRecord(feedbackId) {
  try {
    let record = null;

    try {
      record = await loadFromMockDB(feedbackId);
    } catch (err) {
      console.warn("IndexedDB load failed, trying fallback storages");
    }

    // Try fallback storages if IndexedDB returned nothing or failed
    if (!record) {
      let rawData = localStorage.getItem(`sf_${feedbackId}`);
      if (!rawData) rawData = sessionStorage.getItem(`sf_${feedbackId}`);
      if (rawData) {
        const parsed = JSON.parse(rawData);
        // Format it to look like the Native Record
        record = {
          pdf: parsed.pdf ? new Uint8Array(await base64ToBlob(parsed.pdf).arrayBuffer()) : null,
          strokes: parsed.strokes || parsed.strokeData,
          audio: parsed.audio ? base64ToBlob(parsed.audio) : null
        };
      }
    }

    if (!record) {
      alert("피드백 데이터를 찾을 수 없습니다. (만료되었거나 다른 브라우저일 수 있습니다.)");
      return;
    }

    // 1. Process PDF
    if (record.pdf) {
      pageNum = 1;
      loadPdf(record.pdf);
    } else {
      alert("PDF 정보를 찾을 수 없습니다.");
      return;
    }

    // 2. Load JSON Data
    feedbackData = record.strokeData || { strokes: record.strokes, version: '1.0' };

    // 3. Process Audio
    if (record.audio) {
      const audioUrl = URL.createObjectURL(record.audio);
      learnerAudio.src = audioUrl;
      learnerAudioUrl = audioUrl; // CRITICAL FIX: Ensure global learnerAudioUrl is set!
      learnerAudio.load(); // Explicit load for iOS
      learnerPlayerTools.classList.remove('disabled');
    }

    // Switch UI
    isLearnerContentLoaded = true;
    modeLearnBtn.click();
    unlockAudio(); // Ensure unlocked when loading data

    setTimeout(() => {
      renderStrokes();
      alert('피드백 데이터를 성공적으로 불러왔습니다. 재생 버튼을 누르면 전체 설명을, 필기된 부분을 클릭하면 해당 부분의 설명을 들을 수 있습니다.');
    }, 500);

  } catch (err) {
    console.error("Parse Error:", err);
    alert("데이터를 읽는 중 오류가 발생했습니다.");
  }
}

function setupLearnerInputs() {
  const packageInput = document.getElementById('package-upload');
  packageInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const zip = await JSZip.loadAsync(file);

      // 1. Load PDF
      let pdfFileToLoad = zip.file("original.pdf");
      if (!pdfFileToLoad) {
        const pdfFiles = zip.file(/.*\.pdf$/i);
        pdfFileToLoad = pdfFiles.length > 0 ? pdfFiles[0] : null;
      }
      if (pdfFileToLoad) {
        const fileData = await pdfFileToLoad.async("uint8array");
        const cleanData = new Uint8Array(fileData);
        pageNum = 1;
        loadPdf(cleanData);
      } else {
        alert("PDF 파일을 찾을 수 없습니다.");
        return;
      }

      // 2. Load JSON
      const jsonFiles = zip.file(/.*\.json$/i);
      if (jsonFiles.length > 0) {
        const jsonStr = await jsonFiles[0].async("string");
        feedbackData = JSON.parse(jsonStr);
      } else {
        alert("데이터 파일을 찾을 수 없습니다.");
        return;
      }

      // 3. Load Audio
      const audioFiles = zip.file(/.*\.webm$/i);
      if (audioFiles.length > 0) {
        const audioData = await audioFiles[0].async("blob");
        const audioBlob = new Blob([audioData], { type: 'audio/webm' });
        const audioUrl = URL.createObjectURL(audioBlob);
        learnerAudio.src = audioUrl;
        learnerAudioUrl = audioUrl; // CRITICAL FIX: Ensure playback state is global!
        learnerPlayerTools.classList.remove('disabled');
      }

      isLearnerContentLoaded = true;
      setTimeout(() => {
        renderStrokes();
        alert('피드백 데이터를 성공적으로 불러왔습니다. 재생 버튼을 누르면 전체 설명을, 필기된 부분을 클릭하면 해당 부분의 설명을 들을 수 있습니다.');
      }, 500);

    } catch (err) {
      console.error("Error loading package:", err);
      alert("파일을 불러오는 중 오류가 발생했습니다. 올바른 .tfeed 파일인지 확인해 주세요.");
    }
  });

  // Share Link Setup
  const openLinkBtn = document.getElementById('open-link-btn');
  const linkInput = document.getElementById('feedback-link-input');

  if (openLinkBtn && linkInput) {
    openLinkBtn.addEventListener('click', () => {
      const urlStr = linkInput.value.trim();
      if (!urlStr) return;

      try {
        const urlObj = new URL(urlStr);
        const fid = urlObj.searchParams.get('fid');
        unlockAudio(); // Trigger on button click
        if (fid) {
          loadMockDbRecord(fid);
        } else {
          const parts = urlObj.pathname.split('/');
          const lastPart = parts[parts.length - 1];
          if (lastPart && !isNaN(lastPart)) {
            loadMockDbRecord(lastPart);
          } else {
            alert('올바른 형식의 링크가 아닙니다.');
          }
        }
      } catch (e) {
        // Fallback for just raw ID input
        if (!isNaN(urlStr)) {
          loadMockDbRecord(urlStr);
        } else {
          alert("유효한 링크 주소가 아닙니다.");
        }
      }
    });
  }
}

// 5. On Page Load, check for ?fid
window.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const fid = urlParams.get('fid');
  if (fid) {
    setTimeout(() => {
      const welcome = document.getElementById('welcome-modal');
      if (welcome) welcome.classList.add('hidden');
      loadMockDbRecord(fid);
    }, 300);
  }
});

// Distance point to line segment
function distToSegment(p, v, w) {
  const l2 = dist2(v, w);
  if (l2 == 0) return dist2(p, v);
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.sqrt(dist2(p, { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) }));
}

function dist2(v, w) {
  return (v.x - w.x) * (v.x - w.x) + (v.y - w.y) * (v.y - w.y);
}

// Hit Test Logic
function handleLearnerClick(e) {
  const { x, y } = getMousePos(drawingCanvas, e);
  const clickPoint = { x, y };

  const HIT_RADIUS = 20; // 픽셀 오차 범위 (클릭/터치 보정용)
  let closestStroke = null;
  let minDistance = Infinity;

  // Search all strokes on current page
  const pageStrokes = feedbackData.strokes.filter(s => s.page === pageNum && s.tool !== 'eraser');

  for (const stroke of pageStrokes) {
    // Iterate points to form line segments and find min distance to click
    for (let i = 0; i < stroke.points.length - 1; i++) {
      const dist = distToSegment(clickPoint, stroke.points[i], stroke.points[i + 1]);
      if (dist < minDistance) {
        minDistance = dist;
        closestStroke = stroke;
      }
    }
  }

  if (minDistance <= HIT_RADIUS && closestStroke) {
    // We found a stroke!
    console.log("Hit Stroke IDs:", closestStroke.id, "Time:", closestStroke.startTime);
    playStrokeAudio(closestStroke);
  } else {
    // Clicked elsewhere
    renderStrokes(); // Clear highlights
  }
}

function playStrokeAudio(stroke) {
  // 1. 시각적 피드백 (하이라이트)
  // Highlights point without pausing the playback
  // Timeout removes highlight after a few seconds
  renderStrokes(stroke.id);
  setTimeout(() => renderStrokes(), 2000);

  // 2. 오디오 동기화 및 재생
  if (learnerAudio.src) {
    // SeekTo time
    learnerAudio.currentTime = stroke.startTime;
    learnerAudio.play().then(() => {
      playPauseBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
    }).catch(e => console.log('Auto-play blocked or audio not ready', e));
  }
}

// ------------------------------------------
// Custom Audio Player Logic
// ------------------------------------------

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

let isCustomAudioPlayerSetup = false;

function setupCustomAudioPlayer() {
  if (isCustomAudioPlayerSetup) return;
  isCustomAudioPlayerSetup = true;

  learnerAudio.addEventListener('loadedmetadata', () => {
    learnerAudio.currentTime = 0; // safely reset to start when new source loaded
    audioProgress.max = learnerAudio.duration;
    durationTimeDisplay.textContent = formatTime(learnerAudio.duration);
    buildTimelineMarkers(); // Build markers when duration is known
  });

  learnerAudio.addEventListener('timeupdate', () => {
    audioProgress.value = learnerAudio.currentTime;
    currentTimeDisplay.textContent = formatTime(learnerAudio.currentTime);
  });

  learnerAudio.addEventListener('play', () => {
    playPauseBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
  });

  learnerAudio.addEventListener('pause', () => {
    playPauseBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
  });

  learnerAudio.addEventListener('ended', () => {
    playPauseBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
    audioProgress.value = 0;
  });
}

// Event Listeners for UI interaction
playPauseBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  unlockAudio(); // Ensure unlocked on btn click
  
  if (learnerAudio.paused) {
    const playPromise = learnerAudio.play();
    if (playPromise !== undefined) {
      playPromise.catch(e => {
        console.error("Audio playback failed:", e);
        if (e.name === 'NotAllowedError') {
          showToast("화면을 한 번 터치하신 후 재생 버튼을 다시 눌러주세요.");
        } else {
          showToast("오디오를 재생할 수 없습니다. (데이터 로딩 중일 수 있습니다)");
        }
      });
    }
  } else {
    learnerAudio.pause();
  }
});

audioProgress.addEventListener('input', () => {
  learnerAudio.currentTime = audioProgress.value;
  if (!learnerAudio.paused) {
    // Prevent stuttering rendering during scrubbing
    requestAnimationFrame(() => renderStrokes());
  }
});

playbackSpeedSelect.addEventListener('change', (e) => {
  learnerAudio.playbackRate = parseFloat(e.target.value);
});

function buildTimelineMarkers() {
  timelineMarkersContainer.innerHTML = '';
  if (!learnerAudio.duration || learnerAudio.duration === 0) return;

  const duration = learnerAudio.duration;

  // Extract unique start times to prevent stacking dots in the exact same location
  const uniqueTimes = new Set();

  feedbackData.strokes.forEach(stroke => {
    if (stroke.tool === 'eraser') return;

    // Group markers tightly together if they occur within 0.5s of each other
    const timeKey = Math.floor(stroke.startTime * 2) / 2;
    if (!uniqueTimes.has(timeKey)) {
      uniqueTimes.add(timeKey);

      const marker = document.createElement('div');
      marker.classList.add('marker');

      const percentage = (stroke.startTime / duration) * 100;
      marker.style.left = `${percentage}%`;
      marker.title = `필기 지점: ${formatTime(stroke.startTime)}`;

      marker.addEventListener('click', () => {
        playStrokeAudio(stroke);
      });

      timelineMarkersContainer.appendChild(marker);
    }
  });
}

// Initialize event listeners once globally
setupCustomAudioPlayer();

// Animation Loop for Learner Mode syncing Strokes to Audio
let lastAutoPageNum = null;

function animationLoop() {
  if (currentMode === 'learner' && !learnerAudio.paused) {
    const currentTime = learnerAudio.currentTime;

    // 1. Auto-scroll / Auto-flip page
    let activePage = null;
    let latestStrokeTime = -1;

    feedbackData.strokes.forEach(stroke => {
      if (stroke.startTime <= currentTime && stroke.startTime > latestStrokeTime) {
        latestStrokeTime = stroke.startTime;
        activePage = stroke.page;
      }
    });

    // Sync page if it changed based on audio playback
    if (activePage !== null && activePage !== pageNum && activePage !== lastAutoPageNum) {
      pageNum = activePage;
      lastAutoPageNum = activePage;
      renderPage(pageNum); // Re-renders PDF and strokes
    } else {
      renderStrokes(); // Just render strokes natively
    }
  }
  requestAnimationFrame(animationLoop);
}

// Start visual sync loop
requestAnimationFrame(animationLoop);

// ==========================================
// 5. ZIP Export Feature (Offline Package)
// ==========================================
downloadZipBtn.addEventListener('click', async () => {
  if (!pdfBytes) return;

  const originalText = downloadZipBtn.innerHTML;
  downloadZipBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 파일 생성 중...';
  downloadZipBtn.disabled = true;

  try {
    const zip = new JSZip();

    // 1. Add Original PDF
    zip.file("original.pdf", pdfBytes);

    // 2. Add JSON Data (Strokes)
    const jsonStr = JSON.stringify(feedbackData);
    zip.file("feedback.json", jsonStr);

    // 3. Add Audio if it exists
    if (typeof recordedAudioBlob !== 'undefined' && recordedAudioBlob) {
      zip.file("audio.webm", recordedAudioBlob);
    } else if (learnerAudioUrl) {
      // Fetch if we are in a state where we just have a URL (eg. loaded via zip in learner mode, though button is usually hidden)
      try {
        const response = await fetch(learnerAudioUrl);
        const audioBlobLocal = await response.blob();
        zip.file("audio.webm", audioBlobLocal);
      } catch (e) {
        console.error("Audio fetch failed for ZIP", e);
      }
    }

    // Generate ZIP
    const zipBlob = await zip.generateAsync({ type: "blob" });

    // Download
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${originalFileName}_피드백.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

  } catch (error) {
    console.error('ZIP 생성 중 오류 발생:', error);
    alert('ZIP 생성 중 오류가 발생했습니다.');
  } finally {
    downloadZipBtn.innerHTML = originalText;
    downloadZipBtn.disabled = false;
  }
});

// ==========================================
// 6. PDF Export Feature (Hidden Easter Egg)
// ==========================================
let betaClickCount = 0;
let betaClickTimer = null;

headerBetaBadge.addEventListener('click', () => {
  // Only available in professor mode after PDF is loaded
  if (currentMode !== 'professor' || !pdfBytes) return;

  betaClickCount++;
  
  if (betaClickTimer) {
    clearTimeout(betaClickTimer);
  }

  if (betaClickCount === 3) {
    betaClickCount = 0;
    triggerHiddenPdfExport();
  } else {
    betaClickTimer = setTimeout(() => {
      betaClickCount = 0;
    }, 1000); // Reset count after 1 second of inactivity
  }
});

async function triggerHiddenPdfExport() {
  const originalHtml = headerBetaBadge.innerHTML;
  headerBetaBadge.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

  try {
    const { PDFDocument, rgb } = PDFLib;
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pages = pdfDoc.getPages();

    feedbackData.strokes.forEach(stroke => {
      const pageIndex = stroke.page - 1;
      if (pageIndex < 0 || pageIndex >= pages.length) return;

      const page = pages[pageIndex];
      const { height } = page.getSize();

      const hex = stroke.color || '#1c1c1e';
      const r = parseInt(hex.slice(1, 3), 16) / 255;
      const g = parseInt(hex.slice(3, 5), 16) / 255;
      const b = parseInt(hex.slice(5, 7), 16) / 255;

      const opacity = stroke.tool === 'highlighter' ? 0.3 : 1;
      const thickness = stroke.tool === 'highlighter' ? stroke.thickness * 4 : stroke.thickness;

      if (stroke.tool === 'eraser') {
        // Fallback for eraser: white line
        for (let i = 0; i < stroke.points.length - 1; i++) {
          const p1 = stroke.points[i];
          const p2 = stroke.points[i + 1];
          page.drawLine({
            start: { x: p1.x / scale, y: height - (p1.y / scale) },
            end: { x: p2.x / scale, y: height - (p2.y / scale) },
            thickness: (stroke.thickness * 5) / scale,
            color: rgb(1, 1, 1),
            opacity: 1,
          });
        }
      } else {
        for (let i = 0; i < stroke.points.length - 1; i++) {
          const p1 = stroke.points[i];
          const p2 = stroke.points[i + 1];
          page.drawLine({
            start: { x: p1.x / scale, y: height - (p1.y / scale) },
            end: { x: p2.x / scale, y: height - (p2.y / scale) },
            thickness: thickness / scale,
            color: rgb(r, g, b),
            opacity: opacity,
          });
        }
      }
    });

    const pdfDataUri = await pdfDoc.saveAsBase64({ dataUri: true });

    const a = document.createElement('a');
    a.href = pdfDataUri;
    a.download = `${originalFileName}_피드백.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

  } catch (error) {
    console.error('PDF 생성 중 오류 발생:', error);
    alert('PDF 생성 중 오류가 발생했습니다.');
  } finally {
    headerBetaBadge.innerHTML = originalHtml;
  }
}
