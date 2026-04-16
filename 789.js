const express = require('express');
const router = express.Router();
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const HISTORY_DIR = path.join(__dirname, '../data/history');
const LEARNING_FILE = path.join(HISTORY_DIR, 'learning_data_789.json');
const HISTORY_FILE = path.join(HISTORY_DIR, 'prediction_history_789.json');
const EXTERNAL_HISTORY_FILE = path.join(HISTORY_DIR, 'external_history_789.json');

if (!fs.existsSync(HISTORY_DIR)) {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
}

let predictionHistory = { b52: [] };
let externalHistory = [];
const MIN_HISTORY_FOR_PREDICTION = 10;
const MAX_HISTORY = 100;
const AUTO_SAVE_INTERVAL = 30000;
let lastProcessedPhien = { b52: null };

let learningData = {
  b52: {
    predictions: [],
    patternStats: {},
    totalPredictions: 0,
    correctPredictions: 0,
    patternWeights: {},
    lastUpdate: null,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    adaptiveThresholds: {},
    recentAccuracy: [],
    reversalState: {
      active: false,
      activatedAt: null,
      consecutiveLosses: 0,
      reversalCount: 0,
      lastReversalResult: null
    },
    transitionMatrix: {
      'Tài->Tài': 0, 'Tài->Xỉu': 0,
      'Xỉu->Tài': 0, 'Xỉu->Xỉu': 0
    }
  }
};

const DEFAULT_PATTERN_WEIGHTS = {
  'cau_bet': 1.3, 'cau_dao_11': 1.2, 'cau_22': 1.15, 'cau_33': 1.2,
  'cau_121': 1.1, 'cau_123': 1.1, 'cau_321': 1.1, 'cau_nhay_coc': 1.0,
  'cau_nhip_nghieng': 1.15, 'cau_3van1': 1.2, 'cau_be_cau': 1.25,
  'cau_chu_ky': 1.1, 'distribution': 0.9, 'dice_pattern': 1.0,
  'sum_trend': 1.05, 'edge_cases': 1.1, 'momentum': 1.15,
  'cau_tu_nhien': 0.8, 'dice_trend_line': 1.2, 'break_pattern': 1.3,
  'fibonacci': 1.0, 'resistance_support': 1.15, 'wave': 1.1,
  'golden_ratio': 1.0, 'day_gay': 1.25, 'cau_44': 1.2, 'cau_55': 1.25,
  'cau_212': 1.1, 'cau_1221': 1.15, 'cau_2112': 1.15, 'cau_gap': 1.1,
  'cau_ziczac': 1.2, 'cau_doi': 1.15, 'cau_rong': 1.3, 'smart_bet': 1.2,
  'markov_chain': 1.35, 'moving_avg_drift': 1.2, 'sum_pressure': 1.25,
  'volatility': 1.15, 'sun_hot_cold': 1.3, 'sun_streak_break': 1.35,
  'sun_balance': 1.2, 'sun_momentum_shift': 1.25
};

const REVERSAL_THRESHOLD = 3;

const WS_URL = "wss://websocket.atpman.net/websocket";
const WS_HEADERS = {
  "Host": "websocket.atpman.net",
  "Origin": "https://i.789.club",
  "User-Agent": "Mozilla/5.0"
};

