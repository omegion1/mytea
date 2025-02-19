// config.js

// Hàm tạo số ngẫu nhiên trong khoảng [min, max] và làm tròn tới 2 chữ số thập phân
function getRandomBetween(min, max) {
  const randomValue = (Math.random() * (max - min)) + min;
  return randomValue.toFixed(2);  // Làm tròn đến 2 chữ số thập phân
}

module.exports = {
  amountToWrap: parseFloat(getRandomBetween(0.1, 0.2)),  // Amount WPOL to wrap/convert to tPOL
  autoRestartDelay: parseInt(getRandomBetween(60, 120)),  // Random delay between 60s and 120s
  polAmount: parseFloat(getRandomBetween(0.1, 0.2))  // Random POL amount between 0.1 and 0.2
};

