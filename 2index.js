const Web3 = require('web3');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const axios = require('axios');
const contractABI = require('./src/abi');
const config = require('./config');
const headers = require('./src/headers');
const { verifyAccountIdentity, verifyWallet, claimOneTimeReward } = require('./src/walletconnect');

const rpcUrl = 'https://polygon-rpc.com';
const web3 = new Web3(new Web3.providers.HttpProvider(rpcUrl));
const wpolContract = require('./src/wpol')(web3.currentProvider);

const contractAddress = '0x1Cd0cd01c8C902AdAb3430ae04b9ea32CB309CF1';
const contract = new web3.eth.Contract(contractABI, contractAddress);
const amount = web3.utils.toWei(config.amountToWrap.toString(), 'ether');

function displayHeader() {
  const width = process.stdout.columns;
  const headerLines = [
    "<|============================================|>",
    " SKYLER-LABS ",
    " ",
    "<|============================================|>"
  ];
  headerLines.forEach(line => {
    console.log(`\x1b[36m${line.padStart((width + line.length) / 2)}\x1b[0m`);
  });
}
  
async function verifyTransaction(txHash, walletAddress, gasFeeAmount, walletNumber) {
    const url = 'https://api.tea-fi.com/transaction';
    const payload = {
      blockchainId: 137,
      fromAmount: amount,
      fromTokenAddress: wpolContract.options.address,
      fromTokenSymbol: "WPOL",
      gasFeeAmount: gasFeeAmount,
      gasFeeTokenAddress: "0x0000000000000000000000000000000000000000",
      gasFeeTokenSymbol: "POL",
      hash: txHash,
      toAmount: amount,
      toTokenAddress: contractAddress,
      toTokenSymbol: "tPOL",
      type: 2,
      walletAddress: walletAddress
    };
  
    try {
      const response = await axios.post(url, payload, { headers });
      const statusText = response.status === 201 ? '\x1b[32m(OK)\x1b[0m' : '';
      console.log(`\x1b[36m[${walletNumber}]\x1b[0m Verification Status: \x1b[33m${response.status}\x1b[0m ${statusText}, id: \x1b[33m${response.data.id}\x1b[0m, points: \x1b[32m${response.data.pointsAmount}\x1b[0m`);
    } catch (error) {
      console.error(`\x1b[36m[${walletNumber}]\x1b[0m Error verifying transaction:`, error.response ? error.response.data : error.message);
    }
  }

async function claimDailyReward(walletAddress, walletNumber) {
  const url = `https://api.tea-fi.com/wallet/check-in/current?address=${walletAddress}`;
  try {
    const response = await Promise.race([
      axios.get(url, { headers }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000))
    ]);

    if (response.status === 200) {
      console.log(`\x1b[36m[${walletNumber}]\x1b[0m Claim daily points success!`);
    }
  } catch (error) {
    let errorMessage = error.response ? error.response.data : error.message;
    if (errorMessage.includes('<title>504 Gateway Time-out</title>')) {
      errorMessage = '504 Gateway Time-out';
    }
    console.error(`\x1b[36m[${walletNumber}]\x1b[0m Error claiming daily reward: ${errorMessage}`);
  }
}

async function approveWPOLIfNeeded(account, walletNumber) {
  try {
    const spenderAddresses = [
      '0x000000000022D473030F116dDEE9F6B43aC78BA3', 
      '0x1Cd0cd01c8C902AdAb3430ae04b9ea32CB309CF1'
    ];
    const maxUint256 = '1461501637330902918203684832716283019655932542975';

    for (const spenderAddress of spenderAddresses) {
      const allowance = await wpolContract.methods.allowance(account.address, spenderAddress).call();
      
      if (allowance < amount) {
        console.log(`\x1b[36m[${walletNumber}]\x1b[0m Approving WPOL for ${spenderAddress}...`);
        const data = wpolContract.methods.approve(spenderAddress, maxUint256).encodeABI();
        const tx = {
          from: account.address,
          to: wpolContract.options.address,
          gas: 100000,
          data: data
        };

        const signedTx = await web3.eth.accounts.signTransaction(tx, account.privateKey);
        const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
        console.log(`\x1b[36m[${walletNumber}]\x1b[0m WPOL approved for ${spenderAddress} with hash: \x1b[33m${receipt.transactionHash}\x1b[0m`);
      } else {
        console.log(`\x1b[36m[${walletNumber}]\x1b[0m Sufficient WPOL allowance available for ${spenderAddress}.`);
      }
    }
  } catch (error) {
    console.error(`\x1b[36m[${walletNumber}]\x1b[0m Error approving WPOL:`, error);
  }
}



const tokenAddress = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270'; // Địa chỉ contract WPOL

// ABI của ERC20 token để gọi balanceOf
const erc20ABI = [
  {
    "constant": true,
    "inputs": [
      {
        "name": "account",
        "type": "address"
      }
    ],
    "name": "balanceOf",
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
  }
];

