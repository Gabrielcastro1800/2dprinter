const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
let imagee = new Image();
// We'll set imagee.crossOrigin and imagee.src when the user clicks Load.

let data = null;
let i = 0;
// For dominant-color passes
let dominantLists = null; // { red: [...pixelIndex], green: [...], blue: [...] }
let dominantPass = 0; // 0=red,1=green,2=blue
let dominantPos = 0; // position inside current pass
// For palette clustering
let clusterLists = null; // array of arrays of pixel indices
let clusterCenters = null; // array of [r,g,b]
let clusterPass = 0;
let clusterPos = 0;
// ordering of clusters when in palette mode (so we can shuffle cluster order)
let clusterOrder = null; // array of cluster indices, e.g. [2,0,1,...]
// For randomized linear order
let indexOrder = null; // array of pixel indices
let indexOrderPos = 0;
// ordering for dominant passes (0=red,1=green,2=blue) so we can randomize pass order
let dominantOrder = null;

// UI elements (populated after DOM is ready)
const pixelsPerFrameEl = () => document.getElementById('pixelsPerFrame');
const pixelsPerFrameNumberEl = () => document.getElementById('pixelsPerFrameNumber');
const frameDelayEl = () => document.getElementById('frameDelay');
const frameDelayNumberEl = () => document.getElementById('frameDelayNumber');
const progressEl = () => document.getElementById('progress');
const colorModeEl = () => document.getElementById('colorMode');
const paletteCountEl = () => document.getElementById('paletteCount');
const clearBetweenEl = () => document.getElementById('clearBetween');
const nextClusterBtn = () => document.getElementById('nextCluster');
const randomOrderEl = () => document.getElementById('randomOrder');

function syncControls() {
  const s = pixelsPerFrameEl();
  const n = pixelsPerFrameNumberEl();
  if (s && n) {
    s.addEventListener('input', () => n.value = s.value);
    n.addEventListener('input', () => s.value = n.value);
  }
  const ds = frameDelayEl();
  const dn = frameDelayNumberEl();
  if (ds && dn) {
    ds.addEventListener('input', () => dn.value = ds.value);
    dn.addEventListener('input', () => ds.value = dn.value);
  }
}

// helper to enable/disable Start button and update progress area
function setStartEnabled(enabled) {
  const btn = document.getElementById('startPrint');
  if (btn) btn.disabled = !enabled;
}

function showProgress(msg) {
  if (progressEl()) progressEl().textContent = msg;
}

// Compute k-means clusters for the image pixels (simple implementation).
// This builds clusterLists (array of pixel index arrays) and clusterCenters.
function computePaletteClusters(k) {
  if (!data) return;
  showProgress(`Computing ${k}-color palette (this may take a moment)...`);
  const totalPixels = Math.floor(data.length / 4);
  if (totalPixels === 0) return;

  // Create a list of pixel vectors for sampling/initialization
  const sampleLimit = Math.min(totalPixels, 50000);
  const sampleStep = Math.max(1, Math.floor(totalPixels / sampleLimit));
  const sampleIndices = [];
  for (let p = 0; p < totalPixels; p += sampleStep) sampleIndices.push(p);

  // initialize centers by picking k random samples (or first k if few)
  clusterCenters = [];
  for (let ci = 0; ci < k; ci++) {
    const idx = sampleIndices[(ci * 997) % sampleIndices.length]; // deterministic-ish spread
    const bi = idx * 4;
    clusterCenters.push([data[bi], data[bi + 1], data[bi + 2]]);
  }

  const assignments = new Int32Array(totalPixels);
  const maxIters = 12;
  for (let iter = 0; iter < maxIters; iter++) {
    // assignment pass
    const sumsR = new Array(k).fill(0);
    const sumsG = new Array(k).fill(0);
    const sumsB = new Array(k).fill(0);
    const counts = new Array(k).fill(0);

    for (let p = 0; p < totalPixels; p++) {
      const bi = p * 4;
      const r = data[bi];
      const g = data[bi + 1];
      const b = data[bi + 2];

      // find nearest center
      let best = 0;
      let bestDist = Infinity;
      for (let ci = 0; ci < k; ci++) {
        const c = clusterCenters[ci];
        const dr = r - c[0];
        const dg = g - c[1];
        const db = b - c[2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestDist) {
          bestDist = d;
          best = ci;
        }
      }
      assignments[p] = best;
      sumsR[best] += r;
      sumsG[best] += g;
      sumsB[best] += b;
      counts[best]++;
    }

    // update centers
    let moved = 0;
    for (let ci = 0; ci < k; ci++) {
      if (counts[ci] === 0) {
        // reinitialize empty cluster to a random sample
        const idx = sampleIndices[(ci * 811) % sampleIndices.length];
        const bi = idx * 4;
        const old = clusterCenters[ci];
        clusterCenters[ci] = [data[bi], data[bi + 1], data[bi + 2]];
        if (old[0] !== clusterCenters[ci][0] || old[1] !== clusterCenters[ci][1] || old[2] !== clusterCenters[ci][2]) moved++;
        continue;
      }
      const nr = Math.round(sumsR[ci] / counts[ci]);
      const ng = Math.round(sumsG[ci] / counts[ci]);
      const nb = Math.round(sumsB[ci] / counts[ci]);
      const old = clusterCenters[ci];
      if (old[0] !== nr || old[1] !== ng || old[2] !== nb) moved++;
      clusterCenters[ci] = [nr, ng, nb];
    }

    if (moved === 0) break;
  }

  // Build clusterLists from final assignments
  clusterLists = new Array(k);
  for (let ci = 0; ci < k; ci++) clusterLists[ci] = [];
  for (let p = 0; p < totalPixels; p++) {
    const ci = assignments[p];
    // push pixel index p
    clusterLists[ci].push(p);
  }

  clusterPass = 0;
  clusterPos = 0;
  showProgress(`Palette computed: ${k} colors`);
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
}

