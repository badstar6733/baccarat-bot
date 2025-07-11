import puppeteer from "puppeteer";
import sharp from "sharp";
import fs from "fs/promises";
import axios from "axios";
import FormData from "form-data";
import dotenv from "dotenv";
import crypto from "crypto";

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

async function analyzeAndSend(page, campName, roomIndex) {
  const content = await page.$(".heng99-baccarat-content");
  const tempPath = `temp_${campName}_${roomIndex + 1}.jpg`;
  const finalPath = `final_${campName}_${roomIndex + 1}.jpg`;
  await content.screenshot({ path: tempPath });

  const hash = await calculateHash(tempPath);
  const roomKey = `${campName}_${roomIndex + 1}`;
  if (roomHashes.get(roomKey) === hash) {
    await fs.unlink(tempPath);
    return;
  }
  roomHashes.set(roomKey, hash);

  const last10 = await content.$$eval("img", (imgs) =>
    imgs
      .map((img) => img.getAttribute("src") || "")
      .filter((src) =>
        src.includes("icon-banker") ||
        src.includes("icon-player") ||
        src.includes("icon-tie")
      )
      .slice(-10)
      .map((src) => {
        if (src.includes("icon-banker")) return "B";
        if (src.includes("icon-player")) return "P";
        if (src.includes("icon-tie")) return "T";
        return "?";
      })
  );

  let extraCaption = "❌ ไม่มีข้อมูลไพ่ย้อนหลัง";

  if (last10.length > 0) {
    const count = (v) => last10.filter((x) => x === v).length;
    const percent = (n) => Math.round((n / last10.length) * 100);
    const emojiMap = { B: "🟥", P: "🟦", T: "🟩" };

    const winrate = `📊 สถิติ 10 ตาหลังสุด\n🟥 Banker: ${percent(count("B"))}%\n🟦 Player: ${percent(count("P"))}%\n🟩 Tie: ${percent(count("T"))}%`;

    const last10Plays = last10.map((x) => emojiMap[x]);
    const line1 = last10Plays.slice(0, 5).join(" ");
    const line2 = last10Plays.slice(5).join(" ");
    const recentFull = `${line1}\n${line2}`;

    const lastPlays = last10.filter((x) => x === "B" || x === "P");

    const detectDragon = (arr) => {
      if (arr.length < 4) return null;
      let streak = 1;
      for (let i = 1; i < arr.length; i++) {
        if (arr[i] === arr[i - 1]) {
          streak++;
          if (streak >= 4) return arr[i];
        } else {
          streak = 1;
        }
      }
      return null;
    };

    const detectPingPong = (arr) => {
      if (arr.length < 5) return false;
      for (let i = 2; i < arr.length; i++) {
        if (arr[i] !== arr[i - 2]) return false;
      }
      return true;
    };

    const dragon = detectDragon(lastPlays);
    const isPingPong = detectPingPong(lastPlays);

    let suggestion = "";
    if (dragon) {
      const side = dragon === "B" ? "🟥 Banker" : "🟦 Player";
      suggestion = `✅ คำแนะนำ: แทง ${side}`;
    } else if (isPingPong) {
      const next = lastPlays.at(-1) === "B" ? "🟦 Player" : "🟥 Banker";
      suggestion = `✅ คำแนะนำ: แทง ${next}`;
    } else {
      const b = count("B"), p = count("P");
      suggestion = b >= p
        ? `✅ คำแนะนำ: แทง 🟥 Banker`
        : `✅ คำแนะนำ: แทง 🟦 Player`;
    }

    extraCaption = `${winrate}\n\n🎴 เค้าไพ่ล่าสุด\n${recentFull}\n\n📈 วิเคราะห์ไพ่\n${suggestion}`;
  }

  await cropSquareAddLogo(tempPath, finalPath);
  await sendToTelegram(finalPath, roomIndex + 1, campName, extraCaption);
  await fs.unlink(tempPath).catch(() => {});
  await fs.unlink(finalPath).catch(() => {});
}

async function runOnce(page) {
  console.log("⏳ เริ่มทำงาน:", new Date().toLocaleString("th-TH"));

  await page.goto(targetUrl, { waitUntil: "networkidle2", timeout: 120000 });

  for (let campName of TARGET_CAMPS) {
    try {
      const providerLinks = await page.$$(".heng99-baccarat-provider-item__link");
      for (let link of providerLinks) {
        const img = await link.$("img");
        const name = await page.evaluate((el) => el.alt, img);
        if (name === campName) {
          await link.click();
          await delay(1500);
          await page.waitForSelector(".heng99-baccarat-content-room__name", { timeout: 10000 });

          const rooms = await page.$$(".heng99-baccarat-content-room__name");
          const indexes = [0, 1, 2, 3, 4, 5];
          for (const i of indexes) {
            if (i >= rooms.length) continue;
            try {
              await rooms[i].click();
              await page.waitForSelector(".heng99-baccarat-content", { timeout: 8000 });
              await delay(1000);
              await analyzeAndSend(page, campName, i);
              break;
            } catch {
              continue;
            }
          }
          break;
        }
      }
    } catch (err) {
      console.warn(`⚠️ ${campName}: ${err.message}`);
    }
  }

  console.log("✅ เสร็จสิ้นรอบ\n");
}

async function runLoop() {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  while (true) {
    const start = Date.now();
    await runOnce(page);
    const elapsed = Date.now() - start;
    const delayMs = Math.max(35000 - elapsed, 1000);
    console.log(`⏳ รออีก ${(delayMs / 1000).toFixed(1)} วิ\n`);
    await delay(delayMs);
  }
}

runLoop().catch((err) => {
  console.error("❌ เกิดข้อผิดพลาด:", err.message);
  process.exit(1);
});
