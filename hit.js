const express = require('express');
const router = express.Router();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const HISTORY_DIR = path.join(__dirname, '../data/history');
const LEARNING_FILE = path.join(HISTORY_DIR, 'learning_data_hit.json');
const HISTORY_FILE = path.join(HISTORY_DIR, 'prediction_history_hit.json');
const EXTERNAL_HISTORY_FILE = path.join(HISTORY_DIR, 'external_history_hit.json');

if (!fs.existsSync(HISTORY_DIR)) {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
}

const API_URL_HU = 'https://jakpotgwab.geightdors.net/glms/v1/notify/taixiu?platform_id=g8&gid=vgmn_100';
const API_URL_MD5 = 'https://jakpotgwab.geightdors.net/glms/v1/notify/taixiu?platform_id=g8&gid=vgmn_101';
const POLL_INTERVAL = 5000;

let predictionHistory = { hu: [], md5: [] };
let historyHu = [];
let historyMd5 = [];
const MIN_HISTORY_FOR_PREDICTION = 10;
const MAX_HISTORY = 100;
const AUTO_SAVE_INTERVAL = 30000;
let lastProcessedPhien = { hu: null, md5: null };
let lastSidHu = null;
let lastSidMd5 = null;
let sidForTx = null;
let pollingActive = false;

let learningData = {
  hu: {
    predictions: [],
    patternStats: {},
    totalPredictions: 0,
    correctPredictions: 0,
    patternWeights: {},
    lastUpdate: null,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    adaptiveThresholds: {},
    recentAccuracy: []
  },
  md5: {
    predictions: [],
    patternStats: {},
    totalPredictions: 0,
    correctPredictions: 0,
    patternWeights: {},
    lastUpdate: null,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    adaptiveThresholds: {},
    recentAccuracy: []
  }
};

const DEFAULT_PATTERN_WEIGHTS = {
  'cau_bet': 1.0, 'cau_dao_11': 1.0, 'cau_22': 1.0, 'cau_33': 1.0,
  'cau_121': 1.0, 'cau_123': 1.0, 'cau_321': 1.0, 'cau_nhay_coc': 1.0,
  'cau_nhip_nghieng': 1.0, 'cau_3van1': 1.0, 'cau_be_cau': 1.0,
  'cau_chu_ky': 1.0, 'distribution': 1.0, 'dice_pattern': 1.0,
  'sum_trend': 1.0, 'edge_cases': 1.0, 'momentum': 1.0,
  'cau_tu_nhien': 1.0, 'dice_trend_line': 1.0, 'break_pattern': 1.0,
  'fibonacci': 1.0, 'resistance_support': 1.0, 'wave': 1.0,
  'golden_ratio': 1.0, 'day_gay': 1.0, 'cau_44': 1.0, 'cau_55': 1.0,
  'cau_212': 1.0, 'cau_1221': 1.0, 'cau_2112': 1.0, 'cau_gap': 1.0,
  'cau_ziczac': 1.0, 'cau_doi': 1.0, 'cau_rong': 1.0, 'smart_bet': 1.0
};

function getTaiXiu(d1, d2, d3) {
  const total = d1 + d2 + d3;
  return total <= 10 ? "Xỉu" : "Tài";
}

function loadExternalHistory() {
  try {
    if (fs.existsSync(EXTERNAL_HISTORY_FILE)) {
      const data = fs.readFileSync(EXTERNAL_HISTORY_FILE, 'utf8');
      const parsed = JSON.parse(data);
      historyHu = parsed.hu || [];
      historyMd5 = parsed.md5 || [];
      console.log(`[Hit] External history loaded: Hu=${historyHu.length}, MD5=${historyMd5.length}`);
    }
  } catch (error) {
    console.error('[Hit] Error loading external history:', error.message);
  }
}

function saveExternalHistory() {
  try {
    fs.writeFileSync(EXTERNAL_HISTORY_FILE, JSON.stringify({
      hu: historyHu,
      md5: historyMd5
    }, null, 2));
  } catch (error) {
    console.error('[Hit] Error saving external history:', error.message);
  }
}

function loadLearningData() {
  try {
    if (fs.existsSync(LEARNING_FILE)) {
      const data = fs.readFileSync(LEARNING_FILE, 'utf8');
      const parsed = JSON.parse(data);
      learningData = { ...learningData, ...parsed };
      console.log('[Hit] Learning data loaded successfully');
    }
  } catch (error) {
    console.error('[Hit] Error loading learning data:', error.message);
  }
}