function buildIndexOrder() {
  if (!data) return;
  const totalPixels = Math.floor(data.length / 4);
  indexOrder = new Array(totalPixels);
  for (let p = 0; p < totalPixels; p++) indexOrder[p] = p;
  if (randomOrderEl()?.checked) shuffleArray(indexOrder);
  indexOrderPos = 0;
}

// Adjust the displayed canvas CSS size so small images are easier to see while
// preserving the internal canvas resolution (canvas.width/height). Call with
// the image's intrinsic width/height (or canvas.width/height).
function adjustCanvasDisplaySize(imgW, imgH) {
  const minDisplayWidth = 300; // don't let the displayed canvas get narrower than this
  if (imgW <= 0 || imgH <= 0) return;
  if (imgW < minDisplayWidth) {
    const scale = minDisplayWidth / imgW;
    canvas.style.width = Math.round(imgW * scale) + 'px';
    canvas.style.height = Math.round(imgH * scale) + 'px';
  } else {
    // reset any previous scaling
    canvas.style.width = imgW + 'px';
    canvas.style.height = imgH + 'px';
  }
}

// Fit the canvas to the fullscreen window while preserving aspect ratio.
function fitCanvasToScreen() {
  if (!canvas) return;
  const cw = canvas.width;
  const ch = canvas.height;
  if (!cw || !ch) return;
  const scale = Math.min(window.innerWidth / cw, window.innerHeight / ch);
  canvas.style.width = Math.round(cw * scale) + 'px';
  canvas.style.height = Math.round(ch * scale) + 'px';
}

function isFullScreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
}

function enterFullScreen() {
  if (canvas.requestFullscreen) canvas.requestFullscreen();
  else if (canvas.webkitRequestFullscreen) canvas.webkitRequestFullscreen();
  else if (canvas.mozRequestFullScreen) canvas.mozRequestFullScreen();
  else if (canvas.msRequestFullscreen) canvas.msRequestFullscreen();
  // fit once entering fullscreen (will also be called on fullscreenchange)
  setTimeout(fitCanvasToScreen, 50);
}

function exitFullScreen() {
  if (document.exitFullscreen) document.exitFullscreen();
  else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  else if (document.mozCancelFullScreen) document.mozCancelFullScreen();
  else if (document.msExitFullscreen) document.msExitFullscreen();
}

function toggleFullScreen() {
  if (isFullScreen()) exitFullScreen();
  else enterFullScreen();
}

