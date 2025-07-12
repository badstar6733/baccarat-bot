// ✅ Baccarat Bot 24/7 Version (Render + Local Chromium)
import puppeteer from "puppeteer";
import sharp from "sharp";
import fs from "fs/promises";
import axios from "axios";
import FormData from "form-data";
import dotenv from "dotenv";
import crypto from "crypto";
import http from "http";
import fetch from "node-fetch";

dotenv.config();

const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
const chatIdMap = {
  "SA gaming": process.env.CHAT_ID_SA,
  "WM casino": process.env.CHAT_ID_WM,
};
const targetUrl = "https://bng55.enterprises/baccarat-formula/";
const logoPath = "logo.png";
const TARGET_CAMPS = ["SA gaming", "WM casino"];
const roomHashes = new Map();

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function calculateHash(filePath) {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function cropSquareAddLogo(inputPath, outputPath) {
  const image = sharp(inputPath);
  const metadata = await image.metadata();
  const size = Math.min(metadata.width, metadata.height);
  const logoBuffer = await sharp(logoPath).resize(120).toBuffer();

  await image
    .extract({
      width: size,
      height: size,
      left: Math.floor((metadata.width - size) / 2),
      top: Math.floor((metadata.height - size) / 2),
    })
    .resize(800, 800)
    .composite([{ input: logoBuffer, gravity: "southeast" }])
    .toFile(outputPath);
}

async function sendToTelegram(filePath, roomNumber, campName = "", extraCaption = "") {
  const roomStr = roomNumber.toString().padStart(2, "0");
  const chatId = chatIdMap[campName];
  if (!chatId) return;

  const caption = `🎲 ${campName} | ห้อง ${roomStr}\n\n${extraCaption}`;
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("caption", caption);
  form.append("photo", await fs.readFile(filePath), {
    filename: `room_${roomStr}.jpg`,
    contentType: "image/jpeg",
  });

  const tgUrl = `https://api.telegram.org/bot${telegramToken}/sendPhoto`;
  await axios.post(tgUrl, form, { headers: form.getHeaders() });
  console.log(`✅ ส่งห้อง ${roomStr} (${campName}) เรียบร้อย`);
}

async function sendToTelegramText(message) {
  for (const camp in chatIdMap) {
    const chatId = chatIdMap[camp];
    await axios.post(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
      chat_id: chatId,
      text: message,
    });
  }
}

async function connectBrowser() {
  return await puppeteer.launch({ headless: "new" });
}

async function safeGoto(page, url, maxRetries = 2) {
  for (let i = 1; i <= maxRetries; i++) {
    try {
      await page.goto(url, { waitUntil: "load", timeout: 45000 });
      return;
    } catch (err) {
      console.warn(`⏳ Goto retry ${i}/${maxRetries}: ${err.message}`);
      if (i === maxRetries) throw err;
      await delay(3000);
    }
  }
}