async function wrapTokens(account, walletNumber, numTransactions) {
    try {
      //await approveWPOLIfNeeded(account, walletNumber);
  
      const tokenContract = new web3.eth.Contract(erc20ABI, tokenAddress);
  
      for (let i = 0; i < numTransactions; i++) {
        const balance = await tokenContract.methods.balanceOf(account.address).call();
        const amountToWrap = web3.utils.toBN(balance).mul(web3.utils.toBN(80)).div(web3.utils.toBN(100)); // 80% số dư
  
        // Nếu không có số dư để wrap hoặc balance không đủ, bỏ qua
        if (amountToWrap.isZero()) {
          continue;
        }
  
        console.log(`\x1b[36m[${walletNumber}]\x1b[0m Executing transaction ${i + 1} of ${numTransactions}`);
        console.log(`\x1b[36m[${walletNumber}]\x1b[0m Converting ${web3.utils.fromWei(amountToWrap, 'ether')} WPOL to tPOL`);
  
        const data = contract.methods.wrap(amountToWrap, account.address).encodeABI();
        const tx = {
          from: account.address,
          to: contractAddress,
          gas: 200000,
          data: data
        };
  
        const signedTx = await web3.eth.accounts.signTransaction(tx, account.privateKey);
        const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
        console.log(`\x1b[36m[${walletNumber}]\x1b[0m Transaction successful with hash: \x1b[33m${receipt.transactionHash}\x1b[0m`);
  
        const gasUsed = receipt.gasUsed;
        const gasPrice = await web3.eth.getGasPrice();
        const gasFeeAmount = web3.utils.toBN(gasUsed).mul(web3.utils.toBN(gasPrice)).toString();
  
        await verifyTransaction(receipt.transactionHash, account.address, gasFeeAmount, walletNumber);
  
        // Đợi 1 giây trước khi thực hiện giao dịch tiếp theo
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error(`\x1b[36m[${walletNumber}]\x1b[0m Error executing transaction:`, error);
    }
  }
  async function unwrapTokens(account, walletNumber) {
    try {
      const balance = await contract.methods.balanceOf(account.address).call();
      if (balance === '0') {
        console.log(`\x1b[36m[${walletNumber}]\x1b[0m No tPOL balance to unwrap. Skipping account.`);
        return;
      }
  
      console.log(`\x1b[36m[${walletNumber}]\x1b[0m Preparing to unwrap tokens and sending transaction...`);
      const data = contract.methods.unwrap(balance, account.address).encodeABI();
      const tx = {
        from: account.address,
        to: contractAddress,
        gas: 200000,
        data: data
      };
  
      const signedTx = await web3.eth.accounts.signTransaction(tx, account.privateKey);
      const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
      console.log(`\x1b[36m[${walletNumber}]\x1b[0m Transaction successful with hash: \x1b[33m${receipt.transactionHash}\x1b[0m`);
    } catch (error) {
      console.error(`\x1b[36m[${walletNumber}]\x1b[0m Error executing transaction:`, error);
    }
  }
  async function convertPOLToWPOL(account, walletNumber) {
    try {
      console.log(`\x1b[36m[${walletNumber}]\x1b[0m Checking balance and converting POL to WPOL...`);
  
      // Lấy số dư POL của ví (sử dụng web3 để lấy số dư)
      const balancePOL = await web3.eth.getBalance(account.address);
  
      // Tính toán 60% số dư POL
      const polAmount = web3.utils.fromWei(balancePOL, 'ether') * 0.60;  // Chuyển sang ETH rồi lấy 60%
  
      // Chuyển đổi số dư POL thành Wei
      const weiAmount = web3.utils.toWei(polAmount.toString(), 'ether');
  
      // Chuẩn bị giao dịch để chuyển POL sang WPOL
      const data = wpolContract.methods.deposit().encodeABI();
      const tx = {
        from: account.address,
        to: wpolContract.options.address,
        value: weiAmount,
        gas: 100000,
        data: data
      };
  
      // Ký giao dịch
      const signedTx = await web3.eth.accounts.signTransaction(tx, account.privateKey);
  
      // Gửi giao dịch đã ký
      const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
  
      // Log thông báo giao dịch thành công
      console.log(`\x1b[36m[${walletNumber}]\x1b[0m Conversion successful with hash: \x1b[33m${receipt.transactionHash}\x1b[0m`);
    } catch (error) {
      console.error(`\x1b[36m[${walletNumber}]\x1b[0m Error converting POL to WPOL:`, error);
    }
  }
      
 
async function displayVerifiedPoints(walletAddress, walletNumber) {
  const url = `https://api.tea-fi.com/points/${walletAddress}`;
  try {
    const response = await Promise.race([
      axios.get(url, { headers }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000))
    ]);
    console.log(`\x1b[36m[${walletNumber}]\x1b[0m Wallet \x1b[33m${walletAddress}\x1b[0m Verified points (not pending): \x1b[32m${response.data.pointsAmount}\x1b[0m`);
  } catch (error) {
    const errorMessage = error.response ? error.response.statusText : error.message;
    console.error(`\x1b[36m[${walletNumber}]\x1b[0m Error fetching verified points: ${errorMessage}`);
  }
}

