const express = require('express');
const router = express.Router();
const axios = require('axios');

const API_URL = "https://wtxmd52.macminim6.online/v1/txmd5/sessions";
const MAX_HISTORY_SIZE = 100;

let historyList = [];
let cachedRaw = null;
let lastSid = null;

let modelPredictions = {
    trend: {},
    short: {},
    mean: {},
    switch: {},
    bridge: {}
};

function getTaiXiu(sumDice) {
    return sumDice <= 10 ? "Xỉu" : "Tài";
}

function parseRawData(rawDataList) {
    const parsedList = [];
    if (!Array.isArray(rawDataList)) return [];

    for (const item of rawDataList) {
        if (item.id && item.dices && item.point) {
            if (!Array.isArray(item.dices) || item.dices.length < 3) continue;

            parsedList.push({
                Phien: item.id,
                sid: item.id,
                Xuc_xac_1: item.dices[0],
                Xuc_xac_2: item.dices[1],
                Xuc_xac_3: item.dices[2],
                Tong: item.point,
                Ket_qua: getTaiXiu(item.point)
            });
        }
    }
    return parsedList;
}

function detectStreakAndBreak(history) {
    if (!history.length) return { streak: 0, currentResult: null, breakProb: 0.0 };

    let streak = 1;
    const currentResult = history[0].Ket_qua;

    for (let i = 1; i < history.length; i++) {
        if (history[i].Ket_qua === currentResult) streak++;
        else break;
    }

    const last15 = history.slice(0, 15).map(h => h.Ket_qua);
    if (!last15.length) return { streak, currentResult, breakProb: 0.0 };

    let switches = 0;
    for (let i = 1; i < last15.length; i++) {
        if (last15[i] !== last15[i - 1]) switches++;
    }

    const taiCount = last15.filter(r => r === 'Tài').length;
    const xiuCount = last15.length - taiCount;
    const imbalance = Math.abs(taiCount - xiuCount) / last15.length;

    let breakProb = 0.0;
    if (streak >= 7) breakProb = Math.min(0.9 + imbalance * 0.4, 0.98);
    else if (streak >= 5) breakProb = Math.min(0.75 + imbalance * 0.3, 0.95);
    else if (streak >= 3) breakProb = Math.min(0.4 + imbalance * 0.2, 0.8);
    else if (streak === 1 && switches >= 6) breakProb = 0.55;

    if (switches < 4 && streak < 4) breakProb *= 0.8;

    return { streak, currentResult, breakProb };
}

function smartBridgeBreak(history) {
    if (!history.length || history.length < 5) {
        return { prediction: 0, breakProb: 0.0, reason: 'Không đủ dữ liệu' };
    }

    const streakInfo = detectStreakAndBreak(history);
    const { streak, currentResult, breakProb } = streakInfo;

    let prediction = 0;
    let reason = '';

    if (breakProb > 0.7) {
        prediction = currentResult === 'Tài' ? 2 : 1;
        reason = `[SBB Bẻ Mạnh] Xác suất bẻ cầu rất cao (${breakProb.toFixed(2)}), dự đoán bẻ`;
    } else if (streak >= 5 && breakProb < 0.5) {
        prediction = currentResult === 'Tài' ? 1 : 2;
        reason = `[SBB Theo Mạnh] Chuỗi ${currentResult} mạnh (${streak} lần), tiếp tục theo cầu`;
    } else if (streak === 1 && breakProb > 0.55) {
        prediction = currentResult === 'Tài' ? 2 : 1;
        reason = `[SBB Bẻ Ngay] Chuỗi ngắn (1 lần), xác suất bẻ cao (${breakProb.toFixed(2)}), dự đoán bẻ`;
    } else if (streak >= 2 && breakProb < 0.3) {
        prediction = currentResult === 'Tài' ? 1 : 2;
        reason = `[SBB Theo Ngắn] Chuỗi ${currentResult} ngắn (${streak} lần), theo cầu`;
    } else {
        prediction = currentResult === 'Tài' ? 2 : 1;
        reason = `[SBB Default] Không có mẫu rõ ràng, dự đoán bẻ nhẹ (1-1)`;
    }

    return { prediction, breakProb, reason };
}

