/**
 * Client-side ML vision detector using YOLOv8-pose via ONNX Runtime Web.
 * Accurate multi-person pose detection + keypoints.
 * Runs on WebGPU when available (falls back to CPU WASM).
 */

import jsepMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url';
import jsepWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url';
import wasmMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import wasmWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';

const INPUT_SIZE = 640;
const CONF_THRESHOLD = 0.45;
const IOU_THRESHOLD = 0.50;
const LETTERBOX_COLOR = 114;

const COCO_KEYPOINTS = [
  'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear',
  'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist', 'left_hip', 'right_hip',
  'left_knee', 'right_knee', 'left_ankle', 'right_ankle'
];

const SKELETON = [
  [0, 1], [0, 2], [1, 3], [2, 4],
  [5, 6], [5, 7], [7, 9], [6, 8], [8, 10],
  [5, 11], [6, 12], [11, 12],
  [11, 13], [12, 14], [13, 15], [14, 16]
];

let session = null;
let initPromise = null;
let backend = null;
let ortRef = null;
let _canvas = null;
let _ctx = null;

export async function initDetector(onProgress) {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const webgpuSupported = typeof navigator !== 'undefined' && !!navigator.gpu;
    if (webgpuSupported) {
      try {
        const ort = await import('onnxruntime-web/webgpu');
        ortRef = ort;
        ort.env.wasm.numThreads = 1;
        ort.env.wasm.wasmPaths = { mjs: jsepMjsUrl, wasm: jsepWasmUrl };
        onProgress?.('Loading YOLOv8-pose model on WebGPU…');
        session = await ort.InferenceSession.create('/yolov8n-pose.onnx', {
          executionProviders: ['webgpu', 'wasm'],
          graphOptimizationLevel: 'all'
        });
        backend = 'webgpu';
      } catch (e) {
        session = null;
        backend = null;
        onProgress?.('WebGPU unavailable (' + (e && e.message) + '), falling back to CPU…');
      }
    }
    if (!session) {
      const ort = await import('onnxruntime-web/wasm');
      ortRef = ort;
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.wasmPaths = { mjs: wasmMjsUrl, wasm: wasmWasmUrl };
      onProgress?.('Loading YOLOv8-pose model (CPU WASM)…');
      session = await ort.InferenceSession.create('/yolov8n-pose.onnx', {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all'
      });
      backend = 'wasm';
    }
    onProgress?.('YOLOv8-pose model loaded on ' + backend + '.');
  })();
  return initPromise;
}

export function isReady() {
  return session !== null;
}

export function getBackend() {
  return backend;
}

function preprocess(element) {
  if (!_canvas) {
    _canvas = document.createElement('canvas');
    _canvas.width = INPUT_SIZE;
    _canvas.height = INPUT_SIZE;
    _ctx = _canvas.getContext('2d');
  }

  const imgW = element.videoWidth || element.naturalWidth || element.width;
  const imgH = element.videoHeight || element.naturalHeight || element.height;

  _ctx.fillStyle = `rgb(${LETTERBOX_COLOR},${LETTERBOX_COLOR},${LETTERBOX_COLOR})`;
  _ctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);

  const ratio = Math.min(INPUT_SIZE / imgW, INPUT_SIZE / imgH);
  const newW = Math.round(imgW * ratio);
  const newH = Math.round(imgH * ratio);
  const padX = (INPUT_SIZE - newW) / 2;
  const padY = (INPUT_SIZE - newH) / 2;

  _ctx.drawImage(element, padX, padY, newW, newH);

  const imageData = _ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
  const data = imageData.data;
  const rgb = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
  for (let i = 0; i < INPUT_SIZE * INPUT_SIZE; i++) {
    rgb[i] = data[i * 4] / 255.0;
    rgb[INPUT_SIZE * INPUT_SIZE + i] = data[i * 4 + 1] / 255.0;
    rgb[2 * INPUT_SIZE * INPUT_SIZE + i] = data[i * 4 + 2] / 255.0;
  }
  return { rgb, ratio, padX, padY };
}

function iou(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

function nms(detections) {
  const sorted = detections.sort((a, b) => b.score - a.score);
  const keep = [];
  const used = new Set();
  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue;
    keep.push(sorted[i]);
    for (let j = i + 1; j < sorted.length; j++) {
      if (used.has(j)) continue;
      if (iou(sorted[i], sorted[j]) > IOU_THRESHOLD) used.add(j);
    }
  }
  return keep;
}

function postprocess(output, imgW, imgH, ratio, padX, padY) {
  const numDetections = 8400;
  const detections = [];

  for (let i = 0; i < numDetections; i++) {
    const objScore = output[4 * numDetections + i];
    if (objScore < CONF_THRESHOLD) continue;

    const cx = output[i];
    const cy = output[numDetections + i];
    const w = output[2 * numDetections + i];
    const h = output[3 * numDetections + i];

    const x1 = (cx - w / 2 - padX) / ratio;
    const y1 = (cy - h / 2 - padY) / ratio;
    const bw = w / ratio;
    const bh = h / ratio;

    if (x1 + bw < 0 || y1 + bh < 0 || x1 > imgW || y1 > imgH) continue;

    const keypoints = [];
    for (let k = 0; k < 17; k++) {
      const kx = (output[(5 + k * 3) * numDetections + i] - padX) / ratio;
      const ky = (output[(5 + k * 3 + 1) * numDetections + i] - padY) / ratio;
      const kconf = output[(5 + k * 3 + 2) * numDetections + i];
      keypoints.push({ x: kx, y: ky, score: kconf, name: COCO_KEYPOINTS[k] });
    }

    detections.push({
      x: Math.max(0, x1), y: Math.max(0, y1), w: bw, h: bh,
      score: objScore, keypoints
    });
  }

  return nms(detections);
}