async function executeMultipleTransactions(autoRestart = false, initialChoice = null, initialNumTransactions = 1, initialPolAmount = 0) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  if (!autoRestart) {
    rl.question('Do you want to auto-restart the process after completion? (y/n): ', async (restartAnswer) => {
      const autoRestart = restartAnswer.trim().toLowerCase();
      if (!['y', 'n'].includes(autoRestart)) {
        console.error('Invalid choice. Please enter "y" or "n".');
        rl.close();
        return;
      }

      await processTransactions(autoRestart === 'y', rl);
    });
  } else {
    await processTransactions(true, rl, initialChoice, initialNumTransactions, initialPolAmount);
  }
}

async function processTransactions(autoRestart, rl, initialChoice = null, initialNumTransactions = 1, initialPolAmount = 0) {
    let choice = initialChoice;
    let numTransactions = initialNumTransactions;
    let polAmount = initialPolAmount;

    if (!choice) {
        console.log('1. Convert POL to WPOL');
        console.log('2. Wrap WPOL to tPOL');
        console.log('3. Unwrap all tPOL to WPOL');
        console.log('4. Claim Daily Reward');
        console.log('5. Execute options 2, 3, and 4 sequentially');
        console.log('6. Execute options 2 and 3 sequentially');
        console.log('7. Approve WPOL if needed');  // Thêm tùy chọn mới
        choice = await new Promise(resolve => {
            rl.question('Please select an option (1/2/3/4/5/6/7): ', resolve);
        });
    }

    if (!['1', '2', '3', '4', '5', '6', '7'].includes(choice)) {
        console.error('Invalid choice. Please enter "1", "2", "3", "4", "5", "6", or "7".');
        rl.close();
        return;
    }

    const privateKeys = fs.readFileSync(path.join(__dirname, 'priv.txt'), 'utf-8')
        .split('\n')
        .map(key => key.trim())
        .map(key => key.startsWith('0x') ? key.slice(2) : key)
        .filter(key => key.length === 64);

    if (privateKeys.length === 0) {
        console.error('No valid private keys found in priv.txt.');
        rl.close();
        return;
    }

    let runCount = 0;
    while (runCount < 50) {
        console.log(`\x1b[36m[Run ${runCount + 1}]\x1b[0m Starting new run...`);

        for (let i = 0; i < privateKeys.length; i++) {
            const privateKey = privateKeys[i];
            const walletNumber = i + 1;
            const account = web3.eth.accounts.privateKeyToAccount(privateKey);

            console.log(`\x1b[36m[${walletNumber}]\x1b[0m Processing transactions for account: \x1b[32m${account.address}\x1b[0m`);

            if (choice === '7') {  // Nếu người dùng chọn option 7
                console.log(`\x1b[36m[${walletNumber}]\x1b[0m Approving WPOL if needed...`);
                await approveWPOLIfNeeded(account, walletNumber);
            } else {
                if (!autoRestart || i === 0) {
                    await verifyAccountIdentity(account.address);
                    const referralCode = '5dobsl';
                    await verifyWallet(account.address, referralCode, walletNumber);
                    await claimOneTimeReward(account.address);
                }

                if (choice === '1') {
                    await convertPOLToWPOL(account, walletNumber, polAmount);
                } else if (choice === '2') {
                    await wrapTokens(account, walletNumber, numTransactions);
                } else if (choice === '3') {
                    await unwrapTokens(account, walletNumber);
                } else if (choice === '4') {
                    await claimDailyReward(account.address, walletNumber);
                } else if (choice === '5') {
                    await wrapTokens(account, walletNumber, numTransactions);
                    await unwrapTokens(account, walletNumber);
                    await claimDailyReward(account.address, walletNumber);
                } else if (choice === '6') {
                    await wrapTokens(account, walletNumber, numTransactions);
                    await unwrapTokens(account, walletNumber);
                }
            }

            // Optional: Delay between transactions
            console.log(`\x1b[36m[${walletNumber}]\x1b[0m Pausing for 3 seconds before next transaction...`);
            await new Promise(resolve => setTimeout(resolve, 5000));  // 3-second delay
        }

        console.log(`\x1b[36m[Run ${runCount + 1}]\x1b[0m Finished. Pausing for 2 minutes...`);
        await new Promise(resolve => setTimeout(resolve, 120000));  // 2-minute delay

        runCount += 1;
    }

    if (autoRestart) {
        const delay = config.autoRestartDelay;
        console.log(`Auto-restarting in ${delay} seconds...`);
        let countdown = delay;
        const countdownInterval = setInterval(() => {
            countdown -= 1;
            process.stdout.write(`\rAuto-restarting in ${countdown} seconds...`);
            if (countdown <= 0) {
                clearInterval(countdownInterval);
                executeMultipleTransactions(true, choice, numTransactions, polAmount);
            }
        }, 1000);
    } else {
        rl.close();
    }
}


displayHeader();
executeMultipleTransactions();