function saveLearningData() {
  try {
    fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2));
  } catch (error) {
    console.error('[Hit] Error saving learning data:', error.message);
  }
}

function loadPredictionHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = fs.readFileSync(HISTORY_FILE, 'utf8');
      const parsed = JSON.parse(data);
      predictionHistory = parsed.history || { hu: [], md5: [] };
      lastProcessedPhien = parsed.lastProcessedPhien || { hu: null, md5: null };
      console.log('[Hit] Prediction history loaded successfully');
      console.log(`  - Hu: ${predictionHistory.hu?.length || 0} records`);
      console.log(`  - MD5: ${predictionHistory.md5?.length || 0} records`);
    }
  } catch (error) {
    console.error('[Hit] Error loading prediction history:', error.message);
  }
}

function savePredictionHistory() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({
      history: predictionHistory,
      lastProcessedPhien
    }, null, 2));
  } catch (error) {
    console.error('[Hit] Error saving prediction history:', error.message);
  }
}

function startAutoSaveTask() {
  setInterval(() => {
    saveLearningData();
    savePredictionHistory();
    saveExternalHistory();
  }, AUTO_SAVE_INTERVAL);
  console.log('[Hit] Auto-save task started (every 30s)');
}

async function pollHuData() {
  try {
    const response = await axios.get(API_URL_HU, {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    
    const data = response.data;
    if (data?.status === 'OK' && Array.isArray(data?.data)) {
      for (const game of data.data) {
        if (game.cmd === 1008) {
          sidForTx = game.sid;
        }
      }
      
      for (const game of data.data) {
        if (game.cmd === 1003) {
          const { d1, d2, d3 } = game;
          const sid = sidForTx;
          
          if (sid && sid !== lastSidHu && d1 !== undefined && d2 !== undefined && d3 !== undefined) {
            lastSidHu = sid;
            const total = d1 + d2 + d3;
            const ketqua = getTaiXiu(d1, d2, d3);
            
            const result = {
              Phien: sid,
              Xuc_xac_1: d1,
              Xuc_xac_2: d2,
              Xuc_xac_3: d3,
              Tong: total,
              Ket_qua: ketqua,
              timestamp: Date.now()
            };
            
            historyHu.unshift(result);
            if (historyHu.length > MAX_HISTORY) {
              historyHu = historyHu.slice(0, MAX_HISTORY);
            }
            console.log(`[Hit-Hu] 🎲 Phiên ${sid}: ${d1}-${d2}-${d3} = ${total} (${ketqua})`);
            saveExternalHistory();
            sidForTx = null;
          }
        }
      }
    }
  } catch (error) {
    console.error('[Hit-Hu] Error fetching data:', error.message);
  }
}

async function pollMd5Data() {
  try {
    const response = await axios.get(API_URL_MD5, {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    
    const data = response.data;
    if (data?.status === 'OK' && Array.isArray(data?.data)) {
      for (const game of data.data) {
        if (game.cmd === 2006) {
          const { sid, d1, d2, d3 } = game;
          
          if (sid && sid !== lastSidMd5 && d1 !== undefined && d2 !== undefined && d3 !== undefined) {
            lastSidMd5 = sid;
            const total = d1 + d2 + d3;
            const ketqua = getTaiXiu(d1, d2, d3);
            
            const result = {
              Phien: sid,
              Xuc_xac_1: d1,
              Xuc_xac_2: d2,
              Xuc_xac_3: d3,
              Tong: total,
              Ket_qua: ketqua,
              timestamp: Date.now()
            };
            
            historyMd5.unshift(result);
            if (historyMd5.length > MAX_HISTORY) {
              historyMd5 = historyMd5.slice(0, MAX_HISTORY);
            }
            console.log(`[Hit-MD5] 🎲 Phiên ${sid}: ${d1}-${d2}-${d3} = ${total} (${ketqua})`);
            saveExternalHistory();
          }
        }
      }
    }
  } catch (error) {
    console.error('[Hit-MD5] Error fetching data:', error.message);
  }
}

function startPolling() {
  if (pollingActive) return;
  pollingActive = true;
  
  console.log('[Hit] Starting data polling...');
  
  setInterval(async () => {
    await pollHuData();
    await pollMd5Data();
  }, POLL_INTERVAL);
  
  pollHuData();
  pollMd5Data();
}

function normalizeResult(result) {
  if (!result) return 'Tài';
  const lower = result.toString().toLowerCase();
  if (lower.includes('tai') || lower.includes('tài') || lower === 't') return 'Tài';
  if (lower.includes('xiu') || lower.includes('xỉu') || lower === 'x') return 'Xỉu';
  return result;
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
    message: 'API Hit - Tài Xỉu Prediction',
    pollingActive,
    historyHu: historyHu.length,
    historyMd5: historyMd5.length,
    canPredictHu: historyHu.length >= MIN_HISTORY_FOR_PREDICTION,
    canPredictMd5: historyMd5.length >= MIN_HISTORY_FOR_PREDICTION
  });
});

router.get('/hu', async (req, res) => {
  try {
    if (historyHu.length < MIN_HISTORY_FOR_PREDICTION) {
      return res.json({
        error: `Cần ít nhất ${MIN_HISTORY_FOR_PREDICTION} lịch sử để dự đoán`,
        current: historyHu.length,
        required: MIN_HISTORY_FOR_PREDICTION,
        message: 'Đang chờ dữ liệu từ API...'
      });
    }
    
    await verifyPredictions('hu', historyHu);
    
    const latestPhien = historyHu[0].Phien;
    const nextPhien = typeof latestPhien === 'number' ? latestPhien + 1 : parseInt(latestPhien) + 1;
    
    const result = calculateAdvancedPrediction(historyHu, 'hu');
    
    savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence);
    recordPrediction('hu', nextPhien, result.prediction, result.confidence, result.factors);
    
    res.json({
      phien: nextPhien.toString(),
      du_doan: normalizeResult(result.prediction),
      ti_le: `${result.confidence}%`,
      id: '@mryanhdz'
    });
  } catch (error) {
    console.error('[Hit-Hu] Error:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

router.get('/md5', async (req, res) => {
  try {
    if (historyMd5.length < MIN_HISTORY_FOR_PREDICTION) {
      return res.json({
        error: `Cần ít nhất ${MIN_HISTORY_FOR_PREDICTION} lịch sử để dự đoán`,
        current: historyMd5.length,
        required: MIN_HISTORY_FOR_PREDICTION,
        message: 'Đang chờ dữ liệu từ API...'
      });
    }
    
    await verifyPredictions('md5', historyMd5);
    
    const latestPhien = historyMd5[0].Phien;
    const nextPhien = typeof latestPhien === 'number' ? latestPhien + 1 : parseInt(latestPhien) + 1;
    
    const result = calculateAdvancedPrediction(historyMd5, 'md5');
    
    savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence);
    recordPrediction('md5', nextPhien, result.prediction, result.confidence, result.factors);
    
    res.json({
      phien: nextPhien.toString(),
      du_doan: normalizeResult(result.prediction),
      ti_le: `${result.confidence}%`,
      id: '@mryanhdz'
    });
  } catch (error) {
    console.error('[Hit-MD5] Error:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

router.get('/history', (req, res) => {
  res.json({
    taixiu: historyHu.slice(0, 20),
    taixiumd5: historyMd5.slice(0, 20)
  });
});

router.get('/hu/lichsu', (req, res) => {
  res.json({
    type: 'Hit Tài Xỉu Hũ',
    history: historyHu.slice(0, 20),
    total: historyHu.length
  });
});

router.get('/md5/lichsu', (req, res) => {
  res.json({
    type: 'Hit Tài Xỉu MD5',
    history: historyMd5.slice(0, 20),
    total: historyMd5.length
  });
});

router.get('/stats', (req, res) => {
  res.json({
    hu: {
      totalPredictions: learningData.hu.totalPredictions,
      correctPredictions: learningData.hu.correctPredictions,
      accuracy: learningData.hu.totalPredictions > 0 
        ? (learningData.hu.correctPredictions / learningData.hu.totalPredictions * 100).toFixed(2) + '%'
        : 'N/A',
      streakAnalysis: learningData.hu.streakAnalysis,
      historyCount: historyHu.length
    },
    md5: {
      totalPredictions: learningData.md5.totalPredictions,
      correctPredictions: learningData.md5.correctPredictions,
      accuracy: learningData.md5.totalPredictions > 0 
        ? (learningData.md5.correctPredictions / learningData.md5.totalPredictions * 100).toFixed(2) + '%'
        : 'N/A',
      streakAnalysis: learningData.md5.streakAnalysis,
      historyCount: historyMd5.length
    },
    pollingActive
  });
});

loadLearningData();
loadPredictionHistory();
loadExternalHistory();
startAutoSaveTask();
startPolling();

module.exports = router;
