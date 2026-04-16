const express = require('express');
const router = express.Router();

let patternHistory = "";

function updatePattern(result) {
    if (patternHistory.length >= 20) {
        patternHistory = patternHistory.slice(1);
    }
    patternHistory += result;
}

function getTaiXiu(sum) {
    return sum >= 11 ? 'Tài' : 'Xỉu';
}

function advancedPredictPattern(history) {
    if (history.length < 8) return { du_doan: "Chưa đủ dữ liệu", do_tin_cay: 0, ghi_chu: "Cần tối thiểu 8 phiên." };

    const lastChar = history[history.length - 1];
    const oppositeChar = lastChar === 't' ? 'x' : 't';

    const lastSix = history.slice(-6).toLowerCase();
    const giangCoPattern1 = /^(tx){3}$/;
    const giangCoPattern2 = /^(xt){3}$/;

    if (giangCoPattern1.test(lastSix) || giangCoPattern2.test(lastSix)) {
        return {
            du_doan: oppositeChar === 't' ? "Tài" : "Xỉu",
            do_tin_cay: 85,
            ghi_chu: "Cầu Giằng co (1-1)"
        };
    }

    let streakCount = 1;
    for (let i = history.length - 2; i >= 0; i--) {
        if (history[i] === lastChar) {
            streakCount++;
        } else {
            break;
        }
    }

    if (streakCount >= 5) {
        return {
            du_doan: oppositeChar === 't' ? "Tài" : "Xỉu",
            do_tin_cay: 75,
            ghi_chu: `Bẻ cầu sau bệt ${streakCount} (dự đoán đảo)`
        };
    }

    if (streakCount >= 2 && streakCount < 5) {
        return {
            du_doan: lastChar === 't' ? "Tài" : "Xỉu",
            do_tin_cay: 65,
            ghi_chu: `Bệt ${streakCount} (dự đoán theo bệt)`
        };
    }

    if (history.length >= 6) {
        const lastSixLower = history.slice(-6).toLowerCase();
        if (lastSixLower === 'ttxttx') {
            return { du_doan: "Xỉu", do_tin_cay: 70, ghi_chu: "Cầu 2-1-2 (đang là T T X T T, dự đoán X)" };
        }
        if (lastSixLower === 'xxttxx') {
            return { du_doan: "Tài", do_tin_cay: 70, ghi_chu: "Cầu 2-1-2 (đang là X X T X X, dự đoán T)" };
        }
    }

    return {
        du_doan: oppositeChar === 't' ? "Tài" : "Xỉu",
        do_tin_cay: 50,
        ghi_chu: "Không rõ cầu (Đảo cầu mặc định)"
    };
}

router.get('/', async (req, res) => {
    try {
        const fetch = (await import('node-fetch')).default;
        const response = await fetch('https://1.bot/GetNewLottery/LT_TaixiuMD5');

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const json = await response.json();

        if (!json || json.state !== 1 || !json.data) {
            return res.status(500).json({ error: 'Dữ liệu trả về từ nguồn không hợp lệ' });
        }

        const data = json.data;
        const dice = data.OpenCode.split(',').map(Number);
        const [d1, d2, d3] = dice;
        const sum = d1 + d2 + d3;
        const ket_qua = getTaiXiu(sum);
        const patternChar = ket_qua === "Tài" ? "t" : "x";

        updatePattern(patternChar);

        const { du_doan, do_tin_cay, ghi_chu } = advancedPredictPattern(patternHistory);
        const phienDuDoan = Number(data.Expect) + 1;

        return res.json({
            id: "API LUCK8 - All in One Server",
            Phien: data.Expect,
            Xuc_xac1: d1,
            Xuc_xac2: d2,
            Xuc_xac3: d3,
            Tong: sum,
            Phien_du_doan: phienDuDoan,
            Du_doan: du_doan,
            Do_tin_cay: do_tin_cay,
            Ghi_chu_du_doan: ghi_chu,
            Lich_su_cau_gan_nhat: patternHistory.toUpperCase().split('').join('-')
        });
    } catch (error) {
        console.error('Luck8 - Lỗi khi fetch dữ liệu:', error.message);
        res.status(500).json({
            error: 'Lỗi khi fetch dữ liệu hoặc xử lý',
            details: error.message
        });
    }
});

module.exports = router;
