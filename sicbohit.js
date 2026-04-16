const express = require('express');
const router = express.Router();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const API_URL = 'https://api.wsmt8g.cc/v2/history/getLastResult?gameId=ktrng_3932&size=120&tableId=39321215743193&curPage=1';
const HISTORY_FILE = path.join(__dirname, '../../data/sicbohit_history.json');

let historyData = [];
let lastPrediction = { phien: null, du_doan: null, doan_vi: [] };
let analysisHistory = [];

const config = {
    historyLength: 20,
    streakThreshold: 3,
    pattern11Threshold: 4,
};

function loadPredictionHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('SicboHit - Lỗi đọc lịch sử:', e.message);
    }
    return [];
}

function savePredictionHistory(data) {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('SicboHit - Lỗi lưu lịch sử:', e.message);
    }
}

async function updateHistory() {
    try {
        const res = await axios.get(API_URL);
        if (res?.data?.data?.resultList) {
            historyData = res.data.data.resultList;
            
            analysisHistory = historyData.slice(0, 20).map(item => ({
                result: getResultType(item),
                sum: item.score
            }));
        }
    } catch (e) {
        console.error('SicboHit - Lỗi cập nhật:', e.message);
    }
}

function getResultType(session) {
    if (!session || !session.facesList) return "";
    const [a, b, c] = session.facesList;
    if (a === b && b === c) return "Bão";
    return session.score >= 11 ? "Tài" : "Xỉu";
}

function analyzeHistory() {
    if (analysisHistory.length === 0) {
        return { hasEnoughData: false, currentStreak: { type: null, length: 0 }, isPattern11: false };
    }

    let currentStreak = { type: analysisHistory[0].result, length: 0 };
    for (let i = 0; i < analysisHistory.length; i++) {
        if (analysisHistory[i].result === currentStreak.type) {
            currentStreak.length++;
        } else {
            break;
        }
    }

    let isPattern11 = false;
    if (analysisHistory.length >= config.pattern11Threshold) {
        let patternCheck = true;
        const lastFour = analysisHistory.slice(0, config.pattern11Threshold);
        for (let i = 0; i < lastFour.length - 1; i++) {
            if (lastFour[i].result === lastFour[i + 1].result) {
                patternCheck = false;
                break;
            }
        }
        isPattern11 = patternCheck;
    }

    const taiCount = analysisHistory.filter(h => h.result === "Tài").length;
    const xiuCount = analysisHistory.filter(h => h.result === "Xỉu").length;

    return { hasEnoughData: analysisHistory.length >= 5, currentStreak, isPattern11, taiCount, xiuCount };
}

function predictVi(prediction) {
    let possibleSums = [];
    if (prediction === "Tài") possibleSums = [11, 12, 13, 14, 15, 16, 17];
    else if (prediction === "Xỉu") possibleSums = [4, 5, 6, 7, 8, 9, 10];
    else possibleSums = [Math.floor(Math.random() * 6 + 1) * 3];

    const historicalSums = analysisHistory.filter(h => h.result === prediction).map(h => h.sum).slice(0, 5);
    const candidates = [...new Set([...historicalSums, ...possibleSums])];

    const sums = [];
    while (sums.length < 3 && candidates.length > 0) {
        sums.push(candidates.shift());
    }

    return sums.slice(0, 3);
}

function generateSmartPrediction() {
    const analysis = analyzeHistory();

    let prediction = "Xỉu";
    let confidence = 65.0;
    let reason = "Không có tín hiệu rõ ràng, dự đoán dựa trên xu hướng chung.";

    if (!analysis.hasEnoughData) {
        prediction = Math.random() < 0.5 ? "Tài" : "Xỉu";
        reason = "Chưa đủ dữ liệu lịch sử, dự đoán ngẫu nhiên.";
        confidence = Math.random() * (75 - 60) + 60;
    } else if (analysis.currentStreak.length >= config.streakThreshold) {
        prediction = analysis.currentStreak.type;
        confidence = 80 + analysis.currentStreak.length * 2.5;
        reason = `Phát hiện cầu ${analysis.currentStreak.type} đang chạy ${analysis.currentStreak.length} phiên. Quyết định theo cầu.`;
    } else if (analysis.isPattern11) {
        const lastResult = analysisHistory[0].result;
        prediction = lastResult === "Tài" ? "Xỉu" : "Tài";
        confidence = 78.5;
        reason = `Phát hiện cầu 1-1 đang hình thành. Dự đoán phiên tiếp theo sẽ đổi.`;
    } else {
        if (analysis.taiCount > analysis.xiuCount) {
            prediction = "Tài";
            confidence = 68.0;
        } else {
            prediction = "Xỉu";
            confidence = 68.0;
        }
        reason = `Không có cầu hay mẫu rõ ràng. Dự đoán theo phe chiếm ưu thế gần đây (${prediction}).`;
    }

    if (confidence > 97.5) confidence = 97.5;

    return { prediction, doan_vi: predictVi(prediction), do_tin_cay: `${confidence.toFixed(2)}%`, reason };
}

router.get('/', async (req, res) => {
    await updateHistory();

    const latest = historyData[0] || {};
    const currentPhien = latest.gameNum;

    if (currentPhien && currentPhien !== lastPrediction.phien) {
        const { prediction, doan_vi, do_tin_cay, reason } = generateSmartPrediction();
        lastPrediction = { phien: currentPhien, du_doan: prediction, doan_vi };

        const predHist = loadPredictionHistory();
        predHist.push({ phien: currentPhien, du_doan: prediction, doan_vi, ket_qua_thuc: null, timestamp: Date.now() });
        savePredictionHistory(predHist);
    }

    const phienTruoc = currentPhien ? parseInt(currentPhien.replace('#', '')) : 0;

    res.json({
        id: "API SICBO HIT - All in One Server",
        Phien: phienTruoc,
        Xuc_xac_1: latest.facesList?.[0] || 0,
        Xuc_xac_2: latest.facesList?.[1] || 0,
        Xuc_xac_3: latest.facesList?.[2] || 0,
        Tong: latest.score || 0,
        Ket_qua: getResultType(latest) || "Chờ kết quả...",
        phien_hien_tai: phienTruoc ? phienTruoc + 1 : 0,
        du_doan: lastPrediction.du_doan || "Đang chờ...",
        dudoan_vi: lastPrediction.doan_vi ? lastPrediction.doan_vi.join(', ') : "",
        do_tin_cay: "75%"
    });
});

module.exports = router;