function updateFullscreenButton() {
  const btn = document.getElementById('fullscreenToggle');
  if (!btn) return;
  if (isFullScreen()) btn.textContent = 'Exit fullscreen';
  else btn.textContent = 'Enter fullscreen';
}

// keep button label in sync when user exits with ESC or other means
document.addEventListener('fullscreenchange', () => {
  if (isFullScreen()) fitCanvasToScreen();
  else adjustCanvasDisplaySize(canvas.width, canvas.height);
  updateFullscreenButton();
});

// Export the current canvas content as a JPEG and trigger a download.
function exportCanvasAsJpeg() {
  try {
    const qualityEl = document.getElementById('exportQuality');
    let q = 0.92;
    if (qualityEl) {
      const parsed = parseFloat(qualityEl.value);
      if (!isNaN(parsed)) q = Math.max(0.1, Math.min(1, parsed));
    }

    // toDataURL will use the internal canvas resolution (good) and produce JPEG data.
    const dataUrl = canvas.toDataURL('image/jpeg', q);
    // Create a temporary link to download the image
    const a = document.createElement('a');
    const name = `canvas-export-${Date.now()}.jpg`;
    a.href = dataUrl;
    a.download = name;
    // append to DOM to make click work in some browsers
    document.body.appendChild(a);
    a.click();
    // cleanup
    document.body.removeChild(a);
    showProgress(`Exported ${name} (quality=${q})`);
  } catch (err) {
    console.error('Failed to export canvas as JPEG:', err);
    showProgress('Error exporting JPEG. See console for details.');
  }
}

// Wait for the image to load before drawing and reading pixels.
imagee.onload = function () {
  // Make the canvas match the image size so coordinates align.
  canvas.width = imagee.width;
  canvas.height = imagee.height;

  // adjust displayed canvas size for small images
  adjustCanvasDisplaySize(imagee.width, imagee.height);

  ctx.drawImage(imagee, 0, 0);
  try {
    const Imagedata = ctx.getImageData(0, 0, canvas.width, canvas.height);
    data = Imagedata.data;
      // Precompute dominant-color lists for the 'dominant' mode
      dominantLists = { red: [], green: [], blue: [] };
      const totalPixels = Math.floor(data.length / 4);
      for (let p = 0; p < totalPixels; p++) {
        const bi = p * 4;
        const r = data[bi];
        const g = data[bi + 1];
        const b = data[bi + 2];
        if (r >= g && r >= b) dominantLists.red.push(p);
        else if (g >= r && g >= b) dominantLists.green.push(p);
        else dominantLists.blue.push(p);
      }
  // compute palette clusters (number from UI, default 20)
  const k = parseInt(paletteCountEl()?.value || 20, 10) || 20;
  computePaletteClusters(k);
  // build linear index order (possibly randomized)
  buildIndexOrder();
  // prepare cluster and dominant ordering. clusterOrder controls which cluster
  // index is used for each pass (so we can draw clusters in random sequence).
  if (clusterLists) {
    clusterOrder = new Array(clusterLists.length);
    for (let ci = 0; ci < clusterLists.length; ci++) clusterOrder[ci] = ci;
    if (randomOrderEl()?.checked) shuffleArray(clusterOrder);
    // optionally shuffle pixels inside each cluster too
    if (randomOrderEl()?.checked) clusterLists.forEach(list => shuffleArray(list));
  }
  // prepare dominant pass order
  dominantOrder = [0, 1, 2];
  if (randomOrderEl()?.checked) shuffleArray(dominantOrder);
  } catch (err) {
    console.error('Failed to read image pixel data (canvas tainted):', err);
    showProgress('Error: canvas was tainted by a cross-origin image. Make sure the image is served from the same origin or that the image server sets Access-Control-Allow-Origin headers.');
    setStartEnabled(false);
    // We can't proceed when getImageData fails — exit gracefully.
    return;
  }

  // leave the canvas showing the image as a preview; enable Start button
  // reset state for a fresh print
  i = 0;
  dominantPass = 0;
  dominantPos = 0;
  clusterPass = 0;
  clusterPos = 0;
  syncControls();
  setStartEnabled(true);
  showProgress(`Image loaded: ${imagee.width}x${imagee.height}. Click Start printing to begin.`);
};