function trendAndProb(history) {
    const streakInfo = detectStreakAndBreak(history);
    const { currentResult, streak, breakProb } = streakInfo;

    if (!currentResult) return 0;

    const last15 = history.slice(0, 15).map(h => h.Ket_qua);
    if (!last15.length) return 0;

    const weights = last15.map((_, i) => Math.pow(1.2, last15.length - 1 - i));
    const taiWeighted = weights.reduce((sum, w, i) => last15[i] === 'Tài' ? sum + w : sum, 0);
    const xiuWeighted = weights.reduce((sum, w, i) => last15[i] === 'Xỉu' ? sum + w : sum, 0);
    const totalWeight = taiWeighted + xiuWeighted;

    if (streak >= 4 && breakProb < 0.6) return currentResult === 'Tài' ? 1 : 2;
    else if (breakProb > 0.6) return currentResult === 'Tài' ? 2 : 1;
    else if (totalWeight > 0 && taiWeighted / totalWeight > 0.6) return 1;
    else if (totalWeight > 0 && xiuWeighted / totalWeight > 0.6) return 2;
    else return currentResult === 'Tài' ? 2 : 1;
}

function shortPattern(history) {
    const streakInfo = detectStreakAndBreak(history);
    const { currentResult, streak } = streakInfo;

    if (!currentResult) return 0;

    const last4 = history.slice(0, 4).map(h => h.Ket_qua);
    if (last4.length === 4 && last4[0] !== last4[1] && last4[1] !== last4[2] && last4[2] !== last4[3]) {
        return currentResult === 'Tài' ? 2 : 1;
    }

    if (history.length >= 4) {
        if (last4[0] === last4[1] && last4[2] === last4[3] && last4[0] !== last4[2]) {
            return currentResult === 'Tài' ? 1 : 2;
        }
    }

    if (streak >= 2 && streak <= 3) return currentResult === 'Tài' ? 1 : 2;
    return currentResult === 'Tài' ? 2 : 1;
}

function meanDeviation(history) {
    const currentResult = history[0]?.Ket_qua;
    if (!currentResult) return 0;

    const last20 = history.slice(0, 20).map(h => h.Ket_qua);
    if (!last20.length) return 0;

    const taiCount = last20.filter(r => r === 'Tài').length;
    const xiuCount = last20.length - taiCount;
    const deviation = Math.abs(taiCount - xiuCount) / last20.length;

    if (deviation > 0.25) return taiCount < xiuCount ? 1 : 2;
    return currentResult === 'Tài' ? 2 : 1;
}

function recentSwitch(history) {
    const currentResult = history[0]?.Ket_qua;
    if (!currentResult) return 0;

    const last8 = history.slice(0, 8).map(h => h.Ket_qua);
    if (!last8.length) return 0;

    let switches = 0;
    for (let i = 1; i < last8.length; i++) {
        if (last8[i] !== last8[i - 1]) switches++;
    }

    if (switches >= 5) return currentResult === 'Tài' ? 2 : 1;
    return currentResult === 'Tài' ? 1 : 2;
}

