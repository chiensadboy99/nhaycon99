const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');

const HISTORY_FILE_PATH = path.join(__dirname, '../../data/sum_history.json');
const API_URL = 'https://taixiu1.gsum01.com/api/luckydice1/GetSoiCau';

let history = [];
let latestPrediction = { phien: null, ketqua: "Đang chờ phiên mới", time: new Date().toISOString(), reason: "Chưa có dữ liệu lịch sử." };
let modelPredictions = {};
let totalWins = 0;
let totalLosses = 0;

async function readHistoryFile() {
    try {
        const data = await fs.readFile(HISTORY_FILE_PATH, 'utf8');
        const fileContent = JSON.parse(data);
        history = fileContent.history || [];
        modelPredictions = fileContent.modelPredictions || {};
        totalWins = fileContent.totalWins || 0;
        totalLosses = fileContent.totalLosses || 0;
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error('Sum - Lỗi khi đọc file lịch sử:', error);
        }
    }
}

async function writeHistoryFile() {
    try {
        const data = { history, modelPredictions, totalWins, totalLosses };
        await fs.writeFile(HISTORY_FILE_PATH, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
        console.error('Sum - Lỗi khi ghi file lịch sử:', error);
    }
}

function getResultFromDiceSum(diceSum) {
    return diceSum >= 11 ? 'Tài' : 'Xỉu';
}

function detectStreak(hist) {
    if (!hist || hist.length === 0) return { streak: 0, currentResult: null };
    let streak = 1;
    const currentResult = hist[hist.length - 1].result;
    for (let i = hist.length - 2; i >= 0; i--) {
        if (hist[i].result === currentResult) streak++;
        else break;
    }
    return { streak, currentResult };
}

function superEnsembleModel(hist) {
    if (hist.length < 10) {
        return {
            prediction: 'Đang chờ phiên mới',
            reason: 'Không đủ dữ liệu lịch sử để dự đoán đáng tin cậy.',
            scores: { taiScore: 0, xiuScore: 0 },
            confidence: 50
        };
    }

    const { streak, currentResult } = detectStreak(hist);
    let prediction, reason, confidence;

    if (streak >= 5) {
        prediction = currentResult === 'Tài' ? 'Xỉu' : 'Tài';
        reason = `Bẻ cầu sau chuỗi ${currentResult} ${streak} phiên liên tiếp`;
        confidence = 75 + Math.min(streak * 2, 15);
    } else if (streak >= 3) {
        prediction = currentResult;
        reason = `Theo cầu ${currentResult} đang chạy ${streak} phiên`;
        confidence = 65 + streak * 3;
    } else {
        const last20 = hist.slice(-20);
        const taiCount = last20.filter(h => h.result === 'Tài').length;
        const xiuCount = last20.length - taiCount;
        
        if (taiCount > xiuCount + 3) {
            prediction = 'Xỉu';
            reason = `Cân bằng sau khi Tài chiếm ưu thế (${taiCount}/${last20.length})`;
            confidence = 68;
        } else if (xiuCount > taiCount + 3) {
            prediction = 'Tài';
            reason = `Cân bằng sau khi Xỉu chiếm ưu thế (${xiuCount}/${last20.length})`;
            confidence = 68;
        } else {
            prediction = currentResult === 'Tài' ? 'Xỉu' : 'Tài';
            reason = 'Dự đoán đảo chiều mặc định';
            confidence = 55;
        }
    }

    return { prediction, reason, scores: { taiScore: 0, xiuScore: 0 }, confidence };
}

async function fetchGameData() {
    try {
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(API_URL);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();

        if (Array.isArray(data) && data.length > 0) {
            const processedHistory = data.map(item => ({
                session: item.SessionId,
                result: getResultFromDiceSum(item.DiceSum),
                totalScore: item.DiceSum,
                diceValues: [item.FirstDice, item.SecondDice, item.ThirdDice]
            })).reverse();

            const lastKnownSession = history.length > 0 ? history[history.length - 1].session : null;
            const newEntries = processedHistory.filter(item => item.session > lastKnownSession);

            if (newEntries.length > 0) {
                history.push(...newEntries);
                if (history.length > 500) history = history.slice(-500);

                const nextPrediction = superEnsembleModel(history);
                const lastGame = history[history.length - 1];
                latestPrediction = {
                    phien: lastGame.session + 1,
                    ketqua: nextPrediction.prediction,
                    time: new Date().toISOString(),
                    reason: nextPrediction.reason,
                    confidence: nextPrediction.confidence
                };

                await writeHistoryFile();
            }
        }
        return latestPrediction;
    } catch (error) {
        console.error('Sum - Lỗi khi lấy dữ liệu game:', error.message);
        return latestPrediction;
    }
}

router.get('/', async (req, res) => {
    await readHistoryFile();
    const prediction = await fetchGameData();
    const lastHistory = history[history.length - 1];

    res.json({
        id: "API SUM - All in One Server",
        phien_truoc: lastHistory?.session,
        xuc_xac: lastHistory?.diceValues,
        tong_xuc_xac: lastHistory?.totalScore,
        ket_qua: lastHistory?.result,
        phien_sau: prediction?.phien,
        du_doan: prediction?.ketqua,
        do_tin_cay: `${prediction?.confidence?.toFixed(2) || 50}%`,
        giai_thich: prediction?.reason,
        thoi_gian_cap_nhat: prediction?.time,
        tong_thang: totalWins,
        tong_thua: totalLosses
    });
});

module.exports = router;
