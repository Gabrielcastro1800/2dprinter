const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
let imagee = new Image();
// We'll set imagee.crossOrigin and imagee.src when the user clicks Load.

let data = null;
let i = 0;

// UI elements (populated after DOM is ready)
const pixelsPerFrameEl = () => document.getElementById('pixelsPerFrame');
const pixelsPerFrameNumberEl = () => document.getElementById('pixelsPerFrameNumber');
const frameDelayEl = () => document.getElementById('frameDelay');
const frameDelayNumberEl = () => document.getElementById('frameDelayNumber');
const progressEl = () => document.getElementById('progress');

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

// Wait for the image to load before drawing and reading pixels.
imagee.onload = function () {
  // Make the canvas match the image size so coordinates align.
  canvas.width = imagee.width;
  canvas.height = imagee.height;

  ctx.drawImage(imagee, 0, 0);
  try {
    const Imagedata = ctx.getImageData(0, 0, canvas.width, canvas.height);
    data = Imagedata.data;
  } catch (err) {
    console.error('Failed to read image pixel data (canvas tainted):', err);
    showProgress('Error: canvas was tainted by a cross-origin image. Make sure the image is served from the same origin or that the image server sets Access-Control-Allow-Origin headers.');
    setStartEnabled(false);
    // We can't proceed when getImageData fails — exit gracefully.
    return;
  }

  // leave the canvas showing the image as a preview; enable Start button
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

  for (let p = 0; p < pixelsPerFrame; p++) {
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

    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fillRect(x, y, 1, 1);

    i += 4; // advance by one pixel (4 bytes)
  }

  // update progress
  if (progressEl()) {
    const printed = Math.floor(i / 4);
    const total = Math.floor(data.length / 4);
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

    ctx.drawImage(imagee, 0, 0);
    try {
      const Imagedata = ctx.getImageData(0, 0, canvas.width, canvas.height);
      data = Imagedata.data;
    } catch (err) {
      console.error('Failed to read image pixel data (canvas tainted):', err);
      showProgress('Error: canvas was tainted by a cross-origin image. Make sure the image is served from the same origin or that the image server sets Access-Control-Allow-Origin headers.');
      setStartEnabled(false);
      return;
    }

    // leave the canvas showing the image as a preview; enable Start button
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
  const initialDelay = parseInt(frameDelayEl()?.value || 50, 10) || 50;
  setTimeout(printer2d, initialDelay);
}

// wire up Load and Start controls after DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  syncControls();
  const loadBtn = document.getElementById('loadImage');
  const startBtn = document.getElementById('startPrint');
  const urlInput = document.getElementById('imageUrl');

  if (loadBtn) loadBtn.addEventListener('click', () => loadImageFromUrl(urlInput?.value || ''));
  if (startBtn) startBtn.addEventListener('click', startPrintingWithConfirmation);
});