function isHandRaised(keypoints) {
  const find = (name) => keypoints.find((k) => k.name === name);
  const lw = find('left_wrist');
  const rw = find('right_wrist');
  const ls = find('left_shoulder');
  const rs = find('right_shoulder');
  if (!ls || !rs || ls.score < 0.3 || rs.score < 0.3) return false;
  const shoulderY = (ls.y + rs.y) / 2;
  if (lw && lw.score > 0.3 && lw.y < shoulderY - 30) return true;
  if (rw && rw.score > 0.3 && rw.y < shoulderY - 30) return true;
  return false;
}

function getPoseLabel(keypoints) {
  const find = (name) => keypoints.find((k) => k.name === name);
  const ls = find('left_shoulder');
  const rs = find('right_shoulder');
  const lh = find('left_hip');
  const rh = find('right_hip');
  const lk = find('left_knee');
  const rk = find('right_knee');
  if (!ls || !rs || !lh || !rh || ls.score < 0.3 || rs.score < 0.3) return 'unknown';
  const torsoLen = Math.hypot((ls.x + rs.x) / 2 - (lh.x + rh.x) / 2, (ls.y + rs.y) / 2 - (lh.y + rh.y) / 2);
  if (lk && rk && lk.score > 0.3 && rk.score > 0.3) {
    const kneeY = (lk.y + rk.y) / 2;
    const hipY = (lh.y + rh.y) / 2;
    if (kneeY > hipY + torsoLen * 1.2) return 'sitting';
  }
  return 'standing';
}

export async function detectFrame(mediaElement, timestampMs) {
  if (!session) return { persons: [], frame: { width: 0, height: 0 }, ms: 0, backend: null };
  const t0 = performance.now();

  const imgW = mediaElement.videoWidth || mediaElement.naturalWidth || mediaElement.width;
  const imgH = mediaElement.videoHeight || mediaElement.naturalHeight || mediaElement.height;
  if (!imgW || !imgH) return { persons: [], frame: { width: 0, height: 0 }, ms: 0, backend: null };

  const { rgb, ratio, padX, padY } = preprocess(mediaElement);
  const inputTensor = new ortRef.Tensor('float32', rgb, [1, 3, INPUT_SIZE, INPUT_SIZE]);

  const inputName = session.inputNames[0];
  const results = await session.run({ [inputName]: inputTensor });
  const outputName = session.outputNames[0];
  const outputData = results[outputName].data;

  const detections = postprocess(outputData, imgW, imgH, ratio, padX, padY);

  const persons = detections.map((det, i) => ({
    id: `P${i}`,
    bbox: {
      x: Math.max(0, det.x / imgW),
      y: Math.max(0, det.y / imgH),
      w: Math.min(1, det.w / imgW),
      h: Math.min(1, det.h / imgH)
    },
    confidence: det.score,
    pose: { landmarks: det.keypoints, label: getPoseLabel(det.keypoints) },
    raisedHand: isHandRaised(det.keypoints)
  }));

  return { persons, frame: { width: imgW, height: imgH }, ms: Math.round(performance.now() - t0), backend };
}

export function drawOverlays(ctx, canvasW, canvasH, detection) {
  ctx.clearRect(0, 0, canvasW, canvasH);
  if (!detection || !detection.persons) return;

  for (const person of detection.persons) {
    const b = person.bbox;
    ctx.strokeStyle = '#ffd43b';
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x * canvasW, b.y * canvasH, b.w * canvasW, b.h * canvasH);
    ctx.fillStyle = 'rgba(255,212,59,0.08)';
    ctx.fillRect(b.x * canvasW, b.y * canvasH, b.w * canvasW, b.h * canvasH);

    ctx.fillStyle = 'rgba(255,212,59,0.9)';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.fillText(`${person.id} ${Math.round(person.confidence * 100)}%`, b.x * canvasW + 4, b.y * canvasH - 4);

    if (person.pose && person.pose.landmarks) {
      const kps = person.pose.landmarks;
      ctx.strokeStyle = 'rgba(34,197,94,0.7)';
      ctx.lineWidth = 1.5;
      for (const [a, b2] of SKELETON) {
        const ka = kps[a];
        const kb = kps[b2];
        if (!ka || !kb || ka.score < 0.3 || kb.score < 0.3) continue;
        ctx.beginPath();
        ctx.moveTo(ka.x, ka.y);
        ctx.lineTo(kb.x, kb.y);
        ctx.stroke();
      }
      for (const kp of kps) {
        if (kp.score < 0.3) continue;
        ctx.fillStyle = '#22c55e';
        ctx.beginPath();
        ctx.arc(kp.x, kp.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      const sideLabels = [
        ['left_wrist', 'L'], ['right_wrist', 'R'],
        ['left_shoulder', 'L'], ['right_shoulder', 'R']
      ];
      ctx.font = 'bold 11px system-ui, sans-serif';
      for (const [name, ch] of sideLabels) {
        const kp = kps.find((k) => k.name === name);
        if (!kp || kp.score < 0.3) continue;
        ctx.fillStyle = 'rgba(248,113,113,0.95)';
        ctx.fillText(ch, kp.x + 4, kp.y - 5);
      }
    }

    if (person.raisedHand) {
      const rx = (b.x + b.w) * canvasW - 4;
      const ry = b.y * canvasH;
      ctx.fillStyle = 'rgba(18,184,134,0.9)';
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.fillText('\u270B', rx - 16, ry + 16);
    }
  }
}