imagee.onerror = function () {
  showProgress('Failed to load image. Check the URL and CORS settings.');
  setStartEnabled(false);
};

function printer2d() {
  if (!data) return; // safety guard

  // read control values (allow user to change during runtime)
  const pixelsPerFrame = parseInt(pixelsPerFrameEl()?.value || 10, 10) || 1;
  const frameDelay = parseInt(frameDelayEl()?.value || 50, 10) || 50;
  const mode = colorModeEl()?.value || 'full';

  // Special handling for palette mode: draw only from the current cluster during this frame
  if (mode === 'palette' && clusterLists) {
    if (clusterPass >= clusterLists.length) {
      console.log('printer2d: complete (palette)');
      return;
    }
    const clusterIdx = clusterOrder ? clusterOrder[clusterPass] : clusterPass;
    const currentList = clusterLists[clusterIdx];
    const remaining = currentList.length - clusterPos;
    if (remaining <= 0) {
      // move to next cluster and finish this frame
      clusterPass++;
      clusterPos = 0;
      // if user wants the canvas cleared between clusters, do it now so next cluster appears alone
      if (clearBetweenEl()?.checked) ctx.clearRect(0, 0, canvas.width, canvas.height);
      // do not proceed to next cluster in the same frame
    } else {
      const toDraw = Math.min(pixelsPerFrame, remaining);
      for (let j = 0; j < toDraw; j++) {
        const pixelIndex = currentList[clusterPos];
        const bi = pixelIndex * 4;
        const center = clusterCenters && clusterCenters[clusterIdx] ? clusterCenters[clusterIdx] : [data[bi], data[bi + 1], data[bi + 2]];
        const x = pixelIndex % canvas.width;
        const y = Math.floor(pixelIndex / canvas.width);
        ctx.fillStyle = `rgb(${center[0]}, ${center[1]}, ${center[2]})`;
        ctx.fillRect(x, y, 1, 1);
        clusterPos++;
      }
    }
    // enable/disable Next button appropriately
    if (nextClusterBtn()) nextClusterBtn().disabled = false;
  } else {
    for (let p = 0; p < pixelsPerFrame; p++) {
      if (mode === 'dominant' && dominantLists) {
        // if all passes done, complete
        if (dominantPass >= (dominantOrder ? dominantOrder.length : 3)) {
          console.log('printer2d: complete (dominant)');
          return;
        }
        const actualPass = dominantOrder ? dominantOrder[dominantPass] : dominantPass;
        const currentList = actualPass === 0 ? dominantLists.red : actualPass === 1 ? dominantLists.green : dominantLists.blue;
        if (dominantPos >= currentList.length) {
          // move to next pass
          dominantPass++;
          dominantPos = 0;
          if (dominantPass >= (dominantOrder ? dominantOrder.length : 3)) {
            console.log('printer2d: complete (dominant)');
            return;
          }
          continue; // proceed to next iteration to handle new pass
        }

        const pixelIndex = currentList[dominantPos];
        const bi = pixelIndex * 4;
        const r = data[bi];
        const g = data[bi + 1];
        const b = data[bi + 2];
        const x = pixelIndex % canvas.width;
        const y = Math.floor(pixelIndex / canvas.width);

        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillRect(x, y, 1, 1);

        dominantPos++;
      } else {
        // linear modes: full color or single channel
        // support optional randomized order via indexOrder
        const totalPixels = Math.floor(data.length / 4);
        // if we have an indexOrder, use it; otherwise fall back to sequential i
        if (indexOrder) {
          if (indexOrderPos >= indexOrder.length) {
            console.log('printer2d: complete');
            return;
          }
          const pixelIndex = indexOrder[indexOrderPos];
          const bi = pixelIndex * 4;
          const r = data[bi];
          const g = data[bi + 1];
          const b = data[bi + 2];
          const x = pixelIndex % canvas.width;
          const y = Math.floor(pixelIndex / canvas.width);

          if (mode === 'red') ctx.fillStyle = `rgb(${r},0,0)`;
          else if (mode === 'green') ctx.fillStyle = `rgb(0,${g},0)`;
          else if (mode === 'blue') ctx.fillStyle = `rgb(0,0,${b})`;
          else ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;

          ctx.fillRect(x, y, 1, 1);
          indexOrderPos++;
        } else {
          // if we've consumed all data, stop
          if (i >= data.length) {
            console.log('printer2d: complete');
            return;
          }

          // each pixel has 4 bytes (r,g,b,a)
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const pixelIndex = Math.floor(i / 4);
          const x = pixelIndex % canvas.width;
          const y = Math.floor(pixelIndex / canvas.width);

          if (mode === 'red') ctx.fillStyle = `rgb(${r},0,0)`;
          else if (mode === 'green') ctx.fillStyle = `rgb(0,${g},0)`;
          else if (mode === 'blue') ctx.fillStyle = `rgb(0,0,${b})`;
          else ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;

          ctx.fillRect(x, y, 1, 1);

          i += 4; // advance by one pixel (4 bytes)
        }
      }
    }
  }

  // update progress
  if (progressEl()) {
    const mode = colorModeEl()?.value || 'full';
    const total = Math.floor(data.length / 4);
    let printed = 0;
    if (mode === 'dominant' && dominantLists) {
      const domLists = [dominantLists.red, dominantLists.green, dominantLists.blue];
      const passesDone = Math.max(0, Math.min(dominantPass, domLists.length));
      let doneCount = 0;
      for (let pj = 0; pj < passesDone; pj++) {
        const actual = dominantOrder ? dominantOrder[pj] : pj;
        doneCount += (domLists[actual] ? domLists[actual].length : 0);
      }
      const currentPassProgress = (dominantPass < domLists.length ? dominantPos : 0);
      printed = doneCount + currentPassProgress;
    } else if (mode === 'palette' && clusterLists) {
      // count clusters done plus current cluster progress
      let doneCount = 0;
      for (let ci = 0; ci < clusterPass; ci++) {
        const idx = clusterOrder ? clusterOrder[ci] : ci;
        doneCount += (clusterLists[idx] ? clusterLists[idx].length : 0);
      }
      const currentPassProgress = (clusterPass < clusterLists.length ? clusterPos : 0);
      printed = doneCount + currentPassProgress;
    } else {
      // if randomized order is used, report progress by indexOrderPos
      if (indexOrder) printed = indexOrderPos;
      else printed = Math.floor(i / 4);
    }
    const pct = Math.floor((printed / total) * 100);
    progressEl().textContent = `printed ${printed}/${total} (${pct}%)`;
  }

  // continue on next frame using configured delay
  setTimeout(printer2d, frameDelay);
}