async function processCamp(campName) {
  let browser;
  try {
    browser = await connectBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await safeGoto(page, targetUrl);
    await page.waitForSelector(".heng99-baccarat-provider-item__link", { timeout: 10000 });

    const providerLinks = await page.$$(".heng99-baccarat-provider-item__link");
    for (let link of providerLinks) {
      const img = await link.$("img");
      const name = await page.evaluate((el) => el.alt, img);
      if (name !== campName) continue;

      console.log(`🚪 เข้าแคมป์: ${campName}`);
      await link.click();
      await delay(1000);

      const roomButtons = await page.$$(".heng99-baccarat-content-room__name");

      for (let roomNumber = 1; roomNumber <= roomButtons.length; roomNumber++) {
        try {
          const btn = roomButtons[roomNumber - 1];
          if (!btn) throw new Error("ไม่พบห้องที่ระบุ");

          await btn.click();
          await page.waitForSelector(".heng99-baccarat-content", { timeout: 6000 });
          await delay(600);

          const content = await page.$(".heng99-baccarat-content");
          const tempPath = `temp_${campName}_${roomNumber}.jpg`;
          const finalPath = `final_${campName}_${roomNumber}.jpg`;
          await content.screenshot({ path: tempPath });

          const hash = await calculateHash(tempPath);
          const roomKey = `${campName}_${roomNumber}`;
          if (roomHashes.get(roomKey) === hash) {
            await fs.unlink(tempPath);
            continue;
          }
          roomHashes.set(roomKey, hash);

          const last10 = await content.$$eval("img", (imgs) =>
            imgs
              .filter((img) => {
                const src = img.getAttribute("src") || "";
                return src.includes("icon-banker") || src.includes("icon-player") || src.includes("icon-tie") || src.includes("icon-player-orange");
              })
              .slice(-10)
              .map((img) => {
                const src = img.getAttribute("src") || "";
                if (src.includes("icon-player-orange") || src.includes("icon-player")) return "P";
                if (src.includes("icon-banker")) return "B";
                if (src.includes("icon-tie")) return "T";
                return "?";
              })
          );

          let suggestion = "ไม่พบข้อมูลแนวโน้ม";
          try {
            await page.waitForSelector(".heng99-baccarat-content-next-result__icon img[alt*='Icon']", { timeout: 2000 });
            const nextIcon = await page.$$eval(".heng99-baccarat-content-next-result__icon img", (imgs) => {
              for (const img of imgs) {
                const alt = img.getAttribute("alt") || "";
                if (alt.includes("BANKER")) return "B";
                if (alt.includes("PLAYER")) return "P";
              }
              return null;
            });
            if (nextIcon === "B" || nextIcon === "P") {
              suggestion = `✅ คำแนะนำ: แทง ${nextIcon === "B" ? "🟥 Banker" : "🔵 Player"}`;
            }
          } catch (e) {
            suggestion = "ไม่พบข้อมูลแนวโน้ม";
          }

          const count = (v) => last10.filter((x) => x === v).length;
          const percent = (n) => Math.round((n / last10.length) * 100);
          const emojiMap = { B: "🟥", P: "🔵", T: "🟩" };
          const winrate = `📊 สถิติ 10 ตาหลังสุด\n🟥 Banker: ${percent(count("B"))}%\n🔵 Player: ${percent(count("P"))}%\n🟩 Tie: ${percent(count("T"))}%`;
          const last10Plays = last10.map((x) => emojiMap[x]);
          const recentFull = `${last10Plays.slice(0, 5).join(" ")}\n${last10Plays.slice(5).join(" ")}`;

          const extraCaption = `${winrate}\n\n🎴 เค้าไพ่ล่าสุด\n${recentFull}\n\n📈 วิเคราะห์ไพ่\n${suggestion}`;

          await cropSquareAddLogo(tempPath, finalPath);
          await sendToTelegram(finalPath, roomNumber, campName, extraCaption);
          await fs.unlink(tempPath).catch(() => {});
          await fs.unlink(finalPath).catch(() => {});
          break;
        } catch (err) {
          console.warn(`⚠️ ห้อง ${roomNumber.toString().padStart(2, "0")} (${campName}) เข้าไม่ได้: ${err.message}`);
        }
      }
      break;
    }
    await browser.close();
  } catch (err) {
    console.warn(`⚠️ ${campName}: ${err.message}`);
    await sendToTelegramText(`⚠️ ${campName} เกิดปัญหา: ${err.message}`);
    if (browser) await browser.close().catch(() => {});
  }
}

async function run() {
  const start = Date.now();
  console.log("⏳ เริ่มทำงาน:", new Date().toLocaleString("th-TH"));
  await Promise.all(TARGET_CAMPS.map(processCamp));
  const end = Date.now();
  const seconds = ((end - start) / 1000).toFixed(1);
  console.log(`✅ เสร็จสิ้นรอบ (ใช้เวลา ${seconds} วินาที)\n`);
}

async function loop() {
  try {
    await run();
  } catch (err) {
    console.error("💥 ERROR ใน loop:", err.message);
  }
  setTimeout(loop, 25000);
}
loop();

// 🌐 Web Server เพื่อป้องกัน Replit/Render หลับ
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Bot is running ✅");
}).listen(3000);

// 🔁 Self-ping ทุก 5 นาที
setInterval(() => {
  fetch("https://your-render-url.onrender.com")
    .then(() => console.log("📡 Self-ping OK"))
    .catch(err => console.error("❌ Self-ping failed", err.message));
}, 300000);