function aiHtddLogic(history) {
    if (!history.length || history.length < 5) {
        return { prediction: null, reason: 'Không đủ dữ liệu', source: 'AI HTDD' };
    }

    const recentHistoryResults = history.slice(0, 7).map(h => h.Ket_qua);
    const taiCountRecent = recentHistoryResults.filter(r => r === 'Tài').length;
    const xiuCountRecent = recentHistoryResults.length - taiCountRecent;

    const streakInfo = detectStreakAndBreak(history);
    const { streak, currentResult } = streakInfo;

    if (history.length >= 3) {
        const last3 = history.slice(0, 3).map(h => h.Ket_qua);
        if (last3[0] === 'Tài' && last3[1] === 'Xỉu' && last3[2] === 'Tài') {
            return { prediction: 'Xỉu', reason: '[AI Bẻ Mẫu 1-1] Tiếp tục mẫu 1T1X → đánh Xỉu', source: 'AI HTDD' };
        } else if (last3[0] === 'Xỉu' && last3[1] === 'Tài' && last3[2] === 'Xỉu') {
            return { prediction: 'Tài', reason: '[AI Bẻ Mẫu 1-1] Tiếp tục mẫu 1X1T → đánh Tài', source: 'AI HTDD' };
        }
    }

    if (streak >= 6) {
        const prediction = currentResult === 'Tài' ? 'Xỉu' : 'Tài';
        return { prediction, reason: `[AI Bẻ Dài] Chuỗi ${currentResult} quá dài (${streak} lần) → dự đoán bẻ`, source: 'AI HTDD' };
    }

    if (taiCountRecent > xiuCountRecent + 1) {
        return { prediction: 'Xỉu', reason: `[AI Bẻ Mất Cân Bằng] Tài chiếm ưu thế gần đây (${taiCountRecent}/${recentHistoryResults.length}) → dự đoán Xỉu`, source: 'AI HTDD' };
    } else if (xiuCountRecent > taiCountRecent + 1) {
        return { prediction: 'Tài', reason: `[AI Bẻ Mất Cân Bằng] Xỉu chiếm ưu thế gần đây (${xiuCountRecent}/${recentHistoryResults.length}) → dự đoán Tài`, source: 'AI HTDD' };
    }

    const prediction = currentResult === 'Tài' ? 'Xỉu' : 'Tài';
    return { prediction, reason: '[AI Default] Mặc định bẻ nhẹ', source: 'AI HTDD' };
}

function generatePredictionAdvanced(history) {
    if (!history.length || history.length < 5) {
        const defaultPrediction = history.length && history[0].Ket_qua === 'Tài' ? 'Xỉu' : 'Tài';
        return { prediction: defaultPrediction, reason: "Không đủ dữ liệu (<5 phiên), dự đoán ngược kết quả cuối.", confidence: 55.0 };
    }

    const streakInfo = detectStreakAndBreak(history);
    const { streak, currentResult } = streakInfo;

    const trendPredCode = trendAndProb(history);
    const shortPredCode = shortPattern(history);
    const meanPredCode = meanDeviation(history);
    const switchPredCode = recentSwitch(history);
    const bridgePredData = smartBridgeBreak(history);
    const aiPredData = aiHtddLogic(history);

    const trendPred = trendPredCode === 1 ? 'Tài' : (trendPredCode === 2 ? 'Xỉu' : null);
    const shortPred = shortPredCode === 1 ? 'Tài' : (shortPredCode === 2 ? 'Xỉu' : null);
    const meanPred = meanPredCode === 1 ? 'Tài' : (meanPredCode === 2 ? 'Xỉu' : null);
    const switchPred = switchPredCode === 1 ? 'Tài' : (switchPredCode === 2 ? 'Xỉu' : null);
    const bridgePred = bridgePredData.prediction === 1 ? 'Tài' : (bridgePredData.prediction === 2 ? 'Xỉu' : null);
    const aiPred = aiPredData.prediction;

    const weights = {
        trend: streak >= 3 ? 0.15 : 0.1,
        short: streak < 3 ? 0.15 : 0.1,
        mean: 0.1,
        switch: streak < 2 ? 0.1 : 0.05,
        bridge: streak >= 2 ? 0.3 : 0.25,
        aihtdd: streak >= 2 ? 0.35 : 0.4
    };

    let taiScore = 0;
    let xiuScore = 0;

    if (trendPred === 'Tài') taiScore += weights.trend;
    else if (trendPred === 'Xỉu') xiuScore += weights.trend;

    if (shortPred === 'Tài') taiScore += weights.short;
    else if (shortPred === 'Xỉu') xiuScore += weights.short;

    if (meanPred === 'Tài') taiScore += weights.mean;
    else if (meanPred === 'Xỉu') xiuScore += weights.mean;

    if (switchPred === 'Tài') taiScore += weights.switch;
    else if (switchPred === 'Xỉu') xiuScore += weights.switch;

    if (bridgePred === 'Tài') taiScore += weights.bridge;
    else if (bridgePred === 'Xỉu') xiuScore += weights.bridge;

    if (aiPred === 'Tài') taiScore += weights.aihtdd;
    else if (aiPred === 'Xỉu') xiuScore += weights.aihtdd;

    let finalPrediction = null;
    const predictionReasonDetail = [];

    if (taiScore > xiuScore) finalPrediction = 'Tài';
    else if (xiuScore > taiScore) finalPrediction = 'Xỉu';

    if (!finalPrediction) {
        finalPrediction = currentResult === 'Tài' ? 'Xỉu' : 'Tài';
        predictionReasonDetail.push("Điểm số cân bằng, dự đoán ngược kết quả cuối.");
    }

    if (finalPrediction === currentResult) {
        const scoreDiff = Math.abs(taiScore - xiuScore);
        const totalScore = taiScore + xiuScore;

        if (totalScore < 0.6 || scoreDiff < 0.25) {
            if (!(streak >= 4 && bridgePredData.breakProb < 0.5)) {
                finalPrediction = finalPrediction === 'Tài' ? 'Xỉu' : 'Tài';
                predictionReasonDetail.push(`Dự đoán trùng kết quả cuối nhưng không đủ tự tin (${scoreDiff.toFixed(2)}), đảo ngược để bẻ cầu.`);
            }
        }
    }

    const reasons = [];
    if (aiPredData?.reason) reasons.push(aiPredData.reason);
    if (bridgePredData?.reason) reasons.push(bridgePredData.reason);
    reasons.push(...predictionReasonDetail);

    const finalReason = reasons.length ? reasons.join(" | ") : `Dự đoán dựa trên tổng hợp nhiều mô hình (Tổng điểm: Tài=${taiScore.toFixed(2)}, Xỉu=${xiuScore.toFixed(2)}).`;

    const totalScore = taiScore + xiuScore;
    let confidencePercentage = 55.0;
    if (totalScore > 0) {
        const confidenceRaw = finalPrediction === 'Tài' ? taiScore / totalScore : xiuScore / totalScore;
        confidencePercentage = 60 + (confidenceRaw - 0.5) * 70;
        confidencePercentage = Math.max(60.0, Math.min(95.0, confidencePercentage));
    }

    return { prediction: finalPrediction, reason: finalReason, confidence: confidencePercentage };
}