// Load button handler — load image from provided URL and enable Start on success
function loadImageFromUrl(url) {
  if (!url) {
    showProgress('Please enter an image URL.');
    return;
  }

  // create a fresh Image to ensure onload fires reliably
  imagee = new Image();
  imagee.crossOrigin = 'Anonymous';
  imagee.onload = function () {
    // Make the canvas match the image size so coordinates align.
    canvas.width = imagee.width;
    canvas.height = imagee.height;

    // If the image is very small, scale the displayed canvas (CSS) so it's easier to see
    // without changing the internal pixel buffer (keeps drawing math the same).
    adjustCanvasDisplaySize(imagee.width, imagee.height);

    ctx.drawImage(imagee, 0, 0);
    try {
      const Imagedata = ctx.getImageData(0, 0, canvas.width, canvas.height);
      data = Imagedata.data;
      // Precompute dominant-color lists for the 'dominant' mode
      dominantLists = { red: [], green: [], blue: [] };
      const totalPixels = Math.floor(data.length / 4);
      for (let p = 0; p < totalPixels; p++) {
        const bi = p * 4;
        const r = data[bi];
        const g = data[bi + 1];
        const b = data[bi + 2];
        if (r >= g && r >= b) dominantLists.red.push(p);
        else if (g >= r && g >= b) dominantLists.green.push(p);
        else dominantLists.blue.push(p);
      }
      // compute palette clusters (number from UI, default 20)
      const k = parseInt(paletteCountEl()?.value || 20, 10) || 20;
      computePaletteClusters(k);
        // build linear index order (possibly randomized)
        buildIndexOrder();
        // prepare cluster and dominant ordering for palette/dominant modes
        if (clusterLists) {
          clusterOrder = new Array(clusterLists.length);
          for (let ci = 0; ci < clusterLists.length; ci++) clusterOrder[ci] = ci;
          if (randomOrderEl()?.checked) shuffleArray(clusterOrder);
          if (randomOrderEl()?.checked) clusterLists.forEach(list => shuffleArray(list));
        }
        dominantOrder = [0, 1, 2];
        if (randomOrderEl()?.checked) shuffleArray(dominantOrder);
    } catch (err) {
      console.error('Failed to read image pixel data (canvas tainted):', err);
      showProgress('Error: canvas was tainted by a cross-origin image. Make sure the image is served from the same origin or that the image server sets Access-Control-Allow-Origin headers.');
      setStartEnabled(false);
      return;
    }

    // leave the canvas showing the image as a preview; enable Start button
  // reset state for a fresh print
  i = 0;
  dominantPass = 0;
  dominantPos = 0;
  syncControls();
    setStartEnabled(true);
    showProgress(`Image loaded: ${imagee.width}x${imagee.height}. Click Start printing to begin.`);
  };
  imagee.onerror = function () {
    showProgress('Failed to load image. Check the URL and CORS settings.');
    setStartEnabled(false);
  };

  // start loading
  showProgress('Loading image...');
  setStartEnabled(false);
  imagee.src = url;
}

