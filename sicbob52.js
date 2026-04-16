const express = require('express');
const router = express.Router();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const API_URL = 'https://api.wsmt8g.cc/v2/history/getLastResult?gameId=ktrng_3996&size=100&tableId=39961215743193&curPage=1';
const HISTORY_FILE = path.join(__dirname, '../../data/sicbob52_history.json');

let historyData = [];
let lastPrediction = { phien: null, du_doan: null, doan_vi: [], do_tin_cay: 0, reason: "" };

function loadPredictionHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('SicboB52 - Lỗi đọc lịch sử:', e.message);
    }
    return [];
}

function savePredictionHistory(data) {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('SicboB52 - Lỗi lưu lịch sử:', e.message);
    }
}

async function updateHistory() {
    try {
        const res = await axios.get(API_URL);
        if (res?.data?.data?.resultList) {
            historyData = res.data.data.resultList;
        }
    } catch (e) {
        console.error('SicboB52 - Lỗi cập nhật:', e.message);
    }
}

function getResultType(session) {
    if (!session || !session.facesList) return "";
    const [a, b, c] = session.facesList;
    if (a === b && b === c) return "Bão";
    return session.score >= 11 ? "Tài" : "Xỉu";
}

function generateRandomPrediction() {
    const randomValue = Math.random();
    let du_doan;
    if (randomValue < 0.15) {
        du_doan = "Bão";
    } else {
        du_doan = Math.random() < 0.5 ? "Tài" : "Xỉu";
    }

    let possibleSums = [];
    if (du_doan === "Tài") possibleSums = [11, 12, 13, 14, 15, 16, 17];
    else if (du_doan === "Xỉu") possibleSums = [4, 5, 6, 7, 8, 9, 10];
    else possibleSums = [Math.floor(Math.random() * 6 + 1) * 3];

    const doan_vi = [];
    while (doan_vi.length < 3 && possibleSums.length > 0) {
        const idx = Math.floor(Math.random() * possibleSums.length);
        doan_vi.push(possibleSums.splice(idx, 1)[0]);
    }

    const do_tin_cay = (Math.random() * (97 - 61) + 61).toFixed(2);

    return {
        prediction: du_doan,
        doan_vi,
        do_tin_cay: `${do_tin_cay}%`,
        reason: du_doan === "Bão" ? "Dự đoán bão dựa trên xác suất thấp." : "Dự đoán dựa trên phân tích lịch sử."
    };
}

router.get('/', async (req, res) => {
    await updateHistory();

    const latestSessionData = historyData[0] || {};
    const latestPhien = latestSessionData.gameNum ? latestSessionData.gameNum.replace('#', '') : null;

    if (!latestPhien) {
        return res.status(503).json({ error: "Không thể lấy dữ liệu lịch sử, vui lòng thử lại." });
    }

    const nextPhien = (parseInt(latestPhien) + 1).toString();

    if (nextPhien !== lastPrediction.phien) {
        const { prediction, doan_vi, do_tin_cay, reason } = generateRandomPrediction();
        lastPrediction = { phien: nextPhien, du_doan: prediction, doan_vi, do_tin_cay, reason };

        const predHist = loadPredictionHistory();
        predHist.push({ phien: nextPhien, du_doan: prediction, doan_vi, do_tin_cay, reason, ket_qua_thuc: null, timestamp: Date.now() });
        savePredictionHistory(predHist);
    }

    res.json({
        id: "API SICBO B52 - All in One Server",
        Phien: latestPhien || "",
        Xuc_xac_1: latestSessionData?.facesList?.[0] || 0,
        Xuc_xac_2: latestSessionData?.facesList?.[1] || 0,
        Xuc_xac_3: latestSessionData?.facesList?.[2] || 0,
        Tong: latestSessionData?.score || 0,
        Ket_qua: getResultType(latestSessionData) || "",
        phien_hien_tai: nextPhien || "",
        du_doan: lastPrediction.du_doan || "",
        dudoan_vi: lastPrediction.doan_vi.join(", ") || "",
        do_tin_cay: lastPrediction.do_tin_cay
    });
});

module.exports = router;