function updateHistory(currentSession) {
    const sessionExists = historyList.some(item => item.Phien === currentSession.Phien);
    if (!sessionExists) {
        historyList.unshift(currentSession);
        if (historyList.length > MAX_HISTORY_SIZE) historyList.pop();
    }
}

router.get('/', async (req, res) => {
    try {
        const response = await axios.get(API_URL, { timeout: 10000 });
        const rawData = response.data;
        cachedRaw = rawData;

        const listData = rawData.list;

        if (!Array.isArray(listData) || !listData.length) {
            return res.status(500).json({ error: "Không có dữ liệu hợp lệ từ API gốc hoặc cấu trúc dữ liệu không đúng (thiếu key 'list')" });
        }

        const parsedList = parseRawData(listData);

        if (!parsedList.length) {
            return res.status(500).json({ error: "Dữ liệu API không thể phân tích được" });
        }

        const currentParsed = parsedList[0];
        const currentSid = currentParsed.sid;

        if (currentSid !== lastSid) {
            lastSid = currentSid;
            for (const parsed of parsedList) {
                updateHistory(parsed);
            }
        }

        const { prediction, reason, confidence } = generatePredictionAdvanced(historyList);
        const nextPhien = currentParsed.Phien + 1;

        res.json({
            id: 'API BETVIP - All in One Server',
            phien_ket_thuc: currentParsed.Phien,
            Xuc_xac_1: currentParsed.Xuc_xac_1,
            Xuc_xac_2: currentParsed.Xuc_xac_2,
            Xuc_xac_3: currentParsed.Xuc_xac_3,
            Tong: currentParsed.Tong,
            Ket_qua: currentParsed.Ket_qua,
            phien_du_doan: nextPhien,
            du_doan: prediction,
            do_tin_cay: `${confidence.toFixed(2)}%`,
            ly_do: reason
        });
    } catch (error) {
        console.error('Betvip - Lỗi khi lấy dữ liệu:', error.message);
        res.status(500).json({ error: 'Lỗi khi fetch dữ liệu hoặc xử lý', details: error.message });
    }
});

module.exports = router;
