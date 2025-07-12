import express from 'express';
import puppeteer from 'puppeteer';

const app = express();

app.get('/', async (req, res) => {
  console.log(`⏳ เริ่มทำงาน: ${new Date().toLocaleString('th-TH')}`);

  try {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    await page.goto('https://bng55.enterprises/baccarat-formula/');

    // ตัวอย่างดึง title
    const title = await page.title();
    await browser.close();

    res.send(`✅ เสร็จสิ้นรอบ: ${title}`);
  } catch (error) {
    console.error('เกิดข้อผิดพลาด:', error);
    res.status(500).send('❌ เกิดข้อผิดพลาด');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
});