// Start button handler — confirm then begin printing
function startPrintingWithConfirmation() {
  if (!data) {
    showProgress('No image loaded to print.');
    return;
  }
  const confirmed = window.confirm('Start printing the loaded image? This will clear the preview and begin the animation.');
  if (!confirmed) return;

  // clear canvas and reset index then begin
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  i = 0;
  dominantPass = 0;
  dominantPos = 0;
  clusterPass = 0;
  clusterPos = 0;
  // rebuild index order to respect current random setting and reset position
  buildIndexOrder();
  // rebuild cluster/dominant ordering to respect current random setting
  if (clusterLists) {
    clusterOrder = new Array(clusterLists.length);
    for (let ci = 0; ci < clusterLists.length; ci++) clusterOrder[ci] = ci;
    if (randomOrderEl()?.checked) shuffleArray(clusterOrder);
    if (randomOrderEl()?.checked) clusterLists.forEach(list => shuffleArray(list));
  }
  dominantOrder = [0,1,2];
  if (randomOrderEl()?.checked) shuffleArray(dominantOrder);
  const initialDelay = parseInt(frameDelayEl()?.value || 50, 10) || 50;
  setTimeout(printer2d, initialDelay);
}

// wire up Load and Start controls after DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  syncControls();
  const loadBtn = document.getElementById('loadImage');
  const startBtn = document.getElementById('startPrint');
  const urlInput = document.getElementById('imageUrl');
  const nextBtn = document.getElementById('nextCluster');
  const randomChk = document.getElementById('randomOrder');
  const fsBtn = document.getElementById('fullscreenToggle');
  const exportBtn = document.getElementById('exportJpeg');

  if (loadBtn) loadBtn.addEventListener('click', () => loadImageFromUrl(urlInput?.value || ''));
  if (startBtn) startBtn.addEventListener('click', startPrintingWithConfirmation);
  if (nextBtn) nextBtn.addEventListener('click', () => {
    // advance to next cluster manually
    if (clusterLists && clusterPass < clusterLists.length) {
      clusterPass++;
      clusterPos = 0;
      if (clearBetweenEl()?.checked) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  });
  if (randomChk) randomChk.addEventListener('change', () => {
    // rebuild index order and reshuffle clusters/dominant pass order if toggled
    buildIndexOrder();
    if (clusterLists) {
      clusterOrder = new Array(clusterLists.length);
      for (let ci = 0; ci < clusterLists.length; ci++) clusterOrder[ci] = ci;
      if (randomChk.checked) shuffleArray(clusterOrder);
      if (randomChk.checked) clusterLists.forEach(list => shuffleArray(list));
    }
    dominantOrder = [0, 1, 2];
    if (randomChk.checked) shuffleArray(dominantOrder);
  });
  if (fsBtn) {
    fsBtn.addEventListener('click', () => toggleFullScreen());
    // initialize label correctly
    updateFullscreenButton();
  }
  if (exportBtn) exportBtn.addEventListener('click', () => exportCanvasAsJpeg());
});