const LOGIN_MESSAGE = [
  1, "MiniGame", "nhaydz", "Nhaydz123@",
  {
    "info": "{\"ipAddress\":\"2401:d800:25e0:b867:54df:30fe:4fed:4685\",\"wsToken\":\"eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJ6eWFoIiwiYm90IjowLCJpc01lcmNoYW50IjpmYWxzZSwidmVyaWZpZWRCYW5rQWNjb3VudCI6ZmFsc2UsInBsYXlFdmVudExvYmJ5IjpmYWxzZSwiY3VzdG9tZXJJZCI6NjM5OTk4NTgsImFmZklkIjoiY29tLmRyYXcubGVnIiwiYmFubmVkIjpmYWxzZSwiYnJhbmQiOiI3ODkuY2x1YiIsInRpbWVzdGFtcCI6MTc2NDEzOTIyOTkxNiwibG9ja0dhbWVzIjpbXSwiYW1vdW50IjowLCJsb2NrQ2hhdCI6ZmFsc2UsInBob25lVmVyaWZpZWQiOmZhbHNlLCJpcEFkZHJlc3MiOiIyNDAxOmQ4MDA6MjVlMDpiODY3OjU0ZGY6MzBmZTo0ZmVkOjQ2ODUiLCJtdXRlIjpmYWxzZSwiYXZhdGFyIjoiaHR0cHM6Ly9hcGkueGV1aS5pby9pbWFnZXMvYXZhdGFyL2F2YXRhcl8xNi5wbmciLCJwbGF0Zm9ybUlkIjoxLCJ1c2VySWQiOiIwZWY5NmE1ZS04NTYwLTRjODMtOGQ1Zi03YmQ2NDFjZjM0NzQiLCJyZWdUaW1lIjoxNzYxNzQ1OTY5ODcxLCJwaG9uZSI6IiIsImRlcG9zaXQiOmZhbHNlLCJ1c2VybmFtZSI6IlM4X25oYXlkeiJ9.wUlpgHk1aZs4M3sgccJL_iDaIHE_f2hE9qFduqXyW6Y\",\"locale\":\"vi\",\"userId\":\"0ef96a5e-8560-4c83-8d5f-7bd641cf3474\",\"username\":\"S8_nhaydz\",\"timestamp\":1764139229917,\"refreshToken\":\"d06de2cdd4de45d7bab7c33bd7b022da.285f8df889e14e9b8d0dd3b28b17f4d8\"}",
    "signature": "4DC13AF3A5687E7177C842B611C7011B847EDCFA7EAF793D57953903AEADF5B423F0310473A12D16E3A27ABE6AEF4346887D490C9216880DA98AEBDD87865AE1174B5D25E0948203B02E4945BA0262B449AD5022658CCECCFF2C93C66E4205F7F774C5E1C66DA48380AE7ACEB5774339559818D9960002856DE2C6374D2A0B7C"
  }
];

const SUBSCRIBE_TX_RESULT = [6, "MiniGame", "taixiuUnbalancedPlugin", { cmd: 2000 }];
const SUBSCRIBE_LOBBY = [6, "MiniGame", "lobbyPlugin", { cmd: 10001 }];

let ws = null;
let pingInterval = null;
let reconnectTimeout = null;
let lastEventId = 19;
let wsConnected = false;

function loadExternalHistory() {
  try {
    if (fs.existsSync(EXTERNAL_HISTORY_FILE)) {
      const data = fs.readFileSync(EXTERNAL_HISTORY_FILE, 'utf8');
      externalHistory = JSON.parse(data);
      console.log(`[789] External history loaded: ${externalHistory.length} records`);
    }
  } catch (error) {
    console.error('[789] Error loading external history:', error.message);
    externalHistory = [];
  }
}

function saveExternalHistory() {
  try {
    fs.writeFileSync(EXTERNAL_HISTORY_FILE, JSON.stringify(externalHistory, null, 2));
  } catch (error) {
    console.error('[789] Error saving external history:', error.message);
  }
}

function loadLearningData() {
  try {
    if (fs.existsSync(LEARNING_FILE)) {
      const data = fs.readFileSync(LEARNING_FILE, 'utf8');
      const parsed = JSON.parse(data);
      if (parsed.b52) {
        learningData = { ...learningData, ...parsed };
      }
      console.log('[789] Learning data loaded successfully');
    }
  } catch (error) {
    console.error('[789] Error loading learning data:', error.message);
  }
}

function saveLearningData() {
  try {
    fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2));
  } catch (error) {
    console.error('[789] Error saving learning data:', error.message);
  }
}

function loadPredictionHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = fs.readFileSync(HISTORY_FILE, 'utf8');
      const parsed = JSON.parse(data);
      predictionHistory = parsed.history || { b52: [] };
      lastProcessedPhien = parsed.lastProcessedPhien || { b52: null };
      console.log('[789] Prediction history loaded successfully');
      console.log(`  - 789: ${predictionHistory.b52?.length || 0} records`);
    }
  } catch (error) {
    console.error('[789] Error loading prediction history:', error.message);
  }
}

function savePredictionHistory() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({
      history: predictionHistory,
      lastProcessedPhien
    }, null, 2));
  } catch (error) {
    console.error('[789] Error saving prediction history:', error.message);
  }
}

function startAutoSaveTask() {
  setInterval(() => {
    saveLearningData();
    savePredictionHistory();
    saveExternalHistory();
  }, AUTO_SAVE_INTERVAL);
  console.log('[789] Auto-save task started (every 30s)');
}

function connectWebSocket() {
  if (ws) {
    ws.removeAllListeners();
    try { ws.close(); } catch (e) {}
  }

  console.log('[789] Connecting to WebSocket...');
  
  try {
    ws = new WebSocket(WS_URL, { headers: WS_HEADERS });

    ws.on('open', () => {
      console.log('[789] ✅ WebSocket connected');
      wsConnected = true;
      ws.send(JSON.stringify(LOGIN_MESSAGE));

      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(SUBSCRIBE_TX_RESULT));
          ws.send(JSON.stringify(SUBSCRIBE_LOBBY));
        }
      }, 1000);

      clearInterval(pingInterval);
      pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send("2");
          ws.send(JSON.stringify(SUBSCRIBE_TX_RESULT));
          ws.send(JSON.stringify([7, "Simms", lastEventId, 0, { id: 0 }]));
        }
      }, 10000);
    });

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());

        if (Array.isArray(data)) {
          if (data.length >= 3 && data[0] === 7 && data[1] === "Simms" && typeof data[2] === 'number') {
            lastEventId = data[2];
          }

          if (typeof data[1] === 'object' && data[1]?.cmd === 2006) {
            const { sid, d1, d2, d3 } = data[1];
            if (sid && d1 !== undefined && d2 !== undefined && d3 !== undefined) {
              const tong = d1 + d2 + d3;
              const ketqua = tong >= 11 ? "Tài" : "Xỉu";

              const result = {
                Phien: sid,
                Xuc_xac_1: d1,
                Xuc_xac_2: d2,
                Xuc_xac_3: d3,
                Tong: tong,
                Ket_qua: ketqua,
                timestamp: Date.now()
              };

              const exists = externalHistory.find(h => h.Phien === sid);
              if (!exists) {
                externalHistory.unshift(result);
                if (externalHistory.length > MAX_HISTORY) {
                  externalHistory = externalHistory.slice(0, MAX_HISTORY);
                }
                console.log(`[789] 🎲 Phiên ${sid}: ${d1}-${d2}-${d3} = ${tong} (${ketqua})`);
                saveExternalHistory();
              }
            }
          }
        }
      } catch (e) {}
    });

    ws.on('close', () => {
      console.log('[789] 🔌 WebSocket closed. Reconnecting in 5s...');
      wsConnected = false;
      clearInterval(pingInterval);
      reconnectTimeout = setTimeout(connectWebSocket, 5000);
    });

    ws.on('error', (error) => {
      console.error('[789] ❌ WebSocket error:', error.message);
      wsConnected = false;
    });

  } catch (error) {
    console.error('[789] Failed to connect WebSocket:', error.message);
    reconnectTimeout = setTimeout(connectWebSocket, 5000);
  }
}

function normalizeResult(result) {
  if (!result) return 'Tài';
  const lower = result.toString().toLowerCase();
  if (lower.includes('tai') || lower.includes('tài') || lower === 't') return 'Tài';
  if (lower.includes('xiu') || lower.includes('xỉu') || lower === 'x') return 'Xỉu';
  return result;
}

function fetchData() {
  if (externalHistory.length === 0) return null;
  return { data: externalHistory };
}

function calculateAdvancedPrediction(data, type) {
  if (!data || data.length < MIN_HISTORY_FOR_PREDICTION) {
    return { prediction: 'Tài', confidence: 50, factors: {} };
  }

  let taiCount = 0, xiuCount = 0;
  const recentResults = data.slice(0, 20);
  
  recentResults.forEach(item => {
    const result = normalizeResult(item.Ket_qua);
    if (result === 'Tài') taiCount++;
    else xiuCount++;
  });

  const lastResults = data.slice(0, 5).map(d => normalizeResult(d.Ket_qua));
  let streak = 1;
  for (let i = 1; i < lastResults.length; i++) {
    if (lastResults[i] === lastResults[0]) streak++;
    else break;
  }

  let prediction = taiCount > xiuCount ? 'Xỉu' : 'Tài';
  let confidence = 50 + Math.abs(taiCount - xiuCount) * 2;

  if (streak >= 4) {
    prediction = lastResults[0] === 'Tài' ? 'Xỉu' : 'Tài';
    confidence += 15;
  } else if (streak >= 3) {
    confidence += 5;
  }

  const sumTrend = data.slice(0, 5).map(d => d.Tong);
  const avgSum = sumTrend.reduce((a, b) => a + b, 0) / sumTrend.length;
  if (avgSum > 12) {
    if (prediction === 'Tài') confidence += 5;
    else confidence -= 5;
  } else if (avgSum < 9) {
    if (prediction === 'Xỉu') confidence += 5;
    else confidence -= 5;
  }

  confidence = Math.min(95, Math.max(50, confidence));

  return {
    prediction,
    confidence: Math.round(confidence),
    factors: {
      taiCount,
      xiuCount,
      streak,
      avgSum: avgSum.toFixed(1)
    }
  };
}

function savePredictionToHistory(type, phien, prediction, confidence) {
  const record = {
    phien: phien.toString(),
    du_doan: normalizeResult(prediction),
    ti_le: `${confidence}%`,
    id: '@mryanhdz',
    timestamp: new Date().toISOString()
  };
  
  if (!predictionHistory[type]) predictionHistory[type] = [];
  predictionHistory[type].unshift(record);
  
  if (predictionHistory[type].length > MAX_HISTORY) {
    predictionHistory[type] = predictionHistory[type].slice(0, MAX_HISTORY);
  }
  
  return record;
}

function recordPrediction(type, phien, prediction, confidence, factors) {
  if (!learningData[type]) return;
  
  learningData[type].predictions.unshift({
    phien: phien.toString(),
    prediction: normalizeResult(prediction),
    confidence,
    factors,
    timestamp: Date.now(),
    verified: false
  });

  if (learningData[type].predictions.length > MAX_HISTORY) {
    learningData[type].predictions = learningData[type].predictions.slice(0, MAX_HISTORY);
  }
}

async function verifyPredictions(type, currentData) {
  if (!learningData[type] || !currentData || currentData.length === 0) return;

  const unverified = learningData[type].predictions.filter(p => !p.verified);
  
  for (const pred of unverified) {
    const actual = currentData.find(d => d.Phien?.toString() === pred.phien);
    if (actual) {
      const actualResult = normalizeResult(actual.Ket_qua);
      pred.verified = true;
      pred.actual = actualResult;
      pred.isCorrect = pred.prediction === actualResult;

      if (pred.isCorrect) {
        learningData[type].correctPredictions++;
        learningData[type].streakAnalysis.wins++;
        learningData[type].streakAnalysis.currentStreak = 
          learningData[type].streakAnalysis.currentStreak >= 0 
            ? learningData[type].streakAnalysis.currentStreak + 1 
            : 1;
      } else {
        learningData[type].streakAnalysis.losses++;
        learningData[type].streakAnalysis.currentStreak = 
          learningData[type].streakAnalysis.currentStreak <= 0 
            ? learningData[type].streakAnalysis.currentStreak - 1 
            : -1;
      }

      learningData[type].totalPredictions++;
      learningData[type].lastUpdate = new Date().toISOString();
    }
  }
}

router.get('/', (req, res) => {
  res.json({
    message: 'API 789 - Tài Xỉu Prediction',
    wsConnected,
    historyCount: externalHistory.length,
    canPredict: externalHistory.length >= MIN_HISTORY_FOR_PREDICTION
  });
});

router.get('/taixiu', async (req, res) => {
  try {
    if (externalHistory.length < MIN_HISTORY_FOR_PREDICTION) {
      return res.json({
        error: `Cần ít nhất ${MIN_HISTORY_FOR_PREDICTION} lịch sử để dự đoán`,
        current: externalHistory.length,
        required: MIN_HISTORY_FOR_PREDICTION,
        wsConnected,
        message: 'Đang chờ dữ liệu từ WebSocket...'
      });
    }
    
    const data = fetchData();
    if (!data || !data.data || data.data.length === 0) {
      return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    }
    
    await verifyPredictions('b52', data.data);
    
    const gameData = data.data;
    const latestPhien = gameData[0].Phien;
    const nextPhien = latestPhien + 1;
    
    const result = calculateAdvancedPrediction(gameData, 'b52');
    
    savePredictionToHistory('b52', nextPhien, result.prediction, result.confidence);
    recordPrediction('b52', nextPhien, result.prediction, result.confidence, result.factors);
    
    res.json({
      phien: nextPhien.toString(),
      du_doan: normalizeResult(result.prediction),
      ti_le: `${result.confidence}%`,
      id: '@mryanhdz'
    });
  } catch (error) {
    console.error('[789] Error:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

router.get('/taixiu/lichsu', async (req, res) => {
  res.json({
    type: '789 Tài Xỉu',
    history: externalHistory.slice(0, 20),
    total: externalHistory.length,
    wsConnected
  });
});

router.get('/stats', (req, res) => {
  const stats = learningData.b52;
  res.json({
    totalPredictions: stats.totalPredictions,
    correctPredictions: stats.correctPredictions,
    accuracy: stats.totalPredictions > 0 
      ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2) + '%'
      : 'N/A',
    streakAnalysis: stats.streakAnalysis,
    wsConnected,
    historyCount: externalHistory.length
  });
});

router.get('/ls', (req, res) => {
  res.json({
    total: externalHistory.length,
    canPredict: externalHistory.length >= MIN_HISTORY_FOR_PREDICTION,
    minRequired: MIN_HISTORY_FOR_PREDICTION,
    wsConnected,
    data: externalHistory
  });
});

loadLearningData();
loadPredictionHistory();
loadExternalHistory();
startAutoSaveTask();
connectWebSocket();

module.exports = router;
